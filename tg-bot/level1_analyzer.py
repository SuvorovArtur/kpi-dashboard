"""Level 1: Quick complaint filter for individual messages (batch up to 30)."""
import json
import httpx
from config import DEEPSEEK_API_KEY, DEEPSEEK_MODEL
import db

SYSTEM_PROMPT = """Ты — первичный фильтр сообщений из Telegram-чатов жителей города.
Твоя задача: из пакета сообщений быстро отсеять мусор и пропустить дальше ТОЛЬКО сообщения, содержащие реальные жалобы или сообщения о проблемах.

Тебе приходит JSON-массив сообщений (до 30 штук). Каждое сообщение имеет msg_id и text.
Анализируй каждое сообщение НЕЗАВИСИМО.

ВАЖНО: Ты — грубый фильтр. Лучше ПРОПУСТИТЬ сомнительное сообщение (is_complaint: true), чем потерять реальную жалобу. После тебя работает второй уровень анализа, который отсеет ложные срабатывания. Твоя задача — не пропустить настоящие проблемы.


ПРЕДОБРАБОТКА (выполни мысленно):
1. РЕГИСТР: капслок — маркер эмоции, анализируй содержание.
2. СЛЕНГ: мкр=микрорайон, ул=улица, д=дом, корп=корпус, УК=управляющая компания, ТСЖ=товарищество собственников, ГВС=горячее водоснабжение, ХВС=холодное водоснабжение.
3. ОПЕЧАТКИ: восстанови смысл.
4. ЭМОДЗИ: 🔥💥⚡=авария, 💩🤮😷=грязь, ❄️🥶=холод, 😡🤬=гнев, 💧🌊=вода, ⚠️🚧=предупреждение.
5. ШУМ: игнорируй ссылки, хештеги, @ботов, рекламу.
6. СТОП-СЛОВА: пропускай «ну», «вот», «блин», «типа», «короче», «слушайте», «народ».


КЛАССИФИКАЦИЯ:

is_complaint: true если ЛЮБОЕ из:
- Описана конкретная проблема (сломано / не работает / мешает / угрожает)
- Сообщение о ЧП, аварии, опасной ситуации
- Эмоциональная жалоба на состояние инфраструктуры/территории
- Подтверждение чужой жалобы с деталями («у нас тоже», «подтверждаю, дом 8»)
- Фото/видео проблемы с подписью

Адрес НЕ обязателен. Если человек жалуется без адреса — пропускай (true).

is_complaint: false если ЛЮБОЕ из:
- Вопрос без проблемы («кто знает номер УК?»)
- Благодарность («спасибо, починили!»)
- Воспоминания, ностальгия («а помните как раньше...»)
- Реклама, объявления, купля-продажа
- Флуд, приветствия, мемы, стикеры, споры
- Обсуждение решённых проблем в прошедшем времени
- Жалобы на цены/тарифы/политику (не инфраструктура)
- Личные разговоры, поздравления, бытовые вопросы
- Короткие реакции без содержания: «ок», «ахаха», «👍», «+1» без контекста

КЛЮЧЕВОЙ ТЕСТ: Автор ХОЧЕТ чтобы что-то ИЗМЕНИЛОСЬ? Если нет — false.


КАТЕГОРИЯ (только для is_complaint: true):
roads — ямы, асфальт, тротуары, бордюры, дорожное покрытие
water — водоснабжение, канализация, прорыв, нет воды
heat — отопление, батареи холодные, нет ГВС
electricity — электричество, фонари, обрыв проводов, освещение
garbage — мусор, контейнеры, вывоз ТБО, свалки
elevator — лифты, застревание
improvement — дворы, детские площадки, скамейки, газоны
transport — автобусы, остановки, расписание
ecology — загрязнение, выбросы, шум, запах, вырубка
safety — хулиганство, наркоманы, вандализм
incident — авария, пожар, обрушение, ЧП, утечка газа
zhkh — крыша, фасад, подъезд, УК, ТСЖ, домофон

Правила: ямы/асфальт -> ВСЕГДА roads. Фонари -> electricity. Утечка газа -> incident. Неясно -> zhkh.

ПРИОРИТЕТ (только для is_complaint: true):
urgent — реальная угроза жизни/здоровью ПРЯМО СЕЙЧАС: утечка газа, пожар, обрушение, оголённые провода, открытый люк, прорыв с затоплением, лифт с людьми.
normal — всё остальное.


ФОРМАТ ОТВЕТА — json:

{"results": [
  {"msg_id": "id1", "is_complaint": true, "category": "roads", "priority": "normal", "address": "ул. Ленина, д. 5", "phone": null, "summary": "Яма перед переходом", "confidence": 0.9},
  {"msg_id": "id2", "is_complaint": false},
  {"msg_id": "id3", "is_complaint": true, "category": "incident", "priority": "urgent", "address": null, "phone": null, "summary": "Запах газа в подъезде", "confidence": 0.95}
]}

Для is_complaint: false — только msg_id и is_complaint.
КОЛИЧЕСТВО объектов в results ДОЛЖНО совпадать с количеством входных сообщений."""


