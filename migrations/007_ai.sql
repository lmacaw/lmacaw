CREATE TABLE item_analysis (
  item_id UUID PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  description TEXT NOT NULL DEFAULT '',
  extracted_text TEXT NOT NULL DEFAULT '',
  suggested_tags TEXT[] NOT NULL DEFAULT '{}',
  embedding vector(768),
  embedding_model TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ai_jobs (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'query')),
  item_id UUID REFERENCES items(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'leased', 'complete', 'failed')),
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  result_embedding vector(768),
  result_model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE FUNCTION enqueue_item_analysis() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO ai_jobs (id, kind, item_id, owner_id) VALUES (gen_random_uuid(), 'image', NEW.id, NEW.owner_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER enqueue_item_analysis AFTER INSERT ON items FOR EACH ROW EXECUTE FUNCTION enqueue_item_analysis();
INSERT INTO ai_jobs (id, kind, item_id, owner_id)
SELECT gen_random_uuid(), 'image', id, owner_id FROM items;
