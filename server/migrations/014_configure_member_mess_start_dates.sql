-- 014_configure_member_mess_start_dates.sql
-- Ensure Raj Priyan A has consistent mess start date configured (2026-10-12)

UPDATE household_memberships 
SET mess_start_date = '2026-10-12' 
WHERE user_id = 'user_raj' AND mess_start_date IS NULL;
