"""Telegram alert notifications for critical issues (score >= 9)."""

ALERT_CHAT_ID = 386071116  # Артур Суворов

# Emoji mapping for topics
TOPIC_EMOJI = {
    'дороги': '\U0001f6e3',       # 🛣
    'благоустройство': '\U0001f3d7',  # 🏗
    'мусор': '\U0001f5d1',        # 🗑
    'вода': '\U0001f4a7',         # 💧
    'ЖКХ': '\U0001f3e0',         # 🏠
    'экология': '\U0001f332',     # 🌲
    'освещение': '\U0001f4a1',    # 💡
    'транспорт': '\U0001f68c',    # 🚌
    'безопасность': '\U0001f6a8', # 🚨
    'земля': '\U0001f4cd',        # 📍
    'энергетика': '\u26a1',       # ⚡
    'канализация': '\U0001f6b0',  # 🚰
    'администрация': '\U0001f3db', # 🏛
    'ЧП': '\U0001f6a8',          # 🚨
    'другое': '\u2757',           # ❗
}


def format_social_alert(thread: dict) -> str:
    """Format a social monitor alert (tg_issues score >= 9)."""
    score = thread.get('score', 0)
    topic = thread.get('topic', 'другое')
    emoji = TOPIC_EMOJI.get(topic, '\u2757')
    location = thread.get('location', 'не указана')
    title = thread.get('title', '') or thread.get('summary', '')[:60]
    summary = thread.get('summary', '')
    chat = thread.get('source_chat', '')
    quotes = thread.get('key_quotes', [])
    reasoning = thread.get('reasoning', '')

    lines = [
        f'\U0001f6a8 АЛЕРТ ИСС: {score}/10',
        f'',
        f'{emoji} {title}',
        f'\U0001f4cd {location}',
        f'\U0001f4ac Чат: {chat}',
        f'',
        f'{summary}',
    ]

    if quotes:
        lines.append('')
        lines.append('\U0001f4dd Цитаты:')
        for q in quotes[:3]:
            lines.append(f'  \u2022 \u00ab{q}\u00bb')

    if reasoning:
        lines.append('')
        lines.append(f'\U0001f9e0 {reasoning}')

    lines.append('')
    lines.append(f'#алерт #соцсети #{topic.replace(" ", "_")}')

    return '\n'.join(lines)


def format_isn_alert(data: dict) -> str:
    """Format an ISN alert (ISN index >= 9)."""
    isn_value = data.get('isn_value', 0)
    territory = data.get('territory', 'Общая')
    period = data.get('period', '')
    top_issues = data.get('top_issues', [])

    lines = [
        f'\U0001f6a8 АЛЕРТ ИСН: {isn_value:.1f}/10',
        f'',
        f'\U0001f4cd Территория: {territory}',
        f'\U0001f4c5 Период: {period}',
    ]

    if top_issues:
        lines.append('')
        lines.append('\U0001f525 Острые обращения:')
        for issue in top_issues[:5]:
            score = issue.get('score', 0)
            addr = issue.get('address', '?')
            direction = issue.get('direction', '')
            lines.append(f'  \u2022 [{score}/10] {direction} \u2014 {addr}')

    lines.append('')
    lines.append('#алерт #ИСН')

    return '\n'.join(lines)


def check_isn_alert(supabase_client) -> dict | None:
    """Check if ISN_w >= 9 for recent appeals (last 7 days).
    Returns alert data dict or None."""
    from datetime import datetime, timedelta

    since = (datetime.utcnow() - timedelta(days=7)).strftime('%Y-%m-%d')

    res = supabase_client.table('appeals').select(
        'sentiment_score, direction, address, district, settlement'
    ).gte('date', since).not_.is_('sentiment_score', 'null').eq('is_spam', False).execute()

    appeals = res.data or []
    if not appeals:
        return None

    scores = [a['sentiment_score'] for a in appeals if a['sentiment_score'] and a['sentiment_score'] > 0]
    if not scores:
        return None

    # ISN_w = sum(s^2) / sum(s)
    sum_sq = sum(s * s for s in scores)
    sum_s = sum(scores)
    isn_w = sum_sq / sum_s if sum_s > 0 else 0

    if isn_w < 9:
        return None

    # Top 5 hottest appeals
    hot = sorted(appeals, key=lambda a: a.get('sentiment_score', 0), reverse=True)[:5]
    top_issues = []
    for a in hot:
        addr_parts = [a.get('settlement', ''), a.get('district', ''), a.get('address', '')]
        addr = ', '.join(p for p in addr_parts if p) or '?'
        top_issues.append({
            'score': a.get('sentiment_score', 0),
            'address': addr,
            'direction': a.get('direction', ''),
        })

    return {
        'isn_value': isn_w,
        'territory': 'Общая',
        'period': f'последние 7 дней (с {since})',
        'top_issues': top_issues,
    }


# Track last ISN alert to avoid spam (only alert once per threshold crossing)
_last_isn_alert_value: float | None = None


def should_send_isn_alert(isn_value: float) -> bool:
    """Only send ISN alert once when crossing threshold, not every cycle."""
    global _last_isn_alert_value
    if _last_isn_alert_value is not None and _last_isn_alert_value >= 9:
        # Already alerted while ISN >= 9, skip
        return False
    _last_isn_alert_value = isn_value
    return True


def mark_isn_below_threshold():
    """Reset tracker when ISN drops below 9."""
    global _last_isn_alert_value
    _last_isn_alert_value = None


def format_news_alert(classification: dict, channel_name: str, post_text: str, post_url: str | None = None) -> str:
    """Format a news channel complaint alert."""
    topic = classification.get('topic', 'другое')
    emoji = TOPIC_EMOJI.get(topic, '\u2757')
    severity = classification.get('severity', 0)
    location = classification.get('location', 'не указана')
    summary = classification.get('summary', '')

    lines = [
        f'\U0001f4f0 НОВОСТЬ: {severity}/10',
        f'',
        f'{emoji} {summary}',
        f'\U0001f4cd {location}',
        f'\U0001f4e2 Канал: {channel_name}',
    ]

    # Truncated original text
    preview = post_text[:300]
    if len(post_text) > 300:
        preview += '...'
    lines.append('')
    lines.append(f'\U0001f4c4 {preview}')

    if post_url:
        lines.append('')
        lines.append(f'\U0001f517 {post_url}')

    lines.append('')
    lines.append(f'#новости #{topic.replace(" ", "_")}')

    return '\n'.join(lines)


async def send_alert(client, message: str):
    """Send alert message via Telethon client."""
    try:
        await client.send_message(ALERT_CHAT_ID, message)
        print(f'[alerts] Sent alert to {ALERT_CHAT_ID}')
        return True
    except Exception as e:
        print(f'[alerts] Failed to send: {e}')
        return False
