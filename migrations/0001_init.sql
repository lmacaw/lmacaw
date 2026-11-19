CREATE TABLE users (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT UNIQUE NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
    created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
);

CREATE TABLE login_links (
    token_hash TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL,
    invitation_hash TEXT,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
);

CREATE TABLE invitations (
    token_hash TEXT PRIMARY KEY NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
);

CREATE TABLE rate_limits (
    key TEXT PRIMARY KEY NOT NULL,
    attempts INTEGER NOT NULL,
    window_start INTEGER NOT NULL
);

CREATE TABLE items (
    id TEXT PRIMARY KEY NOT NULL,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_hash TEXT NOT NULL,
    storage_key TEXT UNIQUE NOT NULL,
    thumbnail_key TEXT UNIQUE,
    content_type TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    ocr_override TEXT,
    favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
    shared INTEGER NOT NULL DEFAULT 0 CHECK (shared IN (0, 1)),
    source_metadata TEXT,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    UNIQUE (owner_id, content_hash)
);

CREATE INDEX items_owner_created_idx ON items (owner_id, created_at DESC, id DESC);
CREATE INDEX items_shared_created_idx ON items (shared, created_at DESC, id DESC);

CREATE TABLE item_analysis (
    item_id TEXT PRIMARY KEY NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    description TEXT NOT NULL DEFAULT '',
    extracted_text TEXT NOT NULL DEFAULT '',
    suggested_tags TEXT NOT NULL DEFAULT '[]',
    embedding_model TEXT,
    embedded_revision INTEGER,
    updated_at INTEGER NOT NULL
);

CREATE TABLE collections (
    id TEXT PRIMARY KEY NOT NULL,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (owner_id, name)
);

CREATE TABLE collection_items (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    PRIMARY KEY (collection_id, item_id)
);

CREATE TABLE ai_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'document')),
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'leased', 'complete', 'failed')),
    lease_token TEXT,
    lease_until INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    revision INTEGER,
    created_at INTEGER NOT NULL
);

CREATE INDEX ai_jobs_state_created_idx ON ai_jobs (state, created_at);
CREATE INDEX ai_jobs_item_kind_idx ON ai_jobs (item_id, kind);

CREATE TABLE ai_usage (
    day TEXT PRIMARY KEY NOT NULL,
    neurons INTEGER NOT NULL DEFAULT 0,
    vector_queries INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE media_deletions (
    storage_key TEXT PRIMARY KEY NOT NULL,
    created_at INTEGER NOT NULL
);

-- Only the fake Vectorize implementation uses this table when AI_MODE=fake.
CREATE TABLE dev_vectors (
    id TEXT PRIMARY KEY NOT NULL,
    owner_id TEXT NOT NULL,
    shared INTEGER NOT NULL CHECK (shared IN (0, 1)),
    vector TEXT NOT NULL
);

CREATE VIRTUAL TABLE item_search USING fts5(
    item_id UNINDEXED,
    owner_id UNINDEXED,
    shared UNINDEXED,
    body,
    tokenize = "unicode61 remove_diacritics 2"
);
