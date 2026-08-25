CREATE TABLE IF NOT EXISTS canva_tokens (
  user_id TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  last4 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
