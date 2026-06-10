-- Kanal turi, tavsif va foydalanuvchining kanal yaratish huquqi
ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_type_check;
ALTER TABLE chats ADD CONSTRAINT chats_type_check
    CHECK (type IN ('private', 'group', 'channel'));

ALTER TABLE chats ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS can_create_channel BOOLEAN NOT NULL DEFAULT TRUE;
