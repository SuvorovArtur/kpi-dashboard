"""DeepSeek-based message analysis with thread grouping and severity scoring."""
import json
import httpx
from config import DEEPSEEK_API_KEY, DEEPSEEK_MODEL
import db

SYSTEM_PROMPT = """Ты — аналитик потока сообщений из Telegram-чатов Мытищинского городского округа.

ЗАДАЧА: Получи пакет сообщений за последние 30 минут из одного или нескольких чатов. Проанализируй поток. Отсей мусор. Выдели проблемы. Оцени критичность каждой. Верни структурированный результат в формате json.

═══════════════════════════════════════
ШАГ 1: ФИЛЬТРАЦИЯ МУСОРА
═══════════════════════════════════════

Игнорируй полностью (не включай в анализ):
- Приветствия, прощания
- Стикеры, GIF, эмодзи без текста
- Реакции и короткие реплики без содержания («ок», «понял», «спасибо», «ахаха», «+1» без контекста)
- Рекламу, спам, продажи
- Обсуждение погоды, пробок без жалоб
- Личные разговоры
- Политические дискуссии без привязки к муниципальной проблеме
- Информационные запросы («кто знает телефон...», «где находится...»)

НЕ игнорируй:
- Упоминание конкретной проблемы с адресом или локацией
- Жалобы на состояние территории, инфраструктуры, услуг
- Сообщения о ЧП, авариях, опасных ситуациях
- Обсуждения, где несколько человек подтверждают одну проблему
- Эмоциональные высказывания о бездействии властей
- Фото/видео проблем

═══════════════════════════════════════
ШАГ 2: ГРУППИРОВКА В ВЕТКИ (THREADS)
═══════════════════════════════════════

Объедини связанные сообщения в тематические ветки. Признаки одной ветки:
- Реплаи друг на друга
- Упоминание одного адреса/места
- Продолжение одной темы в пределах 10 минут
- Подтверждения других пользователей

═══════════════════════════════════════
ШАГ 3: ОЦЕНКА КРИТИЧНОСТИ (1–10)
═══════════════════════════════════════

1–2: Нейтральное обсуждение.
3: Фиксация проблемы без эмоций.
4: Лёгкое недовольство.
5: Умеренная жалоба с эмоциями.
6: Ощутимое недовольство, несколько человек.
7: Выраженное раздражение, обвинения в бездействии.
8: Угрозы прокуратуры/СМИ, описание опасности.
9: АЛЕРТ. Угроза здоровью/жизни, массовое возмущение.
10: АЛЕРТ. Угрозы протеста, ЧП в реальном времени.

МОДИФИКАТОРЫ:
- 5+ участников → +1, 10+ → +2
- Фото/видео → +1
- Призыв к коллективным действиям = мин 7
- ЧП в реальном времени = мин 8
- Угроза жизни/здоровью = мин 9

═══════════════════════════════════════
ШАГ 4: ТЕМА И ЛОКАЦИЯ
═══════════════════════════════════════

Тема: дороги, благоустройство, мусор, вода, ЖКХ, экология, освещение, транспорт, безопасность, земля, энергетика, канализация, администрация, ЧП, другое

Локация: максимально точный адрес. Если нет — район, улица, ЖК. Если ничего — «не указана».

═══════════════════════════════════════
ФОРМАТ ОТВЕТА — json
═══════════════════════════════════════

{
  "period": "<время начала — время конца>",
  "stats": {
    "total_messages": <всего>,
    "filtered_noise": <отсеяно>,
    "threads_found": <веток>,
    "alerts": <веток с score >= 9>
  },
  "threads": [
    {
      "id": 1,
      "summary": "<суть проблемы>",
      "score": <1-10>,
      "is_alert": <true если score >= 9>,
      "topic": "<тема>",
      "location": "<адрес>",
      "participants": <кол-во авторов>,
      "has_media": <true/false>,
      "key_quotes": ["<цитата до 100 символов>"],
      "reasoning": "<почему такой балл>",
      "source_chat": "<название чата>",
      "message_ids": [<список MSG_ID>]
    }
  ],
  "alerts": [
    {
      "thread_id": <id ветки>,
      "urgency": "<что требует внимания>",
      "recommended_action": "<рекомендация>"
    }
  ]
}

Ветки отсортированы по score убыванию. Alerts только для score >= 9. Если нет проблем — threads пустой массив."""


def format_messages_for_api(messages: list[dict], chats: dict[int, str]) -> str:
    """Format messages into chat-style text for DeepSeek."""
    by_chat: dict[int, list[dict]] = {}
    for m in messages:
        cid = m.get('chat_id', 0)
        if cid not in by_chat:
            by_chat[cid] = []
        by_chat[cid].append(m)

    lines = []
    for chat_id, msgs in by_chat.items():
        chat_name = chats.get(chat_id, f'Chat {chat_id}')
        lines.append(f"[ЧАТ: {chat_name} | ID: {chat_id}]")
        for m in sorted(msgs, key=lambda x: x.get('date', '')):
            date_str = m.get('date', '')
            time_str = date_str[11:16] if len(date_str) > 16 else date_str[:5]
            sender = m.get('sender_name', '?') or '?'
            text = m.get('text', '')[:500]
            msg_id = m.get('id', 0)
            lines.append(f"[{time_str}] [MSG_ID:{msg_id}] {sender}: {text}")
        lines.append("")

    return "\n".join(lines)


def analyze_messages(messages: list[dict], chats: dict[int, str]) -> dict | None:
    """Analyze a batch of messages, return structured result."""
    if not messages:
        return None

    formatted = format_messages_for_api(messages, chats)
    user_prompt = f"Проанализируй сообщения за последние 30 минут.\n\n{formatted}"

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
        return 0

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

    for chat_id, chat_msgs in by_chat.items():
        chat_name = chats_map.get(chat_id, f'Chat {chat_id}')
        print(f"[analyzer] --- {chat_name}: {len(chat_msgs)} messages ---")

        result = analyze_messages(chat_msgs, {chat_id: chat_name})
        if not result:
            continue

        stats = result.get('stats', {})
        threads = result.get('threads', [])
        alerts = result.get('alerts', [])

        print(f"[analyzer] {chat_name}: {stats.get('threads_found', 0)} threads, {stats.get('alerts', 0)} alerts, {stats.get('filtered_noise', 0)} noise")

        created = 0
        active_issues = db.get_active_issues()

        for thread in threads:
            score = thread.get('score', 0)
            if score < 3:
                continue

            msg_ids = thread.get('message_ids', [])
            summary = thread.get('summary', '')
            title = summary[:100] if summary else thread.get('topic', 'Проблема')

            # Match to existing issue by location + topic
            matched_issue = None
            for issue in active_issues:
                if (issue.get('location') and thread.get('location')
                        and issue['location'].lower() in thread['location'].lower()
                        and issue.get('direction') == thread.get('topic')):
                    matched_issue = issue
                    break

            quotes = thread.get('key_quotes', [])
            full_summary = summary
            if quotes:
                full_summary += "\n\nЦитаты: " + "; ".join(quotes)

            if matched_issue:
                db.update_issue(
                    issue_id=matched_issue['id'],
                    message_ids=msg_ids,
                    summary=full_summary,
                    severity=max(score, matched_issue.get('severity', 0)),
                )
                print(f"[analyzer] Updated issue #{matched_issue['id']}: {title[:50]} (score {score})")
            else:
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

        total_threads += len(threads)
        print(f"[analyzer] {chat_name}: {created} new issues")

    print(f"[analyzer] Total: {total_threads} threads across all chats")
    return total_threads
