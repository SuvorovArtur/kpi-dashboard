#!/usr/bin/env python3
"""Ontology codegen v0.1.

Reads ontology/*.yaml — currently only kp.yaml — and emits:
    supabase/migrations/<timestamp>__ontology_<object>_v<version>.sql
    src/shared/types/ontology.ts

The generator is intentionally pragmatic for the MVP:
    - One object per YAML, single emit per run
    - Idempotent SQL (CREATE … IF NOT EXISTS / OR REPLACE)
    - Knows enough about KP shape; will be generalised when the second
      ontology object lands.

Usage:
    python -m tools.ontology_gen ontology/kp.yaml

Re-run after editing the YAML. Review the generated SQL before applying;
this is semi-auto (no DROP-by-diff yet).
"""
from __future__ import annotations

import sys
import textwrap
from datetime import datetime, timezone
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = ROOT / "supabase" / "migrations"
TS_OUT = ROOT / "src" / "shared" / "types" / "ontology.ts"


# ---------------------------------------------------------------------------
# SQL — bootstrap shared bits (schema, events, postgis)
# ---------------------------------------------------------------------------

BOOTSTRAP_SQL = """\
-- Ontology bootstrap. Idempotent — safe to re-apply.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE SCHEMA IF NOT EXISTS ontology;

GRANT USAGE ON SCHEMA ontology TO authenticated, anon, service_role;

CREATE TABLE IF NOT EXISTS ontology.events (
    id           bigserial PRIMARY KEY,
    object_type  text NOT NULL,
    object_id    uuid NOT NULL,
    event_type   text NOT NULL,
    actor_id     uuid,
    actor_role   text,
    payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ontology_events_object
    ON ontology.events (object_type, object_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_ontology_events_created
    ON ontology.events (created_at DESC);

ALTER TABLE ontology.events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS read_events ON ontology.events;
CREATE POLICY read_events ON ontology.events
    FOR SELECT TO authenticated USING (true);
"""


# ---------------------------------------------------------------------------
# SQL emission for a single object
# ---------------------------------------------------------------------------

