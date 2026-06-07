-- Foydalanuvchi ierarxiyasi: Okrug → Harbiy qism → Bo'linma → Foydalanuvchi
ALTER TABLE users ADD COLUMN IF NOT EXISTS okrug_name     VARCHAR(128);
ALTER TABLE users ADD COLUMN IF NOT EXISTS okrug_code     VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS unit_name      VARCHAR(128);
ALTER TABLE users ADD COLUMN IF NOT EXISTS division_name  VARCHAR(128);
ALTER TABLE users ADD COLUMN IF NOT EXISTS division_code  VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_short  VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_users_org
    ON users (okrug_code, unit_code, division_code, display_name)
    WHERE is_active = TRUE;
