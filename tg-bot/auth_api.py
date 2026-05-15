"""auth_api — web-driven Telegram userbot authorization.

Exposes three endpoints used by the dashboard's "+ Добавить userbot" wizard:

  POST /auth/start    { draft_id }                  → { status: "code_sent" }
  POST /auth/code     { draft_id, code }            → { status: "done" | "needs_password" }
  POST /auth/password { draft_id, password }        → { status: "done" }

State is held in memory: Pyrogram's Client object + phone_code_hash persist between
calls, keyed by draft_id. If the service restarts mid-flow the user re-runs /start.

Authentication: each request must carry `Authorization: Bearer <supabase_access_token>`.
The service verifies by calling Supabase `/auth/v1/user` with that token — any logged-in
dashboard user is allowed.

Runs on 127.0.0.1:8088 behind nginx at https://socpulse.ru/api/max-auth/.
Env via /etc/tg-bot/auth_api.env.
"""
from __future__ import annotations

import asyncio
import os
import stat
import subprocess
import sys

from aiohttp import web
import httpx
from pyrogram import Client
from pyrogram.errors import SessionPasswordNeeded

import db

WORKDIR = "/opt/tg-bot"
ETC_DIR = "/etc/tg-bot"

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")           # service_role — for DB writes
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", SUPABASE_KEY)  # for user verification

PORT = int(os.getenv("PORT", "8088"))
HOST = os.getenv("HOST", "127.0.0.1")

SHARED_ENV_KEYS = ("SUPABASE_URL", "SUPABASE_KEY", "DEEPSEEK_API_KEY", "TG_API_ID", "TG_API_HASH")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("[auth_api] FATAL: SUPABASE_URL and SUPABASE_KEY must be set")
    sys.exit(1)


# draft_id → { client, phone_code_hash, phone, api_id, api_hash, session_name }
_sessions: dict[int, dict] = {}


def _load_shared_env() -> dict[str, str]:
    path = os.path.join(WORKDIR, ".env")
    if not os.path.exists(path):
        return {}
    out: dict[str, str] = {}
    for line in open(path, encoding="utf-8").read().splitlines():
        if "=" not in line or line.strip().startswith("#"):
            continue
        k, _, v = line.partition("=")
        k = k.strip()
        if k in SHARED_ENV_KEYS:
            out[k] = v.strip()
    return out


def _load_proxy() -> dict | None:
    try:
        rows = db.get_client().table("app_settings").select("key,value").in_(
            "key", ["tg_proxy_type", "tg_proxy_host", "tg_proxy_port", "tg_proxy_username", "tg_proxy_password"],
        ).execute().data or []
    except Exception as e:
        print(f"[auth_api] proxy fetch failed: {e}")
        return None
    cfg = {r["key"]: (r.get("value") or "") for r in rows}
    t = (cfg.get("tg_proxy_type") or "").strip().lower()
    host = (cfg.get("tg_proxy_host") or "").strip()
    port_raw = (cfg.get("tg_proxy_port") or "").strip()
    port = int(port_raw) if port_raw.isdigit() else 0
    if t in ("socks5", "socks4", "http") and host and port:
        d: dict = {"scheme": t, "hostname": host, "port": port}
        user = (cfg.get("tg_proxy_username") or "").strip() or None
        pwd = cfg.get("tg_proxy_password") or None
        if user:
            d["username"] = user
        if pwd:
            d["password"] = pwd
        return d
    return None


def _write_env_file(session_name: str, api_id: int, api_hash: str) -> str:
    path = os.path.join(ETC_DIR, f"{session_name}.env")
    shared = _load_shared_env()
    lines = [
        f"TG_API_ID={api_id}",
        f"TG_API_HASH={api_hash}",
        f"TG_SESSION={session_name}",
    ]
    for k in ("SUPABASE_URL", "SUPABASE_KEY", "DEEPSEEK_API_KEY"):
        if k in shared:
            lines.append(f"{k}={shared[k]}")
    os.makedirs(ETC_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    return path


def _ensure_unit_installed():
    unit_path = "/etc/systemd/system/tg-bot@.service"
    if os.path.exists(unit_path):
        return
    src = os.path.join(WORKDIR, "systemd", "tg-bot@.service")
    if os.path.exists(src):
        subprocess.run(["cp", src, unit_path], check=True)
        subprocess.run(["systemctl", "daemon-reload"], check=True)


def _systemctl_enable_start(session_name: str):
    unit = f"tg-bot@{session_name}.service"
    subprocess.run(["systemctl", "daemon-reload"], check=False)
    subprocess.run(["systemctl", "enable", "--now", unit], check=True)


async def _verify_user(request: web.Request) -> dict | None:
    auth = request.headers.get("Authorization") or ""
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:].strip()
    if not token:
        return None
    try:
        async with httpx.AsyncClient(timeout=10.0) as c:
            r = await c.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={"Authorization": f"Bearer {token}", "apikey": SUPABASE_ANON_KEY},
            )
            if r.status_code != 200:
                return None
            return r.json()
    except Exception as e:
        print(f"[auth_api] verify error: {e}")
        return None


def _json(data, status=200):
    return web.json_response(data, status=status)


def _auth_creds(draft: dict) -> tuple[int, str] | None:
    shared = _load_shared_env()
    api_id = int(draft.get("api_id") or shared.get("TG_API_ID") or 0)
    api_hash = draft.get("api_hash") or shared.get("TG_API_HASH") or ""
    if not api_id or not api_hash:
        return None
    return api_id, api_hash


