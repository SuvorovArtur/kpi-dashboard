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


-- ontology object: kp v0.1.0

CREATE TABLE IF NOT EXISTS ontology.kp (
    id uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    seq bigserial UNIQUE NOT NULL,
    number text GENERATED ALWAYS AS ('МЫТ-КП-' || lpad(seq::text, 4, '0')) STORED,
    settlement text NOT NULL,
    geom geometry(Point, 4326) NOT NULL,
    registry_number text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kp_geom ON ontology.kp USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_kp_settlement ON ontology.kp (settlement);
CREATE INDEX IF NOT EXISTS idx_kp_registry ON ontology.kp (registry_number) WHERE registry_number IS NOT NULL;

ALTER TABLE ontology.kp ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS read_all_authenticated ON ontology.kp;
CREATE POLICY read_all_authenticated ON ontology.kp FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION ontology.kp_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS kp_touch_updated_at ON ontology.kp;
CREATE TRIGGER kp_touch_updated_at
    BEFORE UPDATE ON ontology.kp
    FOR EACH ROW EXECUTE FUNCTION ontology.kp_touch_updated_at();


CREATE OR REPLACE FUNCTION ontology.kp_emit_event()
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
        VALUES ('kp', NEW.id, 'kp_created', v_actor_id, v_actor_role, to_jsonb(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO ontology.events (object_type, object_id, event_type, actor_id, actor_role, payload)
        VALUES ('kp', NEW.id, 'kp_updated', v_actor_id, v_actor_role,
                jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW)));
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO ontology.events (object_type, object_id, event_type, actor_id, actor_role, payload)
        VALUES ('kp', OLD.id, 'kp_deleted', v_actor_id, v_actor_role, to_jsonb(OLD));
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS kp_emit_event ON ontology.kp;
CREATE TRIGGER kp_emit_event
    AFTER INSERT OR UPDATE OR DELETE ON ontology.kp
    FOR EACH ROW EXECUTE FUNCTION ontology.kp_emit_event();


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


CREATE OR REPLACE FUNCTION public.ontology_kp_create(
    p_settlement text,
    p_lat double precision,
    p_lng double precision,
    p_registry_number text DEFAULT NULL
) RETURNS ontology.kp
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, ontology
AS $$
DECLARE r ontology.kp;
BEGIN
    PERFORM ontology._assert_role(ARRAY['editor', 'admin']);
    INSERT INTO ontology.kp (settlement, geom, registry_number)
    VALUES (
        p_settlement,
        ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326),
        NULLIF(p_registry_number, '')
    )
    RETURNING * INTO r;
    RETURN r;
END $$;
GRANT EXECUTE ON FUNCTION public.ontology_kp_create(text, double precision, double precision, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.ontology_kp_move(
    p_id uuid, p_lat double precision, p_lng double precision
) RETURNS ontology.kp
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, ontology
AS $$
DECLARE r ontology.kp;
BEGIN
    PERFORM ontology._assert_role(ARRAY['editor', 'admin']);
    UPDATE ontology.kp
       SET geom = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)
     WHERE id = p_id
    RETURNING * INTO r;
    IF r.id IS NULL THEN RAISE EXCEPTION 'kp not found: %', p_id; END IF;
    RETURN r;
END $$;
GRANT EXECUTE ON FUNCTION public.ontology_kp_move(uuid, double precision, double precision) TO authenticated;

CREATE OR REPLACE FUNCTION public.ontology_kp_rename_settlement(
    p_id uuid, p_settlement text
) RETURNS ontology.kp
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, ontology
AS $$
DECLARE r ontology.kp;
BEGIN
    PERFORM ontology._assert_role(ARRAY['editor', 'admin']);
    UPDATE ontology.kp SET settlement = p_settlement WHERE id = p_id RETURNING * INTO r;
    IF r.id IS NULL THEN RAISE EXCEPTION 'kp not found: %', p_id; END IF;
    RETURN r;
END $$;
GRANT EXECUTE ON FUNCTION public.ontology_kp_rename_settlement(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.ontology_kp_set_registry(
    p_id uuid, p_registry_number text
) RETURNS ontology.kp
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, ontology
AS $$
DECLARE r ontology.kp;
BEGIN
    PERFORM ontology._assert_role(ARRAY['editor', 'admin']);
    UPDATE ontology.kp SET registry_number = NULLIF(p_registry_number, '')
     WHERE id = p_id RETURNING * INTO r;
    IF r.id IS NULL THEN RAISE EXCEPTION 'kp not found: %', p_id; END IF;
    RETURN r;
END $$;
GRANT EXECUTE ON FUNCTION public.ontology_kp_set_registry(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.ontology_kp_delete(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, ontology
AS $$
BEGIN
    PERFORM ontology._assert_role(ARRAY['admin']);
    DELETE FROM ontology.kp WHERE id = p_id;
    RETURN p_id;
END $$;
GRANT EXECUTE ON FUNCTION public.ontology_kp_delete(uuid) TO authenticated;

