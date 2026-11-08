ALTER TABLE items ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_jobs DROP CONSTRAINT ai_jobs_kind_check;
ALTER TABLE ai_jobs ADD CONSTRAINT ai_jobs_kind_check CHECK (kind IN ('image', 'query', 'document'));
ALTER TABLE ai_jobs ADD COLUMN revision INTEGER;
CREATE INDEX ai_jobs_item_kind ON ai_jobs (item_id, kind);
