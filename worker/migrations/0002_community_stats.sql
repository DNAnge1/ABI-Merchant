-- Coarse community counters + daily rollups (UTC YYYY-MM-DD). Free-tier light: no raw event logs.

CREATE TABLE IF NOT EXISTS site_counters (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_stats (
  day TEXT PRIMARY KEY,
  visits INTEGER NOT NULL DEFAULT 0,
  scans INTEGER NOT NULL DEFAULT 0,
  votes INTEGER NOT NULL DEFAULT 0,
  reds_found INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS map_mode_counts (
  map_mode TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

-- Extend existing sound_votes for most/least scanned + top red (cheap; reuse PK rows).
ALTER TABLE sound_votes ADD COLUMN scan_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sound_votes ADD COLUMN red_count INTEGER NOT NULL DEFAULT 0;
