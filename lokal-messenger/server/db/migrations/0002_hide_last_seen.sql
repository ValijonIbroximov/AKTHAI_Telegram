-- So'nggi faollikni yashirish (maxfiylik sozlamasi)
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS hide_last_seen BOOLEAN NOT NULL DEFAULT FALSE;
