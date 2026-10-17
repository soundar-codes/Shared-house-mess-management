-- 001_initial_schema.sql

CREATE TABLE IF NOT EXISTS households (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS household_memberships (
    household_id INT REFERENCES households(id) ON DELETE CASCADE,
    user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL CHECK (role IN ('ADMIN', 'MEMBER')),
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (household_id, user_id)
);

CREATE TABLE IF NOT EXISTS food_configuration (
    id SERIAL PRIMARY KEY,
    household_id INT REFERENCES households(id) ON DELETE CASCADE,
    default_rate_paise INTEGER NOT NULL CHECK (default_rate_paise >= 0),
    valid_from TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    valid_to TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS food_records (
    id SERIAL PRIMARY KEY,
    household_id INT REFERENCES households(id) ON DELETE CASCADE,
    user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
    record_date DATE NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('FOOD_REQUIRED', 'CANCELLED')),
    rate_paise INTEGER NOT NULL CHECK (rate_paise >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(household_id, user_id, record_date)
);

CREATE TABLE IF NOT EXISTS bills (
    id SERIAL PRIMARY KEY,
    household_id INT REFERENCES households(id) ON DELETE CASCADE,
    user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
    billing_month VARCHAR(7) NOT NULL,
    total_amount_paise INTEGER NOT NULL CHECK (total_amount_paise >= 0),
    paid_amount_paise INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount_paise >= 0),
    status VARCHAR(50) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'FINALIZED', 'REOPENED')),
    snapshot_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(household_id, user_id, billing_month)
);

CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    bill_id INT REFERENCES bills(id) ON DELETE CASCADE,
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    idempotency_key VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'VALID' CHECK (status IN ('VALID', 'VOIDED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chore_definitions (
    id SERIAL PRIMARY KEY,
    household_id INT REFERENCES households(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chore_assignments (
    id SERIAL PRIMARY KEY,
    chore_id INT REFERENCES chore_definitions(id) ON DELETE CASCADE,
    user_id VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
    assigned_date DATE,
    due_date DATE,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'MISSED', 'EXCUSED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chore_assignment_unique ON chore_assignments (chore_id, assigned_date, user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS dustbin_cycles (
    id SERIAL PRIMARY KEY,
    household_id INT REFERENCES households(id) ON DELETE CASCADE,
    claimant_user_id VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
    cycle_start_date DATE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'COMPLETED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dustbin_open_cycle ON dustbin_cycles(household_id) WHERE status = 'OPEN';

CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    deduplication_key VARCHAR(255),
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_dedup ON notifications(user_id, deduplication_key) WHERE deduplication_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    actor_id VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(255) NOT NULL,
    entity_type VARCHAR(255) NOT NULL,
    entity_id VARCHAR(255) NOT NULL,
    reason TEXT,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