CATEGORY_MAP = {
    "roads": "дороги",
    "water": "вода",
    "heat": "ЖКХ",
    "electricity": "освещение",
    "garbage": "мусор",
    "elevator": "ЖКХ",
    "improvement": "благоустройство",
    "transport": "транспорт",
    "ecology": "экология",
    "safety": "безопасность",
    "incident": "ЧП",
    "zhkh": "ЖКХ",
}

CONFIDENCE_THRESHOLD = 0.6


def classify_batch(messages: list[dict]) -> list[dict]:
    """Classify a batch of messages (up to 30). Returns list of results."""
    if not messages:
        return []

    # Build input JSON
    batch = []
    for m in messages:
        msg_id = f"ch{m.get('chat_id', 0)}_{m.get('id', 0)}"
        text = (m.get('text', '') or '')[:500]
        if len(text.strip()) < 5:
            continue
        batch.append({"msg_id": msg_id, "text": text})

    if not batch:
        return []

    user_prompt = f"Проанализируй пакет сообщений из чатов жителей:\n\n{json.dumps(batch, ensure_ascii=False)}"

    try:
        response = httpx.post(
            'https://api.deepseek.com/chat/completions',
            headers={
                'Authorization': f'Bearer {DEEPSEEK_API_KEY}',
                'Content-Type': 'application/json',
            },
            json={
                'model': DEEPSEEK_MODEL,
                'messages': [
                    {'role': 'system', 'content': SYSTEM_PROMPT},
                    {'role': 'user', 'content': user_prompt},
                ],
                'response_format': {'type': 'json_object'},
                'temperature': 0,
                'max_tokens': 4000,
            },
            timeout=60,
        )
        response.raise_for_status()
        content = response.json()['choices'][0]['message']['content']
        result = json.loads(content)
        return result.get('results', [])

    except Exception as e:
        print(f"[level1] Error: {e}")
        return []


def process_level1():
    """Run Level 1 filter on unanalyzed messages. Returns (total, complaints, urgent_alerts)."""
    # Get unanalyzed messages
    res = db.get_client().table('tg_messages').select('*').eq('level1_analyzed', False).order('date', desc=False).limit(30).execute()
    messages = res.data or []

    if not messages:
        return 0, 0, []

    # Get chat types to exclude channels
    chats = db.get_active_chats()
    chat_type_map = {c['chat_id']: c.get('type', 'chat') for c in chats}
    chat_messages = [m for m in messages if chat_type_map.get(m['chat_id']) == 'chat']

    if not chat_messages:
        # Mark non-chat messages as analyzed
        msg_ids = [m['id'] for m in messages]
        for mid in msg_ids:
            db.get_client().table('tg_messages').update({'level1_analyzed': True}).eq('id', mid).execute()
        return len(messages), 0, []

    print(f"[level1] Classifying {len(chat_messages)} messages...")
    results = classify_batch(chat_messages)

    # Build lookup: msg_id -> original message
    msg_lookup = {}
    for m in chat_messages:
        key = f"ch{m['chat_id']}_{m['id']}"
        msg_lookup[key] = m

    complaints = 0
    urgent_alerts = []

    for r in results:
        msg_id = r.get('msg_id', '')
        orig = msg_lookup.get(msg_id)
        if not orig:
            continue

        if r.get('is_complaint'):
            confidence = r.get('confidence', 0)
            if confidence < CONFIDENCE_THRESHOLD:
                continue

            complaints += 1
            priority = r.get('priority', 'normal')

            # Save to tg_complaints
            try:
                db.get_client().table('tg_complaints').upsert({
                    'chat_id': orig['chat_id'],
                    'message_id': orig['id'],
                    'msg_id': msg_id,
                    'category': r.get('category'),
                    'priority': priority,
                    'address': r.get('address'),
                    'phone': r.get('phone'),
                    'summary': r.get('summary', ''),
                    'confidence': confidence,
                    'original_text': (orig.get('text') or '')[:2000],
                    'sender_name': orig.get('sender_name'),
                    'date': orig.get('date'),
                }, on_conflict='chat_id,message_id').execute()
            except Exception as e:
                print(f"[level1] Save error: {e}")

            # Urgent → immediate alert
            if priority == 'urgent':
                urgent_alerts.append({
                    'summary': r.get('summary', ''),
                    'category': r.get('category', 'incident'),
                    'address': r.get('address'),
                    'chat_id': orig['chat_id'],
                    'message_id': orig['id'],
                    'original_text': (orig.get('text') or '')[:300],
                })

    # Mark all as analyzed
    for m in messages:
        db.get_client().table('tg_messages').update({'level1_analyzed': True}).eq('id', m['id']).execute()

    print(f"[level1] {len(chat_messages)} messages -> {complaints} complaints, {len(urgent_alerts)} urgent")
    return len(chat_messages), complaints, urgent_alerts
