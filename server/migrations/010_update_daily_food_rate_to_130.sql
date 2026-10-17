-- 010_update_daily_food_rate_to_130.sql
-- 1. Add household timezone and cancellation cutoff configuration columns if not present
ALTER TABLE households
ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
ADD COLUMN IF NOT EXISTS cancellation_cutoff_time VARCHAR(10) NOT NULL DEFAULT '23:00';

-- 2. Add isActive status flag to household_memberships to support deactivating/activating members
ALTER TABLE household_memberships
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- 3. Close the previous food configuration (valid_to = '2026-10-01 00:00:00+05:30') and insert the new 13000 paise rate starting October 2026
UPDATE food_configuration
SET valid_to = '2026-10-01 00:00:00+05:30'
WHERE household_id = 1 AND valid_to IS NULL;

INSERT INTO food_configuration (household_id, default_rate_paise, valid_from)
VALUES (1, 13000, '2026-10-01 00:00:00+05:30');

