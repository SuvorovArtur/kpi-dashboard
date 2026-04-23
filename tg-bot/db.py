"""Supabase operations for social monitor."""
from supabase import create_client
from config import SUPABASE_URL, SUPABASE_KEY

_client = None

def get_client():
    global _client
    if _client is None:
        _client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _client


def get_active_chats() -> list[dict]:
    """Get list of active monitored chats."""
    res = get_client().table('tg_chats').select('*').eq('is_active', True).execute()
    return res.data or []


def save_message(chat_id: int, message_id: int, date: str, sender_name: str | None, text: str, reply_to_id: int | None):
    """Save a message, skip if already exists."""
    get_client().table('tg_messages').upsert({
        'chat_id': chat_id,
        'message_id': message_id,
        'date': date,
        'sender_name': sender_name,
        'text': text,
        'reply_to_id': reply_to_id,
    }, on_conflict='chat_id,message_id').execute()


def get_unanalyzed_messages(limit: int = 50) -> list[dict]:
    """Get recent messages not yet linked to any issue."""
    res = get_client().rpc('get_unanalyzed_messages', {'msg_limit': limit}).execute()
    return res.data or []


def save_issue(title: str, summary: str, severity: int, direction: str | None, location: str | None, message_ids: list[int]):
    """Create or update an issue and link messages."""
    issue = get_client().table('tg_issues').insert({
        'title': title,
        'summary': summary,
        'severity': severity,
        'direction': direction,
        'location': location,
        'first_seen': 'now()',
        'last_seen': 'now()',
        'message_count': len(message_ids),
    }).execute()

    if issue.data:
        issue_id = issue.data[0]['id']
        links = [{'issue_id': issue_id, 'message_id': mid} for mid in message_ids]
        if links:
            get_client().table('tg_issue_messages').upsert(links).execute()
        return issue_id
    return None


def update_issue(issue_id: int, message_ids: list[int], summary: str | None = None, severity: int | None = None):
    """Add messages to existing issue, update counts."""
    update = {
        'last_seen': 'now()',
        'updated_at': 'now()',
    }
    if summary:
        update['summary'] = summary
    if severity:
        update['severity'] = severity

    # Update message count
    existing = get_client().table('tg_issue_messages').select('message_id').eq('issue_id', issue_id).execute()
    existing_ids = {r['message_id'] for r in (existing.data or [])}
    new_ids = [mid for mid in message_ids if mid not in existing_ids]
    update['message_count'] = len(existing_ids) + len(new_ids)

    get_client().table('tg_issues').update(update).eq('id', issue_id).execute()

    if new_ids:
        links = [{'issue_id': issue_id, 'message_id': mid} for mid in new_ids]
        get_client().table('tg_issue_messages').upsert(links).execute()


def get_active_issues() -> list[dict]:
    """Get active issues for matching."""
    res = get_client().table('tg_issues').select('*').in_('status', ['new', 'watching', 'escalated']).order('last_seen', desc=True).limit(50).execute()
    return res.data or []


def mark_analyzed(message_ids: list[int]):
    """Mark messages as analyzed so they won't be picked up again."""
    if not message_ids:
        return
    get_client().table('tg_messages').update({'analyzed_at': 'now()'}).in_('id', message_ids).execute()


def register_userbot(session_name: str, label: str, phone: str | None, api_id_hint: str | None) -> int | None:
    """Upsert this userbot's row in tg_userbots and return its id. Called at startup."""
    res = get_client().table('tg_userbots').upsert({
        'session_name': session_name,
        'label': label,
        'phone': phone,
        'api_id_hint': api_id_hint,
        'is_active': True,
        'last_seen_at': 'now()',
    }, on_conflict='session_name').execute()
    if res.data:
        return res.data[0]['id']
    sel = get_client().table('tg_userbots').select('id').eq('session_name', session_name).maybeSingle().execute()
    return sel.data['id'] if sel.data else None


def heartbeat_userbot(userbot_id: int):
    """Update last_seen_at — called once a minute from periodic_tasks."""
    if not userbot_id:
        return
    get_client().table('tg_userbots').update({'last_seen_at': 'now()'}).eq('id', userbot_id).execute()


def claim_untagged_chats(userbot_id: int, chat_ids: list[int]):
    """For chats monitored by this bot that still have userbot_id IS NULL, set it to us.
    Does NOT overwrite chats already tagged to a different bot — those are someone else's."""
    if not userbot_id or not chat_ids:
        return
    get_client().table('tg_chats').update({'userbot_id': userbot_id}) \
        .in_('chat_id', chat_ids).is_('userbot_id', 'null').execute()
