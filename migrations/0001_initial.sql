PRAGMA foreign_keys = ON;
CREATE TABLE slots (
  id INTEGER PRIMARY KEY,
  day TEXT NOT NULL,
  hour INTEGER NOT NULL CHECK(hour BETWEEN 0 AND 23),
  closed INTEGER NOT NULL DEFAULT 0 CHECK(closed IN (0,1)),
  UNIQUE(day, hour)
);
CREATE TABLE participants (
  id INTEGER PRIMARY KEY,
  identity_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  club TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK(category IN ('registered_m','registered_f','recreation_m','recreation_f')),
  contact TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE bookings (
  id INTEGER PRIMARY KEY,
  slot_id INTEGER NOT NULL REFERENCES slots(id),
  lane INTEGER NOT NULL CHECK(lane BETWEEN 1 AND 4),
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  token_hash TEXT NOT NULL UNIQUE,
  cancelled INTEGER NOT NULL DEFAULT 0 CHECK(cancelled IN (0,1)),
  paid INTEGER NOT NULL DEFAULT 0 CHECK(paid IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX active_lane ON bookings(slot_id, lane) WHERE cancelled = 0;
CREATE UNIQUE INDEX active_participant ON bookings(slot_id, participant_id) WHERE cancelled = 0;
CREATE INDEX bookings_participant ON bookings(participant_id);
CREATE TABLE results (
  booking_id INTEGER PRIMARY KEY REFERENCES bookings(id),
  s1 INTEGER NOT NULL CHECK(s1 BETWEEN 0 AND 270),
  s2 INTEGER NOT NULL CHECK(s2 BETWEEN 0 AND 270),
  s3 INTEGER NOT NULL CHECK(s3 BETWEEN 0 AND 270),
  s4 INTEGER NOT NULL CHECK(s4 BETWEEN 0 AND 270),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
CREATE TABLE audit (
  id INTEGER PRIMARY KEY,
  action TEXT NOT NULL,
  record_id TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
