-- Keep legacy categories for historical records; use division for the official finals groups.
ALTER TABLE participants ADD COLUMN division TEXT NOT NULL DEFAULT 'upper_m'
  CHECK(division IN ('upper_m','women','league_m','recreation_m'));
ALTER TABLE participants ADD COLUMN division_review INTEGER NOT NULL DEFAULT 0;
UPDATE participants SET division=CASE category
  WHEN 'registered_f' THEN 'women'
  WHEN 'recreation_f' THEN 'women'
  WHEN 'recreation_m' THEN 'recreation_m'
  ELSE 'upper_m' END;
-- Earlier registered men were not classified by league. Organizer must confirm them.
UPDATE participants SET division_review=1 WHERE category='registered_m';
