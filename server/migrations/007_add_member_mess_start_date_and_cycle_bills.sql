-- 007_add_member_mess_start_date_and_cycle_bills.sql

-- 1. Add mess_start_date to household_memberships
ALTER TABLE household_memberships 
ADD COLUMN IF NOT EXISTS mess_start_date DATE;

-- 2. Add period_start, period_end, and cycle_index to bills table
ALTER TABLE bills 
ADD COLUMN IF NOT EXISTS period_start DATE,
ADD COLUMN IF NOT EXISTS period_end DATE,
ADD COLUMN IF NOT EXISTS cycle_index INT;

-- 3. Populate existing rows with period_start and period_end based on billing_month if null
UPDATE bills 
SET 
  period_start = TO_DATE(billing_month || '-01', 'YYYY-MM-DD'),
  period_end = (TO_DATE(billing_month || '-01', 'YYYY-MM-DD') + INTERVAL '1 month')::DATE
WHERE period_start IS NULL AND billing_month IS NOT NULL;

-- 4. Create unique partial index on custom cycle bills (period_start, period_end)
CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_member_cycle_unique 
ON bills (household_id, user_id, period_start, period_end)
WHERE period_start IS NOT NULL AND period_end IS NOT NULL;

-- 5. Index for fast querying by period
CREATE INDEX IF NOT EXISTS idx_bills_period_lookup 
ON bills (household_id, user_id, period_start, period_end);
