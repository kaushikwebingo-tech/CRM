-- Corrections to bring the schema in line with the Foundation Plan.
-- Safe to run against a database that already has 0001/0002 applied.

CREATE EXTENSION IF NOT EXISTS "citext";

-- 1. Case-insensitive email. Plan Section 4 "Identity and tenancy": `email citext`.
--    Collapse any existing case-variant duplicates first so the unique constraint holds.
UPDATE users u
   SET email = lower(u.email)
 WHERE u.email <> lower(u.email)
   AND NOT EXISTS (
     SELECT 1 FROM users o
      WHERE o.org_id = u.org_id AND o.id <> u.id AND lower(o.email) = lower(u.email)
   );
ALTER TABLE users ALTER COLUMN email TYPE citext;

-- 2. Indexes the plan requires that were missing or lived in a migration that never ran.
CREATE INDEX IF NOT EXISTS idx_records_name     ON records USING GIN (display_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_events_record    ON record_events (record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_links_target     ON record_links (target_record_id, source_field_key);
CREATE INDEX IF NOT EXISTS idx_outbox_pending   ON outbox_events (available_at, id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_automations_active ON automations (org_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_automation_runs_automation ON automation_runs (automation_id, started_at DESC);

-- 3. Defaults the plan specifies that were dropped.
ALTER TABLE outbox_events  ALTER COLUMN available_at SET DEFAULT now();
ALTER TABLE automation_runs ALTER COLUMN started_at  SET DEFAULT now();

-- 4. Constrain the enumerations the plan says drive behaviour.
ALTER TABLE pipeline_stages DROP CONSTRAINT IF EXISTS pipeline_stages_type_check;
ALTER TABLE pipeline_stages
  ADD CONSTRAINT pipeline_stages_type_check CHECK (type IN ('open', 'won', 'lost'));

UPDATE outbox_events SET status = 'done' WHERE status = 'completed';
ALTER TABLE outbox_events DROP CONSTRAINT IF EXISTS outbox_events_status_check;
ALTER TABLE outbox_events
  ADD CONSTRAINT outbox_events_status_check
  CHECK (status IN ('pending', 'processing', 'done', 'failed'));

ALTER TABLE views DROP CONSTRAINT IF EXISTS views_type_check;
ALTER TABLE views
  ADD CONSTRAINT views_type_check CHECK (type IN ('table', 'kanban', 'calendar'));

-- 5. Metadata audit trail. Plan Section 13 "Audit": metadata changes go to a separate table.
CREATE TABLE IF NOT EXISTS admin_audit (
  id          bigserial PRIMARY KEY,
  org_id      uuid NOT NULL REFERENCES organizations(id),
  actor_id    uuid REFERENCES users(id),
  actor_type  text NOT NULL DEFAULT 'user',
  entity_type text NOT NULL,          -- module | field | pipeline | stage | view | role | user | automation
  entity_id   text,
  action      text NOT NULL,          -- created | updated | deleted | reordered
  before      jsonb,
  after       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_org ON admin_audit (org_id, created_at DESC);

-- 6. Idempotency-Key storage. Plan Section 7 Conventions + Guardrail 12.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  org_id       uuid NOT NULL REFERENCES organizations(id),
  key          text NOT NULL,
  endpoint     text NOT NULL,
  request_hash text NOT NULL,
  status_code  integer NOT NULL,
  response     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, key, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys (created_at);

-- 7. Per-field counters for auto_number. Plan Section 5: "sequence per module, read-only".
CREATE TABLE IF NOT EXISTS field_sequences (
  org_id     uuid NOT NULL REFERENCES organizations(id),
  field_id   uuid NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  next_value bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, field_id)
);

-- 8. Team membership, so the `team` record scope of Section 13 can compile to SQL.
CREATE TABLE IF NOT EXISTS teams (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE TABLE IF NOT EXISTS team_members (
  org_id  uuid NOT NULL REFERENCES organizations(id),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members (user_id);

-- 9. Observability from day one. Plan Section 14: "pg_stat_statements on from day one".
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
