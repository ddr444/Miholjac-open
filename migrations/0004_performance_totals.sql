-- Preserve recorded set details while allowing new results entered per performance.
CREATE TABLE results_next (
  booking_id INTEGER PRIMARY KEY REFERENCES bookings(id),
  total INTEGER NOT NULL CHECK(total BETWEEN 0 AND 1080),
  cleaning INTEGER CHECK(cleaning BETWEEN 0 AND total),
  misses INTEGER CHECK(misses BETWEEN 0 AND 120),
  s1 INTEGER, s2 INTEGER, s3 INTEGER, s4 INTEGER,
  c1 INTEGER, c2 INTEGER, c3 INTEGER, c4 INTEGER,
  m1 INTEGER, m2 INTEGER, m3 INTEGER, m4 INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO results_next(booking_id,total,cleaning,misses,s1,s2,s3,s4,c1,c2,c3,c4,m1,m2,m3,m4,updated_at)
SELECT booking_id,s1+s2+s3+s4,c1+c2+c3+c4,m1+m2+m3+m4,s1,s2,s3,s4,c1,c2,c3,c4,m1,m2,m3,m4,updated_at FROM results;
DROP TABLE results;
ALTER TABLE results_next RENAME TO results;
