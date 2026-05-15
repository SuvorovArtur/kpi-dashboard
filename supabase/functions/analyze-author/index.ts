// analyze-author — Supabase Edge Function (incremental mode).
//
// First run: takes up to BATCH_SIZE most recent messages, calls the LLM, stores
//   the structured profile AND a compact textual "profile_snapshot" that
//   summarises style / themes / etc.
// Subsequent runs: passes the previous profile_snapshot + only NEW messages
//   (date > last_processed_message_date) to the LLM. The LLM updates the profile
//   and returns a fresh snapshot. This way the analysis accumulates memory
//   instead of re-analysing the same 100 messages each time.
//
// Secrets:
//   DEEPSEEK_API_KEY            — DeepSeek API key (was XAI_API_KEY for Grok-4
//                                 until 2026-05-12; xAI balance ran out and
//                                 DeepSeek is materially cheaper)
// Provided by Supabase runtime:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface ReqBody {
  chat_id: number;
  author: string;
  batch_size?: number; // how many new messages to take at most per run (default 100)
}

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = Deno.env.get("OCTOBOT_DEEPSEEK_MODEL") || "deepseek-chat";
const DEFAULT_BATCH = 100;
const MIN_MESSAGES = 3;

const SYSTEM_PROMPT =
  "Ты — аналитик гражданских сообщений из Telegram-чатов. " +
  "Составляешь профиль участника и возвращаешь строго один JSON-объект без markdown. " +
  "ВСЕ текстовые поля ответа (bio, profile_snapshot, элементы topics_of_interest, " +
  "frequent_locations, notable_traits) пиши ТОЛЬКО по-русски, без английских слов и " +
  "транслитерации. Даже если исходные сообщения содержат английские вкрапления — в ответе " +
  "используй русский язык и русские термины (например, 'критика местной власти', а не " +
  "'local government criticism').";

const AXES_SPEC = `
Пять осей — целые числа 0..100. Шкалы:
- loyalty_score        : 0 = в оппозиции к власти, 50 = нейтрален, 100 = поддерживает власть.
- satisfaction_score   : 0 = всё плохо, ругает среду (двор, дороги, ЖКХ, услуги), 100 = доволен.
- constructiveness_score: 0 = токсичен, провокации, оскорбления, 100 = факты, предлагает решения.
- influence_score      : 0 = незаметен (никто не реагирует), 100 = лидер мнений (ему отвечают, за ним повторяют).
- escalation_score     : 0 = спокоен, аналитик, 100 = зовёт на протест/саботаж/радикальное действие.
Если данных для какой-то оси недостаточно — возвращай целое число по ощущению, но не null.`;

function firstRunPrompt(author: string, block: string) {
  return `Составь первичный профиль участника «${author}» в Telegram-чате городской администрации на основе его сообщений.

Верни СТРОГО ОДИН JSON-объект без markdown:
{
  "overall_sentiment": "positive|neutral|negative|mixed",
  "sentiment_score": <число от -1 до 1>,
  "loyalty_score": <целое 0..100>,
  "satisfaction_score": <целое 0..100>,
  "constructiveness_score": <целое 0..100>,
  "influence_score": <целое 0..100>,
  "escalation_score": <целое 0..100>,
  "bio": "2-3 предложения в третьем лице: кто этот человек, чем интересуется, стиль речи, возраст/пол/занятость если упомянуты",
  "topics_of_interest": ["..."],
  "frequent_locations": ["..."],
  "notable_traits": ["сарказм", "конструктивность", "эмоциональность" и т.п.],
  "profile_snapshot": "Компактный текстовый отпечаток (4-8 предложений, до 800 символов), который при следующем запуске заменит необходимость перечитывать старые сообщения. Включай: устойчивые темы, стиль, эмоциональные паттерны, отношение к власти, упомянутые адреса/факты о жизни, характерные цитаты."
}

sentiment_score: -1 крайне негативный, 0 нейтральный, +1 крайне позитивный.
${AXES_SPEC}
bio — деловым языком, без оценочных ярлыков.
ЯЗЫК ОТВЕТА: только русский. Все строковые значения и элементы массивов — по-русски.

СООБЩЕНИЯ (${block.split("\n").length} шт., от свежих к старым):
${block}`;
}

