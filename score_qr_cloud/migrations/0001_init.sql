CREATE TABLE IF NOT EXISTS slots (
  slot INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  score INTEGER NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  submit_time TEXT DEFAULT (datetime('now')),
  device_id TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS scores_one_per_device_code ON scores (code, device_id);

CREATE TABLE IF NOT EXISTS score_voters (
  device_id TEXT PRIMARY KEY
);

INSERT OR IGNORE INTO slots (slot, code) VALUES
  (1, '1'), (2, '2'), (3, '3'), (4, '4'), (5, '5'), (6, '6');
