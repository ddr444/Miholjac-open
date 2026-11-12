CREATE TABLE admins (
  email TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_email ON sessions(email);
ALTER TABLE audit ADD COLUMN actor TEXT NOT NULL DEFAULT 'shared-password';
