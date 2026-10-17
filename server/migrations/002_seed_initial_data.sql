-- 002_seed_initial_data.sql

-- 1. Household
INSERT INTO households (id, name)
VALUES (1, 'Shared House')
ON CONFLICT (id) DO NOTHING;

-- 2. Users
INSERT INTO users (id, name)
VALUES 
    ('user_soundar', 'Soundar M'),
    ('user_sanjay', 'Sanjay K'),
    ('user_mukesh', 'Mukesh S'),
    ('user_raj', 'Raj Priyan A')
ON CONFLICT (id) DO NOTHING;

-- 3. Household memberships
INSERT INTO household_memberships (household_id, user_id, role)
VALUES 
    (1, 'user_soundar', 'ADMIN'),
    (1, 'user_sanjay', 'MEMBER'),
    (1, 'user_mukesh', 'MEMBER'),
    (1, 'user_raj', 'MEMBER')
ON CONFLICT (household_id, user_id) DO UPDATE SET role = EXCLUDED.role;

-- 4. Food configuration
INSERT INTO food_configuration (household_id, default_rate_paise)
SELECT 1, 10000
WHERE NOT EXISTS (
    SELECT 1 FROM food_configuration WHERE household_id = 1
);
