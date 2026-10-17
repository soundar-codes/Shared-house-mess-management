-- 003_add_vessel_schedule.sql

CREATE TABLE IF NOT EXISTS vessel_schedules (
    id SERIAL PRIMARY KEY,
    household_id INT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    day_of_week VARCHAR(15) NOT NULL CHECK (day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
    time_period VARCHAR(15) NOT NULL CHECK (time_period IN ('ALL_DAY', 'MORNING', 'EVENING')),
    assigned_user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(household_id, day_of_week, time_period)
);

-- Seed exactly 9 schedule entries
INSERT INTO vessel_schedules (household_id, day_of_week, time_period, assigned_user_id)
VALUES
    (1, 'Monday', 'ALL_DAY', 'user_soundar'),
    (1, 'Tuesday', 'ALL_DAY', 'user_sanjay'),
    (1, 'Wednesday', 'ALL_DAY', 'user_mukesh'),
    (1, 'Thursday', 'ALL_DAY', 'user_raj'),
    (1, 'Friday', 'MORNING', 'user_soundar'),
    (1, 'Friday', 'EVENING', 'user_raj'),
    (1, 'Saturday', 'MORNING', 'user_sanjay'),
    (1, 'Saturday', 'EVENING', 'user_mukesh'),
    (1, 'Sunday', 'ALL_DAY', NULL)
ON CONFLICT (household_id, day_of_week, time_period) 
DO UPDATE SET assigned_user_id = EXCLUDED.assigned_user_id;
