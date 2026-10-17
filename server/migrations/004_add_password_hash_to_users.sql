-- 004_add_password_hash_to_users.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