def emit_object_sql(spec: dict) -> str:
    schema = spec["schema"]
    table = spec["table"]
    fq = f"{schema}.{table}"
    object_type = spec["object"]
    props = spec["properties"]

    # column DDL
    col_lines: list[str] = []
    for name, p in props.items():
        if name == "geom":
            col_lines.append(f"    geom geometry(Point, {p['srid']}) NOT NULL")
            continue
        if p.get("generated"):
            col_lines.append(f"    {name} text GENERATED ALWAYS AS ({p['generated']}) STORED")
            continue
        sql_type = p["type"]
        if sql_type == "uuid":
            line = f"    {name} uuid"
        elif sql_type == "bigserial":
            line = f"    {name} bigserial"
        elif sql_type == "text":
            line = f"    {name} text"
        elif sql_type == "timestamptz":
            line = f"    {name} timestamptz"
        else:
            raise ValueError(f"unknown type {sql_type!r} for {name}")
        if p.get("primary_key"):
            line += " PRIMARY KEY"
        if p.get("unique"):
            line += " UNIQUE"
        if not p.get("nullable", True):
            line += " NOT NULL"
        if p.get("default"):
            line += f" DEFAULT {p['default']}"
        col_lines.append(line)

    table_ddl = (
        f"CREATE TABLE IF NOT EXISTS {fq} (\n"
        + ",\n".join(col_lines)
        + "\n);"
    )

    # spatial index for geom
    idx_lines: list[str] = [
        f"CREATE INDEX IF NOT EXISTS idx_{table}_geom ON {fq} USING GIST (geom);"
    ]
    for ix in spec.get("indexes", []):
        cols = ", ".join(ix["columns"])
        where = f" WHERE {ix['where']}" if ix.get("where") else ""
        idx_lines.append(
            f"CREATE INDEX IF NOT EXISTS {ix['name']} ON {fq} ({cols}){where};"
        )

    # RLS
    rls_lines: list[str] = []
    if spec.get("rls", {}).get("enable"):
        rls_lines.append(f"ALTER TABLE {fq} ENABLE ROW LEVEL SECURITY;")
        for pol in spec["rls"]["policies"]:
            rls_lines.append(f"DROP POLICY IF EXISTS {pol['name']} ON {fq};")
            roles = ", ".join(pol["roles"])
            rls_lines.append(
                f"CREATE POLICY {pol['name']} ON {fq} "
                f"FOR {pol['op']} TO {roles} USING ({pol['using']});"
            )

    # updated_at trigger (auto-bump)
    upd_trigger = textwrap.dedent(f"""\
        CREATE OR REPLACE FUNCTION {schema}.{table}_touch_updated_at()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            NEW.updated_at := now();
            RETURN NEW;
        END;
        $$;
        DROP TRIGGER IF EXISTS {table}_touch_updated_at ON {fq};
        CREATE TRIGGER {table}_touch_updated_at
            BEFORE UPDATE ON {fq}
            FOR EACH ROW EXECUTE FUNCTION {schema}.{table}_touch_updated_at();
    """)

    # event trigger — append a row to ontology.events on every INSERT/UPDATE/DELETE
    ev_trigger = textwrap.dedent(f"""\
        CREATE OR REPLACE FUNCTION {schema}.{table}_emit_event()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE
            v_actor_id uuid;
            v_actor_role text;
        BEGIN
            BEGIN
                v_actor_id := auth.uid();
            EXCEPTION WHEN OTHERS THEN v_actor_id := NULL;
            END;
            BEGIN
                v_actor_role := current_setting('request.jwt.claims', true)::jsonb->>'role';
            EXCEPTION WHEN OTHERS THEN v_actor_role := NULL;
            END;
            IF TG_OP = 'INSERT' THEN
                INSERT INTO ontology.events (object_type, object_id, event_type, actor_id, actor_role, payload)
                VALUES ('{object_type}', NEW.id, '{object_type}_created', v_actor_id, v_actor_role, to_jsonb(NEW));
                RETURN NEW;
            ELSIF TG_OP = 'UPDATE' THEN
                INSERT INTO ontology.events (object_type, object_id, event_type, actor_id, actor_role, payload)
                VALUES ('{object_type}', NEW.id, '{object_type}_updated', v_actor_id, v_actor_role,
                        jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW)));
                RETURN NEW;
            ELSIF TG_OP = 'DELETE' THEN
                INSERT INTO ontology.events (object_type, object_id, event_type, actor_id, actor_role, payload)
                VALUES ('{object_type}', OLD.id, '{object_type}_deleted', v_actor_id, v_actor_role, to_jsonb(OLD));
                RETURN OLD;
            END IF;
            RETURN NULL;
        END;
        $$;
        DROP TRIGGER IF EXISTS {table}_emit_event ON {fq};
        CREATE TRIGGER {table}_emit_event
            AFTER INSERT OR UPDATE OR DELETE ON {fq}
            FOR EACH ROW EXECUTE FUNCTION {schema}.{table}_emit_event();
    """)

    # Actions — RPC functions (SECURITY DEFINER + role check)
    rpc_blocks: list[str] = []
    for action_name, a in spec["actions"].items():
        roles_array = "ARRAY[" + ", ".join(f"'{r}'" for r in a["roles"]) + "]"
        if action_name == "create":
            rpc_blocks.append(textwrap.dedent(f"""\
                CREATE OR REPLACE FUNCTION public.{a['name']}(
                    p_settlement text,
                    p_lat double precision,
                    p_lng double precision,
                    p_registry_number text DEFAULT NULL
                ) RETURNS {fq}
                LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, ontology
                AS $$
                DECLARE r {fq};
                BEGIN
                    PERFORM ontology._assert_role({roles_array});
                    INSERT INTO {fq} (settlement, geom, registry_number)
                    VALUES (
                        p_settlement,
                        ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326),
                        NULLIF(p_registry_number, '')
                    )
                    RETURNING * INTO r;
                    RETURN r;
                END $$;
                GRANT EXECUTE ON FUNCTION public.{a['name']}(text, double precision, double precision, text) TO authenticated;
            """))
        elif action_name == "move":
            rpc_blocks.append(textwrap.dedent(f"""\
                CREATE OR REPLACE FUNCTION public.{a['name']}(
                    p_id uuid, p_lat double precision, p_lng double precision
                ) RETURNS {fq}
                LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, ontology
                AS $$
                DECLARE r {fq};
                BEGIN
                    PERFORM ontology._assert_role({roles_array});
                    UPDATE {fq}
                       SET geom = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)
                     WHERE id = p_id
                    RETURNING * INTO r;
                    IF r.id IS NULL THEN RAISE EXCEPTION 'kp not found: %', p_id; END IF;
                    RETURN r;
                END $$;
                GRANT EXECUTE ON FUNCTION public.{a['name']}(uuid, double precision, double precision) TO authenticated;
            """))
        elif action_name == "rename_settlement":
            rpc_blocks.append(textwrap.dedent(f"""\
                CREATE OR REPLACE FUNCTION public.{a['name']}(
                    p_id uuid, p_settlement text
                ) RETURNS {fq}
                LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, ontology
                AS $$
                DECLARE r {fq};
                BEGIN
                    PERFORM ontology._assert_role({roles_array});
                    UPDATE {fq} SET settlement = p_settlement WHERE id = p_id RETURNING * INTO r;
                    IF r.id IS NULL THEN RAISE EXCEPTION 'kp not found: %', p_id; END IF;
                    RETURN r;
                END $$;
                GRANT EXECUTE ON FUNCTION public.{a['name']}(uuid, text) TO authenticated;
            """))
        elif action_name == "set_registry":
            rpc_blocks.append(textwrap.dedent(f"""\
                CREATE OR REPLACE FUNCTION public.{a['name']}(
                    p_id uuid, p_registry_number text
                ) RETURNS {fq}
                LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, ontology
                AS $$
                DECLARE r {fq};
                BEGIN
                    PERFORM ontology._assert_role({roles_array});
                    UPDATE {fq} SET registry_number = NULLIF(p_registry_number, '')
                     WHERE id = p_id RETURNING * INTO r;
                    IF r.id IS NULL THEN RAISE EXCEPTION 'kp not found: %', p_id; END IF;
                    RETURN r;
                END $$;
                GRANT EXECUTE ON FUNCTION public.{a['name']}(uuid, text) TO authenticated;
            """))
        elif action_name == "delete":
            rpc_blocks.append(textwrap.dedent(f"""\
                CREATE OR REPLACE FUNCTION public.{a['name']}(p_id uuid)
                RETURNS uuid
                LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, ontology
                AS $$
                BEGIN
                    PERFORM ontology._assert_role({roles_array});
                    DELETE FROM {fq} WHERE id = p_id;
                    RETURN p_id;
                END $$;
                GRANT EXECUTE ON FUNCTION public.{a['name']}(uuid) TO authenticated;
            """))

    # role assertion helper (shared)
    assert_role = textwrap.dedent("""\
        CREATE OR REPLACE FUNCTION ontology._assert_role(p_allowed text[])
        RETURNS void LANGUAGE plpgsql AS $$
        DECLARE
            my_role text;
        BEGIN
            SELECT role INTO my_role FROM public.user_profiles WHERE id = auth.uid();
            IF my_role IS NULL OR NOT (my_role = ANY(p_allowed)) THEN
                RAISE EXCEPTION 'forbidden (role %, need one of %)', COALESCE(my_role, 'none'), p_allowed
                    USING ERRCODE = '42501';
            END IF;
        END $$;
    """)

    return "\n\n".join([
        f"-- ontology object: {object_type} v{spec['version']}",
        table_ddl,
        "\n".join(idx_lines),
        "\n".join(rls_lines) if rls_lines else "",
        upd_trigger,
        ev_trigger,
        assert_role,
        "\n".join(rpc_blocks),
    ])


