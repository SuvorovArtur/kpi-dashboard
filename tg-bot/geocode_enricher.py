"""geocode_enricher — geocodes octobot_incidents and flags those inside Mytishi.

Runs as a long-lived systemd service; every POLL_INTERVAL seconds it picks up
incidents with `geocoded_at IS NULL` and (address OR locality) not null, calls
Nominatim (respecting 1 req/s TOS), runs a shapely in-polygon check against the
Mytishi boundary GeoJSON, and writes lat/lon/in_mytishi/geocoded_at back.

`max_bot.forward_new_incidents` then forwards only incidents where
`in_mytishi = true` (or `source_platform='max'`).

Env:
  SUPABASE_URL, SUPABASE_KEY  — Supabase
  BOUNDARY_PATH               — /opt/tg-bot/mytishchi-boundary.geojson
  POLL_INTERVAL               — seconds between poll cycles (default 60)
  BATCH_SIZE                  — max incidents per cycle (default 20)
  NOMINATIM_UA                — User-Agent for Nominatim (default "SocPulse-Enricher/1.0")
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from shapely.geometry import Point, shape
from shapely.ops import unary_union
from supabase import create_client, Client

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
BOUNDARY_PATH = os.getenv("BOUNDARY_PATH", "/opt/tg-bot/mytishchi-boundary.geojson")
CITY_BOUNDARY_PATH = os.getenv("CITY_BOUNDARY_PATH", "/opt/tg-bot/mytishi-city.geojson")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "60"))
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "20"))
NOMINATIM_UA = os.getenv("NOMINATIM_UA", "SocPulse-Enricher/1.0 (max-bot)")
OVERRIDE_CACHE_TTL = 300

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

if not SUPABASE_URL or not SUPABASE_KEY:
    print("[geocode] FATAL: SUPABASE_URL and SUPABASE_KEY must be set")
    sys.exit(1)

db: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Load polygon once at startup.
def _load_boundary():
    p = Path(BOUNDARY_PATH)
    if not p.exists():
        print(f"[geocode] FATAL: boundary file missing: {p}")
        sys.exit(1)
    geo = json.loads(p.read_text(encoding="utf-8"))
    geoms = []
    if geo.get("type") == "FeatureCollection":
        for f in geo.get("features", []):
            geoms.append(shape(f["geometry"]))
    elif geo.get("type") == "GeometryCollection":
        for g in geo.get("geometries", []):
            geoms.append(shape(g))
    elif geo.get("type") in ("Polygon", "MultiPolygon"):
        geoms.append(shape(geo))
    elif geo.get("type") == "Feature":
        geoms.append(shape(geo["geometry"]))
    else:
        print(f"[geocode] FATAL: unknown geojson type: {geo.get('type')}")
        sys.exit(1)
    if not geoms:
        print("[geocode] FATAL: no geometries in boundary file")
        sys.exit(1)
    return unary_union(geoms)


BOUNDARY = _load_boundary()
print(f"[geocode] Boundary loaded from {BOUNDARY_PATH} (bounds={BOUNDARY.bounds})")


def _load_city_boundary():
    """City-of-Мытищи polygon for is_city classification. Optional — if missing,
    is_city stays NULL and the forwarder treats everything as rural."""
    p = Path(CITY_BOUNDARY_PATH)
    if not p.exists():
        print(f"[geocode] city boundary file missing at {p}; is_city will be NULL")
        return None
    geo = json.loads(p.read_text(encoding="utf-8"))
    try:
        return shape(geo["geometry"]) if geo.get("type") == "Feature" else shape(geo)
    except Exception as e:
        print(f"[geocode] failed to parse city boundary: {e}")
        return None


CITY_BOUNDARY = _load_city_boundary()
if CITY_BOUNDARY:
    print(f"[geocode] City boundary loaded (bounds={CITY_BOUNDARY.bounds})")


_overrides_cache: list[str] = []
_overrides_loaded_at = 0.0

_settlements_cache: list[str] = []  # already normalized (lowercased, prefixes stripped)
_settlements_loaded_at = 0.0


# Common locality prefixes from Russian civic addressing. Order matters: longer /
# dotted forms first so ``"пос."`` is stripped before ``"п."``.
_LOCALITY_PREFIXES = (
    "деревня", "посёлок", "поселок", "село", "микрорайон",
    "мкр.", "мкр",
    "пос.", "пос", "п.",
    "д.", "д",
    "с.", "с",
    "ж/к", "жк.", "жк",
)


def _normalize_locality(s: str | None) -> str:
    """Lowercase, trim, and strip a leading locality-type prefix (д./пос./мкр. etc.)."""
    if not s:
        return ""
    n = s.strip().lower().replace("ё", "е")
    # Strip punctuation-run at the start so ", д. Беляниново" → "д. Беляниново" → "беляниново"
    n = n.lstrip(" ,.;:-")
    for p in _LOCALITY_PREFIXES:
        if n.startswith(p + " ") or n == p:
            n = n[len(p):].strip(" ,.")
            break
        # Bare form without trailing space ("д.Беляниново") — strip if next char is letter
        if n.startswith(p) and len(n) > len(p) and not n[len(p)].isspace() and n[len(p)] not in ",.":
            # Only strip if the prefix ends with a punctuation char (д., пос.), otherwise
            # risk eating real letters from word like "деревня" — handled by earlier branch.
            if p.endswith(".") or p.endswith("/"):
                n = n[len(p):].strip(" ,.")
                break
    return n.strip()


def _load_overrides() -> list[str]:
    """Cache active rural-override patterns for 5 minutes."""
    global _overrides_cache, _overrides_loaded_at
    now = time.time()
    if _overrides_cache and now - _overrides_loaded_at < OVERRIDE_CACHE_TTL:
        return _overrides_cache
    try:
        res = db.table("mytishi_rural_overrides").select("pattern").eq("is_active", True).execute()
        _overrides_cache = [(r["pattern"] or "").strip().lower() for r in (res.data or []) if r.get("pattern")]
        _overrides_loaded_at = now
        print(f"[geocode] loaded {len(_overrides_cache)} rural override pattern(s)")
    except Exception as e:
        print(f"[geocode] overrides fetch error: {e}")
    return _overrides_cache


def _load_settlements() -> list[str]:
    """Cache active Mytishi settlements (names lowercased, normalized)."""
    global _settlements_cache, _settlements_loaded_at
    now = time.time()
    if _settlements_cache and now - _settlements_loaded_at < OVERRIDE_CACHE_TTL:
        return _settlements_cache
    try:
        res = db.table("mytishi_settlements").select("name").eq("is_active", True).execute()
        names = [_normalize_locality(r["name"]) for r in (res.data or []) if r.get("name")]
        # Sort longer names first so "нижнее беляниново" matches before "беляниново"
        _settlements_cache = sorted({n for n in names if n}, key=len, reverse=True)
        _settlements_loaded_at = now
        print(f"[geocode] loaded {len(_settlements_cache)} mytishi settlement(s)")
    except Exception as e:
        print(f"[geocode] settlements fetch error: {e}")
    return _settlements_cache


def _settlement_match(inc: dict, settlements: list[str]) -> str | None:
    """Return the matched settlement name if incident's locality/address contains one
    as a whole word (prevents 'Новомытищинского' matching 'Мытищи')."""
    blob = " ".join(str(inc.get(k) or "") for k in ("locality", "address")).lower().replace("ё", "е")
    if not blob.strip():
        return None
    norm_locality = _normalize_locality(inc.get("locality"))
    for s in settlements:
        if not s:
            continue
        # Exact match on normalized locality is the strongest signal.
        if norm_locality == s:
            return s
        # Otherwise require whole-word occurrence (Unicode-aware \b via re.UNICODE).
        pattern = r"(?<!\w)" + re.escape(s) + r"(?!\w)"
        if re.search(pattern, blob, flags=re.UNICODE):
            return s
    return None


def _rural_override_matches(inc: dict, patterns: list[str]) -> bool:
    blob = " ".join(str(inc.get(k) or "") for k in ("locality", "address", "summary")).lower()
    return any(p and p in blob for p in patterns)


GPS_RE = re.compile(r"(5[56]\.\d{4,})\s*[,;]\s*(3[67]\.\d{4,})")


def extract_gps(text: str | None) -> tuple[float, float] | None:
    if not text:
        return None
    m = GPS_RE.search(text)
    if not m:
        return None
    return float(m.group(1)), float(m.group(2))


_STREET_PREFIX_RE = re.compile(
    r"^(ул\.|улица|пр-т|проспект|проезд|пер\.|переулок|ш\.|шоссе|б-р|бульвар|наб\.|набережная|пл\.|площадь)\s+",
    re.IGNORECASE,
)


def _simplify_address(addr: str) -> str:
    """Strip street-type prefix and корпус suffix so Nominatim can find the building.
    "ул. Малая Бородинская, 1к3" → "Малая Бородинская, 1"."""
    s = _STREET_PREFIX_RE.sub("", addr).strip()
    # Drop корпус ("1к3" → "1", "12к2" → "12", "1/к3" → "1"). Keep литера ("5А" stays).
    s = re.sub(r"(\d+)\s*[кК]\s*\d+", r"\1", s)
    return s


def build_queries(inc: dict) -> list[str]:
    """Return an ordered list of Nominatim queries to try, most specific first.
    The caller stops at the first successful hit. Always anchored to Московская область."""
    address = (inc.get("address") or "").strip()
    locality_raw = (inc.get("locality") or "").strip()
    locality_norm = _normalize_locality(locality_raw)
    settlements = _load_settlements()
    # Settlement-aware hint: if locality is a known village → use it; else «Мытищи».
    loc_hint = locality_norm if (locality_norm and locality_norm in settlements) else "Мытищи"

    queries: list[str] = []
    if address and re.search(r"\d", address):
        simple = _simplify_address(address)
        # 1. Full address + hint
        queries.append(f"{address}, {loc_hint}, Московская область")
        # 2. Simplified address (no prefix, no корпус) + hint
        if simple and simple != address:
            queries.append(f"{simple}, {loc_hint}, Московская область")
        # 3. Address without locality hint — last resort
        queries.append(f"{simple or address}, Мытищи, Московская область")
    else:
        # Locality-only queries
        locality_for_query = (locality_norm or locality_raw).strip()
        if locality_for_query:
            queries.append(f"{locality_for_query}, Мытищинский городской округ, Московская область")
        if address:
            queries.append(f"{address}, Мытищинский городской округ, Московская область")
    # De-dup preserving order
    seen: set[str] = set()
    return [q for q in queries if not (q in seen or seen.add(q))]


async def nominatim(query: str, client: httpx.AsyncClient) -> tuple[float, float] | None:
    try:
        r = await client.get(
            NOMINATIM_URL,
            params={
                "q": query, "format": "json", "limit": "1",
                "countrycodes": "ru", "accept-language": "ru",
            },
            headers={"User-Agent": NOMINATIM_UA},
            timeout=20.0,
        )
        if r.status_code != 200:
            print(f"[geocode] nominatim {r.status_code}: {r.text[:150]}")
            return None
        data = r.json()
        if not data:
            return None
        return float(data[0]["lat"]), float(data[0]["lon"])
    except Exception as e:
        print(f"[geocode] nominatim error: {type(e).__name__}: {e}")
        return None


async def enrich_batch():
    res = db.table("octobot_incidents") \
        .select("id, address, locality, summary") \
        .is_("geocoded_at", "null") \
        .or_("address.not.is.null,locality.not.is.null") \
        .order("created_at", desc=True) \
        .limit(BATCH_SIZE).execute()

    rows = res.data or []
    if not rows:
        return 0

    patterns = _load_overrides()
    settlements = _load_settlements()
    print(f"[geocode] Processing {len(rows)} incidents")
    now_iso = datetime.now(tz=timezone.utc).isoformat()

    async with httpx.AsyncClient() as client:
        for inc in rows:
            inc_id = inc["id"]
            # 1) Try GPS from summary
            gps = extract_gps(inc.get("summary"))
            source = "description_gps" if gps else None

            # 2) Fall back to Nominatim — try progressively simpler queries.
            if not gps:
                import asyncio
                for q in build_queries(inc):
                    gps = await nominatim(q, client)
                    # Rate-limit Nominatim to 1 req/s per their TOS
                    await asyncio.sleep(1.1)
                    if gps:
                        source = "nominatim"
                        break

            rural_override = _rural_override_matches(inc, patterns)

            update: dict = {"geocoded_at": now_iso, "rural_override": rural_override}
            if gps:
                lat, lon = gps
                pt = Point(lon, lat)
                in_mytishi = bool(BOUNDARY.contains(pt))
                is_city = bool(CITY_BOUNDARY.contains(pt)) if CITY_BOUNDARY else None
                update.update({
                    "lat": lat, "lon": lon,
                    "in_mytishi": in_mytishi,
                    "is_city": is_city,
                    "geocode_source": source,
                })
                print(f"[geocode] #{inc_id}: {lat:.5f},{lon:.5f} in_mytishi={in_mytishi} is_city={is_city} rural_override={rural_override} ({source})")
            else:
                update["geocode_source"] = "failed"
                update["in_mytishi"] = False
                update["is_city"] = None
                # Fallback 1: rural-override pattern matched — trust it.
                if rural_override:
                    update["in_mytishi"] = True
                # Fallback 2: locality text matches a known Mytishi settlement. No GPS
                # but we know the округ — good enough for the MAX-bot gate.
                matched = _settlement_match(inc, settlements)
                if matched:
                    update["in_mytishi"] = True
                    update["geocode_source"] = "settlement_name"
                print(f"[geocode] #{inc_id}: geocode failed (rural_override={rural_override}, settlement={matched})")

            try:
                db.table("octobot_incidents").update(update).eq("id", inc_id).execute()
            except Exception as e:
                print(f"[geocode] #{inc_id} DB write error: {e}")

    return len(rows)


async def main():
    import asyncio
    print(f"[geocode] enricher started: poll every {POLL_INTERVAL}s, batch {BATCH_SIZE}")
    while True:
        try:
            await enrich_batch()
        except Exception as e:
            print(f"[geocode] batch error: {type(e).__name__}: {e}")
        await asyncio.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
