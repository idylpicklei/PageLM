CREATE TABLE IF NOT EXISTS canvas_tokens (
  user_id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  last4 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

DROP TABLE IF EXISTS canva_tokens;