# ---------------------------------------------------------------------------
# TypeScript types
# ---------------------------------------------------------------------------

TS_TEMPLATE = """\
// AUTO-GENERATED by tools/ontology_gen.py — do not edit by hand.
// Source: ontology/{source}

export interface Kp {{
  id: string;
  seq: number;
  number: string;          // {label_number}
  settlement: string;      // {label_settlement}
  // PostGIS geometry comes through PostgREST as GeoJSON when queried via
  // `select=...,geom::geojson` or hydrated by RPCs. UI keeps lat/lng split
  // for ergonomics; the canonical form lives in `geom`.
  lat: number;
  lng: number;
  registry_number: string | null;  // {label_registry}
  created_at: string;
  updated_at: string;
}}

export interface KpCreateInput {{
  settlement: string;
  lat: number;
  lng: number;
  registry_number?: string | null;
}}
"""


def emit_ts(spec: dict, source_filename: str) -> str:
    props = spec["properties"]
    return TS_TEMPLATE.format(
        source=source_filename,
        label_number=props["number"].get("label_ru", "Номер"),
        label_settlement=props["settlement"].get("label_ru", "Населённый пункт"),
        label_registry=props["registry_number"].get("label_ru", "Реестровый номер"),
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2

    src = Path(argv[1])
    spec = yaml.safe_load(src.read_text())

    object_name = spec["object"]
    version = spec["version"].replace(".", "")

    ts_dt = datetime.now(tz=timezone.utc).strftime("%Y%m%d%H%M%S")
    out_sql = MIGRATIONS_DIR / f"{ts_dt}_ontology_{object_name}_v{version}.sql"
    out_sql.parent.mkdir(parents=True, exist_ok=True)

    sql = BOOTSTRAP_SQL + "\n\n" + emit_object_sql(spec) + "\n"
    out_sql.write_text(sql)
    print(f"[ontology_gen] wrote {out_sql.relative_to(ROOT)} ({len(sql)} bytes)")

    TS_OUT.parent.mkdir(parents=True, exist_ok=True)
    TS_OUT.write_text(emit_ts(spec, src.name))
    print(f"[ontology_gen] wrote {TS_OUT.relative_to(ROOT)}")

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
