-- 008_add_billing_automation_logs.sql

CREATE TABLE IF NOT EXISTS billing_automation_logs (
    id SERIAL PRIMARY KEY,
    household_id INT REFERENCES households(id) ON DELETE CASCADE,
    executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) NOT NULL CHECK (status IN ('SUCCESS', 'FAILED', 'PARTIAL', 'SKIPPED')),
    generated_count INT NOT NULL DEFAULT 0,
    preserved_count INT NOT NULL DEFAULT 0,
    details JSONB,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_billing_automation_logs_household ON billing_automation_logs(household_id, executed_at DESC);
