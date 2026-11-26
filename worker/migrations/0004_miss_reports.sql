-- Public miss / confusion reports (MissReportPayload v1 numbers-only JSON).
-- No audio, no spectrum vectors. Admin hide via PATCH + ADMIN_KEY.
-- Rate limit uses hashed IP only (never store raw IPs).

CREATE TABLE IF NOT EXISTS miss_reports (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  day TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  source TEXT NOT NULL,
  expected_id INTEGER NOT NULL,
  predicted_id INTEGER NOT NULL,
  is_match INTEGER NOT NULL DEFAULT 0,
  expected_rank INTEGER,
  expected_score REAL,
  predicted_score REAL,
  map_mode_id TEXT,
  app_version TEXT,
  author_hash TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_miss_reports_visible_created
  ON miss_reports (hidden, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_miss_reports_confusion
  ON miss_reports (hidden, is_match, expected_id, predicted_id);

CREATE INDEX IF NOT EXISTS idx_miss_reports_day
  ON miss_reports (hidden, day);

CREATE TABLE IF NOT EXISTS miss_report_rate (
  ip_hash TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  post_count INTEGER NOT NULL DEFAULT 0
);