async def handle_start(request: web.Request):
    user = await _verify_user(request)
    if not user:
        return _json({"error": "unauthorized"}, status=401)
    body = await request.json()
    draft_id = int(body.get("draft_id", 0))
    if not draft_id:
        return _json({"error": "draft_id required"}, status=400)

    res = db.get_client().table("tg_userbot_drafts").select("*").eq("id", draft_id).limit(1).execute()
    if not res.data:
        return _json({"error": "draft not found"}, status=404)
    d = res.data[0]
    if d["status"] == "authorized":
        return _json({"error": "draft already authorized"}, status=400)

    creds = _auth_creds(d)
    if not creds:
        return _json({"error": "TG_API_ID/TG_API_HASH missing"}, status=500)
    api_id, api_hash = creds

    # Clean up any leftover session for this draft
    prev = _sessions.pop(draft_id, None)
    if prev:
        try:
            await prev["client"].disconnect()
        except Exception:
            pass

    kwargs: dict = {"workdir": WORKDIR}
    proxy = _load_proxy()
    if proxy:
        kwargs["proxy"] = proxy

    client = Client(d["session_name"], api_id=api_id, api_hash=api_hash, **kwargs)
    try:
        await client.connect()
        sent = await client.send_code(d["phone"])
    except Exception as e:
        try:
            await client.disconnect()
        except Exception:
            pass
        err = f"{type(e).__name__}: {e}"
        db.get_client().table("tg_userbot_drafts").update({"status": "failed", "error": err[:500]}).eq("id", draft_id).execute()
        return _json({"error": err}, status=400)

    _sessions[draft_id] = {
        "client": client,
        "phone_code_hash": sent.phone_code_hash,
        "phone": d["phone"],
        "api_id": api_id,
        "api_hash": api_hash,
        "session_name": d["session_name"],
    }
    print(f"[auth_api] /start draft={draft_id} phone={d['phone']} — code sent")
    return _json({"status": "code_sent"})


async def handle_code(request: web.Request):
    user = await _verify_user(request)
    if not user:
        return _json({"error": "unauthorized"}, status=401)
    body = await request.json()
    draft_id = int(body.get("draft_id", 0))
    code = (body.get("code") or "").strip()
    if not draft_id or not code:
        return _json({"error": "draft_id and code required"}, status=400)

    s = _sessions.get(draft_id)
    if not s:
        return _json({"error": "no active session — call /start first"}, status=400)
    try:
        await s["client"].sign_in(s["phone"], s["phone_code_hash"], code)
    except SessionPasswordNeeded:
        return _json({"status": "needs_password"})
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        print(f"[auth_api] /code draft={draft_id} error: {err}")
        return _json({"error": err}, status=400)

    return await _finalize(draft_id)


async def handle_password(request: web.Request):
    user = await _verify_user(request)
    if not user:
        return _json({"error": "unauthorized"}, status=401)
    body = await request.json()
    draft_id = int(body.get("draft_id", 0))
    password = body.get("password") or ""
    if not draft_id or not password:
        return _json({"error": "draft_id and password required"}, status=400)

    s = _sessions.get(draft_id)
    if not s:
        return _json({"error": "no active session"}, status=400)
    try:
        await s["client"].check_password(password)
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
        print(f"[auth_api] /password draft={draft_id} error: {err}")
        return _json({"error": err}, status=400)

    return await _finalize(draft_id)


async def _finalize(draft_id: int) -> web.Response:
    s = _sessions.pop(draft_id, None)
    if not s:
        return _json({"error": "no active session"}, status=400)
    client: Client = s["client"]
    try:
        me = await client.get_me()
    except Exception as e:
        err = f"get_me failed: {type(e).__name__}: {e}"
        try:
            await client.disconnect()
        except Exception:
            pass
        db.get_client().table("tg_userbot_drafts").update({"status": "failed", "error": err[:500]}).eq("id", draft_id).execute()
        return _json({"error": err}, status=500)

    try:
        await client.disconnect()
    except Exception:
        pass

    try:
        env_path = _write_env_file(s["session_name"], s["api_id"], s["api_hash"])
        _ensure_unit_installed()
        _systemctl_enable_start(s["session_name"])
    except subprocess.CalledProcessError as e:
        err = f"systemctl failed: {e}"
        db.get_client().table("tg_userbot_drafts").update({"status": "failed", "error": err[:500]}).eq("id", draft_id).execute()
        return _json({"error": err}, status=500)

    db.get_client().table("tg_userbot_drafts").update({
        "status": "authorized",
        "authorized_at": "now()",
        "error": None,
    }).eq("id", draft_id).execute()

    label = " ".join(p for p in [me.first_name, me.last_name] if p) or (f"@{me.username}" if me.username else s["session_name"])
    print(f"[auth_api] draft={draft_id} authorized as {label} (@{me.username})")
    return _json({
        "status": "done",
        "label": label,
        "username": me.username,
        "session_name": s["session_name"],
        "env_path": env_path,
    })


async def handle_healthz(request: web.Request):
    return _json({"ok": True, "sessions_in_flight": len(_sessions)})


def cors_middleware():
    @web.middleware
    async def middleware(request, handler):
        if request.method == "OPTIONS":
            return web.Response(status=200, headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
                "Access-Control-Allow-Headers": "Authorization, Content-Type",
            })
        resp = await handler(request)
        resp.headers["Access-Control-Allow-Origin"] = "*"
        return resp
    return middleware


def make_app() -> web.Application:
    app = web.Application(middlewares=[cors_middleware()])
    app.router.add_post("/auth/start", handle_start)
    app.router.add_post("/auth/code", handle_code)
    app.router.add_post("/auth/password", handle_password)
    app.router.add_get("/healthz", handle_healthz)
    return app


if __name__ == "__main__":
    print(f"[auth_api] listening on {HOST}:{PORT}")
    web.run_app(make_app(), host=HOST, port=PORT, print=None)
