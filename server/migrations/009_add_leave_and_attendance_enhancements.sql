-- 009_add_leave_and_attendance_enhancements.sql

-- 1. Extend food_records status constraint to include 'ON_LEAVE'
ALTER TABLE food_records DROP CONSTRAINT IF EXISTS food_records_status_check;

ALTER TABLE food_records ADD CONSTRAINT food_records_status_check 
CHECK (status IN ('FOOD_REQUIRED', 'CANCELLED', 'ON_LEAVE'));

-- 2. Create member_leaves table for date-range leave tracking
CREATE TABLE IF NOT EXISTS member_leaves (
    id SERIAL PRIMARY KEY,
    household_id INT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT,
    created_by VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
    cancelled_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
    cancellation_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_member_leave_dates CHECK (start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS idx_member_leaves_range 
ON member_leaves(household_id, user_id, start_date, end_date) 
WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_member_leaves_household 
ON member_leaves(household_id, status);