function incrementalPrompt(
  author: string,
  previousSnapshot: string,
  lastBio: string | null,
  newMessagesBlock: string,
  totalBefore: number,
) {
  return `Обнови профиль участника «${author}» в Telegram-чате городской администрации.

Ранее уже проанализировано ${totalBefore} сообщений этого участника, их сводный отпечаток приведён ниже.
Появились новые сообщения — учти их и выдай ОБНОВЛЁННЫЙ профиль.

=== ПРЕДЫДУЩИЙ ОТПЕЧАТОК (snapshot) ===
${previousSnapshot}

=== ПРЕДЫДУЩАЯ БИО ===
${lastBio || "—"}

=== НОВЫЕ СООБЩЕНИЯ (${newMessagesBlock.split("\n").length} шт., от свежих к старым) ===
${newMessagesBlock}

Верни СТРОГО ОДИН JSON-объект без markdown:
{
  "overall_sentiment": "positive|neutral|negative|mixed",
  "sentiment_score": <число от -1 до 1>,
  "loyalty_score": <целое 0..100>,
  "satisfaction_score": <целое 0..100>,
  "constructiveness_score": <целое 0..100>,
  "influence_score": <целое 0..100>,
  "escalation_score": <целое 0..100>,
  "bio": "обновлённая био (2-3 предложения, 3-е лицо)",
  "topics_of_interest": ["..."],
  "frequent_locations": ["..."],
  "notable_traits": ["..."],
  "profile_snapshot": "Обновлённый отпечаток (4-8 предложений, до 800 символов). Сохрани важные наблюдения из предыдущего, добавь новые, выбрось устаревшие/единичные. Это сводка, которая заменит предыдущую в базе."
}

${AXES_SPEC}

Если новые сообщения не противоречат предыдущему отпечатку — уточняй и сохраняй преемственность.
Если меняется тон или появляются новые темы — отрази это в обновлении.
ЯЗЫК ОТВЕТА: только русский. Все строковые значения и элементы массивов — по-русски.`;
}

async function resolveApiKey(db: ReturnType<typeof createClient>): Promise<string> {
  const envKey = Deno.env.get("DEEPSEEK_API_KEY");
  if (envKey) return envKey;
  // Fallback: pull from app_settings (writable via SQL, no dashboard required).
  const { data } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "deepseek_api_key")
    .maybeSingle();
  const v = (data?.value || "").trim();
  if (!v) throw new Error("DEEPSEEK_API_KEY not set (neither env var nor app_settings.deepseek_api_key)");
  return v;
}

