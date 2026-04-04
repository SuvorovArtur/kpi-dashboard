"""DeepSeek-based message analysis v2.1 with thread grouping, deduplication and severity scoring."""
import json
import httpx
from config import DEEPSEEK_API_KEY, DEEPSEEK_MODEL
import db

SYSTEM_PROMPT = """Ты — аналитик потока сообщений из Telegram-чатов Мытищинского городского округа Московской области.

ЗАДАЧА: Получи пакет сообщений из одного чата за последние 30 минут. Отсей мусор. Выдели проблемы. Оцени критичность. Верни результат строго в формате json.

КОНТЕКСТ: Это бытовые чаты жителей — не официальные обращения. Люди пишут коротко, эмоционально, с матом, мемами, оффтопом. Твоя задача — найти в этом потоке реальные муниципальные проблемы и оценить уровень напряжения.

═══════════════════════════════════════
ШАГ 1: ФИЛЬТРАЦИЯ МУСОРА
═══════════════════════════════════════

ИГНОРИРУЙ:
- Приветствия, прощания
- Стикеры, GIF, эмодзи без текста
- Короткие реакции без привязки к проблеме: «ок», «понял», «спасибо», «ахаха», «👍»
- Рекламу, спам, продажи
- Обсуждение погоды, пробок без жалоб
- Личные разговоры
- Политические дискуссии без привязки к муниципальной проблеме
- Чистые информационные запросы: «кто знает телефон...», «посоветуйте стоматолога»

НЕ ИГНОРИРУЙ:
- Упоминание проблемы с адресом или локацией
- Жалобы на инфраструктуру, территорию, услуги
- Сообщения о ЧП, авариях, опасных ситуациях
- Обсуждения, где несколько человек подтверждают проблему
- Эмоциональные высказывания о бездействии властей
- Фото/видео проблем

ОСОБЫЙ СЛУЧАЙ — «+1» как реплай на проблему = подтверждение (считай автора). «+1» без контекста = мусор.

═══════════════════════════════════════
ШАГ 2: ГРУППИРОВКА В ВЕТКИ
═══════════════════════════════════════

Признаки одной ветки: реплаи, одно место, тема в пределах 10 минут, подтверждения.
ЛИМИТ: Не более 7 веток. Мелкие (score 3-4) объединяй в «Прочие жалобы».
Для каждой ветки ОБЯЗАТЕЛЬНО собери message_ids.

═══════════════════════════════════════
ШАГ 2.5: ДЕДУПЛИКАЦИЯ
═══════════════════════════════════════

В user message может быть блок [АКТИВНЫЕ ПРОБЛЕМЫ]. Если сообщения обсуждают ТУ ЖЕ проблему — привяжи через existing_issue_id, не создавай новую.

Считай проблему той же, если:
- Совпадает адрес/локация + тема
- ИЛИ люди явно обсуждают известную ситуацию

При привязке: existing_issue_id = номер, score = оценка текущих сообщений, is_escalation = true если тональность выросла.

═══════════════════════════════════════
ШАГ 3: ОЦЕНКА КРИТИЧНОСТИ (1–10)
═══════════════════════════════════════

ГЛАВНОЕ: Оценивай ТОНАЛЬНОСТЬ, не объективную серьёзность.

1–2: Нейтральное обсуждение.
3: Фиксация проблемы без эмоций. БАЗОВЫЙ уровень.
4: Лёгкое недовольство. «Когда наконец».
5: Умеренная жалоба с эмоциями. «Достало».
6: Несколько человек жалуются. «Сколько можно».
7: Обвинения в бездействии, капслок, «!!!!».
8: Угрозы прокуратуры/СМИ, описание опасности.
9: АЛЕРТ. Угроза здоровью/жизни, массовое возмущение.
10: АЛЕРТ. Протест, ЧП в реальном времени.

КАЛИБРОВКА МАТА:
- Бытовой без агрессии («бл*, опять яма») = 5–6, НЕ алерт.
- Мат + агрессия на власти = 7–8.
- Мат + отчаяние + угроза жизни = 9–10.

МОДИФИКАТОРЫ: 5+ участников → +1, 10+ → +2, фото → +1, повторная проблема → +1, коллективное действие → мин 7, протест → 10, ЧП → мин 8, угроза жизни → мин 9.

При сомнениях — НИЖНИЙ балл.

═══════════════════════════════════════
ШАГ 4: ТЕМА И ЛОКАЦИЯ
═══════════════════════════════════════

ТЕМА: дороги, благоустройство, мусор, вода, ЖКХ, экология, освещение, транспорт, безопасность, земля, энергетика, канализация, администрация, ЧП, другое

ЛОКАЦИЯ: точный адрес → улица → район/ЖК → «не указана». НЕ ПРИДУМЫВАЙ адрес.

═══════════════════════════════════════
ЗАЩИТА ОТ ОШИБОК
═══════════════════════════════════════

1. Не придумывай проблемы.
2. Не добавляй информацию, которой нет в сообщениях.
3. key_quotes — только прямые цитаты.
4. message_ids — только из входных [MSG_ID:XX].
5. Одно сообщение = одна ветка.

═══════════════════════════════════════
ФОРМАТ ОТВЕТА — json
═══════════════════════════════════════

{
  "period": "<время начала — конца>",
  "stats": {
    "total_messages": <всего>,
    "filtered_noise": <мусор>,
    "threads_found": <веток>,
    "alerts": <score >= 9>
  },
  "threads": [
    {
      "id": 1,
      "existing_issue_id": <ISSUE_ID или null>,
      "is_escalation": <true/false>,
      "title": "<короткий заголовок до 60 символов>",
      "summary": "<подробное описание, 2-3 предложения>",
      "score": <1-10>,
      "is_alert": <true если score >= 9>,
      "topic": "<тема>",
      "location": "<адрес или 'не указана'>",
      "participants": <авторов>,
      "has_media": <true/false>,
      "key_quotes": ["<цитата>"],
      "reasoning": "<почему такой балл>",
      "source_chat": "<название чата>",
      "message_ids": [<MSG_ID>]
    }
  ],
  "alerts": [
    {
      "thread_id": <id>,
      "urgency": "<что требует внимания>",
      "recommended_action": "<рекомендация>"
    }
  ]
}

Threads отсортированы по score убыванию. Alerts только для score >= 9."""


