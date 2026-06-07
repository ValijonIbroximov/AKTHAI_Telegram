-- Profil surati va foydalanuvchi tahrirlash ruxsatlari
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_path TEXT;

CREATE TABLE IF NOT EXISTS app_config (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_config (key, value)
VALUES ('profile_edit_policy', '{
  "display_name": true,
  "display_short": false,
  "rank_title": false,
  "unit_code": false,
  "unit_name": false,
  "okrug_name": false,
  "okrug_code": false,
  "division_name": false,
  "division_code": false,
  "avatar": true
}'::jsonb)
ON CONFLICT (key) DO NOTHING;
