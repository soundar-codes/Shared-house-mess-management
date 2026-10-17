-- 006_add_mess_unavailability.sql

CREATE TABLE IF NOT EXISTS mess_unavailability_declarations (
    id SERIAL PRIMARY KEY,
    household_id INT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    declaration_date DATE NOT NULL,
    reason TEXT NOT NULL,
    declared_by VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
    revoked_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
    revocation_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Partial unique index ensures at most ONE ACTIVE declaration per household and date
-- while allowing historical revoked declarations to be preserved for auditability.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mess_unavail_active_unique 
ON mess_unavailability_declarations (household_id, declaration_date) 
WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_mess_unavail_lookup 
ON mess_unavailability_declarations (household_id, declaration_date);