def format_messages_for_api(messages: list[dict], chat_name: str, chat_id: int) -> str:
    """Format messages into chat-style text for DeepSeek."""
    lines = [f"[ЧАТ: {chat_name} | ID: {chat_id}]"]
    for m in sorted(messages, key=lambda x: x.get('date', '')):
        date_str = m.get('date', '')
        time_str = date_str[11:16] if len(date_str) > 16 else date_str[:5]
        sender = m.get('sender_name', '?') or '?'
        text = m.get('text', '')[:500]
        msg_id = m.get('id', 0)
        lines.append(f"[{time_str}] [MSG_ID:{msg_id}] {sender}: {text}")
    return "\n".join(lines)


def format_active_issues(issues: list[dict]) -> str:
    """Format active issues for deduplication context."""
    if not issues:
        return ""
    lines = ["[АКТИВНЫЕ ПРОБЛЕМЫ]"]
    for i in issues:
        lines.append(
            f'ISSUE_ID:{i["id"]} | {i.get("direction", "другое")} | '
            f'{i.get("location", "не указана")} | score:{i.get("severity", 0)} | '
            f'"{(i.get("title") or "")[:80]}"'
        )
    return "\n".join(lines)


def analyze_messages(messages: list[dict], chat_name: str, chat_id: int, active_issues: list[dict]) -> dict | None:
    """Analyze a batch of messages, return structured result."""
    if not messages:
        return None

    formatted_msgs = format_messages_for_api(messages, chat_name, chat_id)
    active_block = format_active_issues(active_issues)

    user_prompt = f"Проанализируй сообщения за последние 30 минут.\n\n{active_block}\n\n{formatted_msgs}" if active_block else f"Проанализируй сообщения за последние 30 минут.\n\n{formatted_msgs}"

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
                'temperature': 0.15,
                'max_tokens': 2000,
            },
            timeout=60,
        )
        response.raise_for_status()
        content = response.json()['choices'][0]['message']['content']
        return json.loads(content)

    except Exception as e:
        print(f"[analyzer] Error: {e}")
        return None