async function callClassifier(
  db: ReturnType<typeof createClient>,
  author: string,
  messages: string[],
  previousSnapshot: string | null,
  previousBio: string | null,
  totalBefore: number,
): Promise<Record<string, unknown>> {
  const apiKey = await resolveApiKey(db);

  const block = messages
    .map((m, i) => `${i + 1}. ${m.replace(/\s+/g, " ").trim().slice(0, 500)}`)
    .join("\n");

  const userPrompt = previousSnapshot
    ? incrementalPrompt(author, previousSnapshot, previousBio, block, totalBefore)
    : firstRunPrompt(author, block);

  const r = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`DeepSeek ${r.status}: ${body.slice(0, 300)}`);
  }
  const data = await r.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  const cleaned = String(content).trim()
    .replace(/^```json/, "").replace(/^```/, "").replace(/```$/, "").trim();
  return JSON.parse(cleaned);
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }
  try {
    const body = (await req.json()) as ReqBody;
    if (!body?.chat_id || !body?.author) {
      return new Response(JSON.stringify({ error: "chat_id and author are required" }), {
        status: 400, headers: { ...corsHeaders(), "Content-Type": "application/json" },
      });
    }
    const batchSize = Math.max(10, Math.min(body.batch_size ?? DEFAULT_BATCH, 200));

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);

    // 1. Load existing profile (if any) — for incremental mode
    const { data: existing } = await db
      .from("tg_author_profiles")
      .select("profile_snapshot, bio, last_processed_message_date, total_processed_count")
      .eq("chat_id", body.chat_id)
      .eq("author", body.author)
      .maybeSingle();

    const previousSnapshot: string | null = existing?.profile_snapshot ?? null;
    const previousBio: string | null = existing?.bio ?? null;
    const totalBefore: number = existing?.total_processed_count ?? 0;
    const afterDate: string | null = existing?.last_processed_message_date ?? null;

    // 2. Fetch messages — new ones only if we have a prior snapshot
    let query = db
      .from("tg_messages")
      .select("text, date")
      .eq("chat_id", body.chat_id)
      .eq("sender_name", body.author)
      .order("date", { ascending: false })
      .limit(batchSize);
    if (previousSnapshot && afterDate) {
      query = query.gt("date", afterDate);
    }
    const { data: msgs, error: msgsErr } = await query;
    if (msgsErr) throw msgsErr;

    const rows = (msgs || []) as Array<{ text: string | null; date: string }>;
    const texts = rows.map(r => r.text || "").filter(t => t.length >= 3);

    // 3. Validation
    if (!previousSnapshot && texts.length < MIN_MESSAGES) {
      return new Response(
        JSON.stringify({ error: `Not enough messages (need >= ${MIN_MESSAGES})` }),
        { status: 400, headers: { ...corsHeaders(), "Content-Type": "application/json" } },
      );
    }
    if (previousSnapshot && texts.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          reused: true,
          message: "No new messages since last analysis — profile unchanged.",
          last_processed_message_date: afterDate,
          total_processed_count: totalBefore,
        }),
        { headers: { ...corsHeaders(), "Content-Type": "application/json" } },
      );
    }

    // 4. Call LLM classifier
    const analysis = await callClassifier(db, body.author, texts, previousSnapshot, previousBio, totalBefore);

    // 5. Compute new watermark
    const newLastDate = rows.length > 0 ? rows[0].date : afterDate;
    const newTotal = totalBefore + texts.length;

    // 6. UPSERT
    const clampAxis = (v: unknown): number | null => {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) return null;
      return Math.max(0, Math.min(100, Math.round(n)));
    };

    const profileRow = {
      chat_id: body.chat_id,
      author: body.author,
      generated_at: new Date().toISOString(),
      generated_from_count: texts.length,
      overall_sentiment: (analysis.overall_sentiment ?? null) as string | null,
      sentiment_score: (analysis.sentiment_score ?? null) as number | null,
      loyalty_score: clampAxis(analysis.loyalty_score),
      satisfaction_score: clampAxis(analysis.satisfaction_score),
      constructiveness_score: clampAxis(analysis.constructiveness_score),
      influence_score: clampAxis(analysis.influence_score),
      escalation_score: clampAxis(analysis.escalation_score),
      bio: (analysis.bio ?? null) as string | null,
      topics_of_interest: (analysis.topics_of_interest ?? null) as string[] | null,
      frequent_locations: (analysis.frequent_locations ?? null) as string[] | null,
      notable_traits: (analysis.notable_traits ?? null) as string[] | null,
      profile_snapshot: (analysis.profile_snapshot ?? previousSnapshot ?? null) as string | null,
      last_processed_message_date: newLastDate,
      total_processed_count: newTotal,
      raw_analysis: analysis,
      updated_at: new Date().toISOString(),
    };

    const { error: upErr } = await db
      .from("tg_author_profiles")
      .upsert(profileRow, { onConflict: "chat_id,author" });
    if (upErr) throw upErr;

    return new Response(
      JSON.stringify({
        ok: true,
        incremental: !!previousSnapshot,
        batch_processed: texts.length,
        total_processed_count: newTotal,
        profile: profileRow,
      }),
      { headers: { ...corsHeaders(), "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders(), "Content-Type": "application/json" },
    });
  }
});
