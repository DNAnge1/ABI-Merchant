-- Live suggestions board + upvote (no pending queue). Admin hide via PATCH + ADMIN_KEY.
-- Anti-spam uses hashed IP (SHA-256); never store raw IPs.

CREATE TABLE IF NOT EXISTS suggestions (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  upvote_count INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  author_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_suggestions_visible_created
  ON suggestions (hidden, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_suggestions_visible_upvotes
  ON suggestions (hidden, upvote_count DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS suggestion_votes (
  suggestion_id TEXT NOT NULL,
  voter_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (suggestion_id, voter_hash),
  FOREIGN KEY (suggestion_id) REFERENCES suggestions(id)
);

CREATE TABLE IF NOT EXISTS suggestion_rate (
  ip_hash TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  post_count INTEGER NOT NULL DEFAULT 0,
  last_upvote_at INTEGER NOT NULL DEFAULT 0
);