def process_batch():
    """Main analysis pipeline: fetch unanalyzed messages, analyze PER CHAT, save issues."""
    messages = db.get_unanalyzed_messages(200)
    if not messages:
        print("[analyzer] No new messages to analyze")
        db.get_client().table('tg_analysis_log').insert({
            'started_at': 'now()', 'finished_at': 'now()',
            'messages_analyzed': 0, 'threads_found': 0, 'alerts_found': 0,
            'chats_processed': 0, 'status': 'done',
        }).execute()
        return 0

    # Log start
    log_entry = db.get_client().table('tg_analysis_log').insert({
        'started_at': 'now()', 'messages_analyzed': len(messages), 'status': 'running',
    }).execute()
    log_id = log_entry.data[0]['id'] if log_entry.data else None

    chats_list = db.get_active_chats()
    chats_map = {c['chat_id']: c['title'] for c in chats_list}

    # Group messages by chat
    by_chat: dict[int, list[dict]] = {}
    for m in messages:
        cid = m.get('chat_id', 0)
        if cid not in by_chat:
            by_chat[cid] = []
        by_chat[cid].append(m)

    print(f"[analyzer] {len(messages)} messages across {len(by_chat)} chats")

    total_threads = 0
    total_alerts = 0

    # Load active issues ONCE for deduplication
    active_issues = db.get_active_issues()

    for chat_id, chat_msgs in by_chat.items():
        chat_name = chats_map.get(chat_id, f'Chat {chat_id}')
        print(f"[analyzer] --- {chat_name}: {len(chat_msgs)} messages ---")

        result = analyze_messages(chat_msgs, chat_name, chat_id, active_issues)
        if not result:
            continue

        stats = result.get('stats', {})
        threads = result.get('threads', [])
        alerts = result.get('alerts', [])

        print(f"[analyzer] {chat_name}: {stats.get('threads_found', 0)} threads, {stats.get('alerts', 0)} alerts, {stats.get('filtered_noise', 0)} noise")

        created = 0

        for thread in threads:
            score = thread.get('score', 0)
            if score < 3:
                continue

            msg_ids = thread.get('message_ids', [])
            participants = thread.get('participants', 1)

            # Skip too thin threads (unless critical)
            if len(msg_ids) < 3 and participants < 2 and score < 8:
                print(f"[analyzer] Skipped (thin): {thread.get('title', '')[:40]} ({len(msg_ids)} msgs)")
                continue

            summary = thread.get('summary', '')
            title = thread.get('title', '') or summary[:60]
            existing_id = thread.get('existing_issue_id')
            is_escalation = thread.get('is_escalation', False)

            quotes = thread.get('key_quotes', [])
            full_summary = summary
            if quotes:
                full_summary += "\n\nЦитаты: " + "; ".join(quotes)

            if existing_id:
                # Deduplication: update existing issue
                old_issue = next((i for i in active_issues if i['id'] == existing_id), None)
                new_severity = max(score, old_issue.get('severity', 0)) if old_issue else score

                db.update_issue(
                    issue_id=existing_id,
                    message_ids=msg_ids,
                    summary=full_summary,
                    severity=new_severity,
                )

                # Auto-escalate if tonal escalation and status is 'watching'
                if is_escalation and old_issue and old_issue.get('status') == 'watching':
                    db.get_client().table('tg_issues').update({'status': 'escalated'}).eq('id', existing_id).execute()
                    print(f"[analyzer] ⬆️ Escalated issue #{existing_id}: {title[:50]} ({old_issue.get('severity')} → {new_severity})")
                else:
                    print(f"[analyzer] 🔄 Updated issue #{existing_id}: {title[:50]} (score {score})")
            else:
                # New issue
                issue_id = db.save_issue(
                    title=title,
                    summary=full_summary,
                    severity=score,
                    direction=thread.get('topic'),
                    location=thread.get('location'),
                    message_ids=msg_ids,
                )
                if issue_id:
                    created += 1
                    if thread.get('is_alert'):
                        db.get_client().table('tg_issues').update({'status': 'escalated'}).eq('id', issue_id).execute()

                    emoji = '🚨' if thread.get('is_alert') else '⚠️' if score >= 7 else '📋'
                    print(f"[analyzer] {emoji} New #{issue_id}: {title[:60]} (score {score})")

                    for a in alerts:
                        if a.get('thread_id') == thread.get('id'):
                            print(f"[analyzer] 🚨 ALERT: {a.get('urgency', '')}")
                            print(f"[analyzer]    Action: {a.get('recommended_action', '')}")

                    # Add new issue to active_issues for next chat's dedup
                    active_issues.append({
                        'id': issue_id, 'title': title, 'severity': score,
                        'direction': thread.get('topic'), 'location': thread.get('location'),
                    })

        total_threads += len(threads)
        total_alerts += stats.get('alerts', 0)
        print(f"[analyzer] {chat_name}: {created} new issues")

    # Log completion
    if log_id:
        db.get_client().table('tg_analysis_log').update({
            'finished_at': 'now()', 'threads_found': total_threads,
            'alerts_found': total_alerts, 'chats_processed': len(by_chat), 'status': 'done',
        }).eq('id', log_id).execute()

    print(f"[analyzer] Total: {total_threads} threads across all chats")
    return total_threads
