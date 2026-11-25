-- Public-mode admins list every owner's items: without this the list scans and sorts the whole table per page.
CREATE INDEX items_created_idx ON items (created_at DESC, id DESC);
