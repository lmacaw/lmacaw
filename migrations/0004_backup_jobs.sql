-- Optional Discord backup (#52): one job per new item, drained by the per-minute cron.
CREATE TABLE backup_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'leased', 'complete', 'skipped', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_at INTEGER NOT NULL,
    lease_token TEXT,
    lease_until INTEGER,
    message_id TEXT,
    error TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX backup_jobs_state_next_idx ON backup_jobs (state, next_at);
CREATE INDEX backup_jobs_item_idx ON backup_jobs (item_id);
