-- 015_add_username_to_users.sql

-- Add separate login username column without altering existing primary keys
ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(50) UNIQUE;

-- Populate login usernames for existing accounts
UPDATE users SET username = 'Soundar' WHERE id = 'user_soundar';
UPDATE users SET username = 'Sanjay' WHERE id = 'user_sanjay';
UPDATE users SET username = 'Mukesh' WHERE id = 'user_mukesh';
UPDATE users SET username = 'Raj' WHERE id = 'user_raj';

-- Ensure full names match requirements
UPDATE users SET name = 'Mukesh S' WHERE id = 'user_mukesh';
UPDATE users SET name = 'Sanjay K' WHERE id = 'user_sanjay';
UPDATE users SET name = 'Soundar M' WHERE id = 'user_soundar';
UPDATE users SET name = 'Raj Priyan A' WHERE id = 'user_raj';

-- Set secure Argon2id password hashes for synthetic test fixtures
UPDATE users SET password_hash = '$argon2id$v=19$m=65536,p=4,t=3$YVAEaCu/K+9PbcOPOteH1Q$yTHux0L3X9CVNTSHLRmkRqC+VHitaZ5Hklb3zDMfzSA' WHERE id = 'user_soundar';
UPDATE users SET password_hash = '$argon2id$v=19$m=65536,p=4,t=3$xDqid1aG2FMNBUb8F3qqbA$HtSq9zWEvyitd/4OOb0/LMIrTMEHGY4UFhCOJszFbYk' WHERE id = 'user_sanjay';
UPDATE users SET password_hash = '$argon2id$v=19$m=65536,p=4,t=3$GmzTnE0Tf3qHXwz+2KRRgQ$s2N1GBpecH8H2pcQU4mV/Drmg4xvjR3XEfRU1EEozsw' WHERE id = 'user_mukesh';
UPDATE users SET password_hash = '$argon2id$v=19$m=65536,p=4,t=3$zSlBhq1yuMvJYzXTUA7Zdw$zOEhmP1lyoNz2m6aaOiEVclPQtFUgrHoxrLTKe1ipq4' WHERE id = 'user_raj';


