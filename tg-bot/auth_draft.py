"""auth_draft — interactive SMS/2FA auth for a pending userbot draft.

Reads a draft from `tg_userbot_drafts` by id, runs Pyrogram's login flow
(prompting for SMS code and 2FA password on stdin), writes
`/etc/tg-bot/<session_name>.env`, and enables `tg-bot@<session_name>.service`
via systemd. The running bot will then register itself in `tg_userbots` on
startup, and the draft row is moved to status='authorized'.

Run on the VPS (interactive TTY required):
    python /opt/tg-bot/auth_draft.py <draft_id>
"""
from __future__ import annotations

import asyncio
import os
import stat
import subprocess
import sys

from pyrogram import Client

import db


ETC_DIR = "/etc/tg-bot"
WORKDIR = "/opt/tg-bot"

# Shared env bits (Supabase creds) read from existing /opt/tg-bot/.env.
SHARED_ENV_KEYS = ("SUPABASE_URL", "SUPABASE_KEY", "DEEPSEEK_API_KEY", "XAI_API_KEY")


def _load_shared_env() -> dict[str, str]:
    out: dict[str, str] = {}
    path = os.path.join(WORKDIR, ".env")
    if not os.path.exists(path):
        return out
    for line in open(path, encoding="utf-8").read().splitlines():
        if "=" not in line or line.strip().startswith("#"):
            continue
        k, _, v = line.partition("=")
        k = k.strip()
        if k in SHARED_ENV_KEYS:
            out[k] = v.strip()
    return out


def _write_env_file(session_name: str, api_id: int, api_hash: str) -> str:
    path = os.path.join(ETC_DIR, f"{session_name}.env")
    shared = _load_shared_env()
    lines = [
        f"TG_API_ID={api_id}",
        f"TG_API_HASH={api_hash}",
        f"TG_SESSION={session_name}",
    ]
    for k in SHARED_ENV_KEYS:
        if k in shared:
            lines.append(f"{k}={shared[k]}")
    os.makedirs(ETC_DIR, exist_ok=True)
    content = "\n".join(lines) + "\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)  # 600
    return path


def _ensure_unit_installed() -> None:
    """tg-bot@.service template must exist in /etc/systemd/system/."""
    unit_path = "/etc/systemd/system/tg-bot@.service"
    if os.path.exists(unit_path):
        return
    src = os.path.join(WORKDIR, "systemd", "tg-bot@.service")
    if not os.path.exists(src):
        print(f"[auth_draft] WARNING: {src} not found — please place tg-bot@.service in /etc/systemd/system/ manually.")
        return
    subprocess.run(["cp", src, unit_path], check=True)
    subprocess.run(["systemctl", "daemon-reload"], check=True)


def _systemctl_enable_start(session_name: str) -> None:
    unit = f"tg-bot@{session_name}.service"
    subprocess.run(["systemctl", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "enable", "--now", unit], check=True)


async def _run_auth(session_name: str, api_id: int, api_hash: str, phone: str) -> str:
    """Drive Pyrogram's interactive login. Returns 'Label (@username)'."""
    from auth import load_proxy  # reuse proxy config loader
    kwargs: dict = {"workdir": WORKDIR}
    proxy = load_proxy()
    if proxy:
        kwargs["proxy"] = proxy
    async with Client(session_name, api_id=api_id, api_hash=api_hash, phone_number=phone, **kwargs) as app:
        me = await app.get_me()
        label = " ".join(p for p in [me.first_name, me.last_name] if p) or f"@{me.username}" if me.username else session_name
        print(f"[auth_draft] OK: {label} (@{me.username})")
        return label


def main() -> int:
    if len(sys.argv) != 2 or not sys.argv[1].isdigit():
        print("usage: python auth_draft.py <draft_id>")
        return 2
    draft_id = int(sys.argv[1])

    cli = db.get_client()
    res = cli.table("tg_userbot_drafts").select("*").eq("id", draft_id).limit(1).execute()
    if not res.data:
        print(f"[auth_draft] draft {draft_id} not found")
        return 1
    d = res.data[0]
    if d["status"] == "authorized":
        print(f"[auth_draft] draft {draft_id} already authorized")
        return 0

    session_name = d["session_name"]
    api_id = int(d["api_id"])
    api_hash = d["api_hash"]
    phone = d["phone"]

    print(f"[auth_draft] Draft #{draft_id}: label={d['label']!r}, session={session_name!r}, phone={phone}")

    try:
        asyncio.run(_run_auth(session_name, api_id, api_hash, phone))

        env_path = _write_env_file(session_name, api_id, api_hash)
        print(f"[auth_draft] Wrote {env_path}")

        _ensure_unit_installed()
        _systemctl_enable_start(session_name)
        print(f"[auth_draft] systemctl enable --now tg-bot@{session_name}")

        cli.table("tg_userbot_drafts").update({
            "status": "authorized",
            "authorized_at": "now()",
            "error": None,
        }).eq("id", draft_id).execute()
        print(f"[auth_draft] Draft {draft_id} → authorized. Bot is starting; it will register itself in tg_userbots in ~60s.")
        return 0

    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        print(f"[auth_draft] FAILED: {err}")
        try:
            cli.table("tg_userbot_drafts").update({"status": "failed", "error": err[:500]}).eq("id", draft_id).execute()
        except Exception as e2:
            print(f"[auth_draft] (also failed to mark draft as failed: {e2})")
        return 1


if __name__ == "__main__":
    sys.exit(main())
