CREATE INDEX IF NOT EXISTS idx_outbox_events_pending ON outbox_events (available_at, id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_automations_active ON automations (org_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_automation_runs_automation ON automation_runs (automation_id, started_at DESC);
