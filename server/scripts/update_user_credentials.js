require('dotenv').config();
const { Client } = require('pg');
const { hashPassword } = require('../src/services/authService');

// Static user account definitions (No credentials stored in source code)
const USER_ACCOUNTS = [
    {
        id: 'user_soundar',
        expectedName: 'Soundar M',
        username: 'Soundar',
        role: 'ADMIN',
        envVar: 'USER_PASSWORD_SOUNDAR'
    },
    {
        id: 'user_sanjay',
        expectedName: 'Sanjay K',
        username: 'Sanjay',
        role: 'MEMBER',
        envVar: 'USER_PASSWORD_SANJAY'
    },
    {
        id: 'user_mukesh',
        expectedName: 'Mukesh S',
        username: 'Mukesh',
        role: 'MEMBER',
        envVar: 'USER_PASSWORD_MUKESH'
    },
    {
        id: 'user_raj',
        expectedName: 'Raj Priyan A',
        username: 'Raj',
        role: 'MEMBER',
        envVar: 'USER_PASSWORD_RAJ'
    }
];

/**
 * Validates and retrieves required passwords from environment variables or custom overrides.
 * Strictly throws if any password is missing or below minimum length.
 * Never leaks passwords in error messages or logs.
 */
function getPasswordsFromEnv(overrides = {}) {
    const passwords = {};
    const missing = [];
    const invalidLength = [];

    for (const acc of USER_ACCOUNTS) {
        const val = overrides[acc.id] || overrides[acc.username] || process.env[acc.envVar];
        if (!val || typeof val !== 'string' || val.trim().length === 0) {
            missing.push(acc.envVar);
        } else if (val.trim().length < 8) {
            invalidLength.push(acc.envVar);
        } else {
            passwords[acc.id] = val.trim();
        }
    }

    if (missing.length > 0) {
        throw new Error(
            `Missing required password environment variable(s): ${missing.join(', ')}. ` +
            `Please configure them in your local untracked environment.`
        );
    }

    if (invalidLength.length > 0) {
        throw new Error(
            `Password environment variable(s) must be at least 8 characters long: ${invalidLength.join(', ')}.`
        );
    }

    return passwords;
}

/**
 * Safely updates user credentials within a database transaction.
 * Uses parameterized queries, Argon2id hashing, and session invalidation.
 * Never logs credentials, hashes, or database connection strings.
 */
async function updateCredentials(options = {}) {
    const passwords = options.passwords || getPasswordsFromEnv(options.passwordOverrides);

    const connectionString = options.targetDatabaseUrl || process.env.DATABASE_URL;
    let client = options.client;
    let shouldCloseClient = false;

    if (!client) {
        if (!connectionString) {
            throw new Error('DATABASE_URL is not configured.');
        }
        client = new Client({ connectionString });
        await client.connect();
        shouldCloseClient = true;
    }

    try {
        await client.query('BEGIN');

        for (const acc of USER_ACCOUNTS) {
            // Verify existing user exists
            const userRes = await client.query('SELECT id, name FROM users WHERE id = $1', [acc.id]);
            if (userRes.rows.length === 0) {
                throw new Error(`User with ID ${acc.id} not found in database.`);
            }

            // Verify membership role
            const roleRes = await client.query(
                'SELECT role FROM household_memberships WHERE user_id = $1',
                [acc.id]
            );
            if (roleRes.rows.length === 0) {
                throw new Error(`Household membership for user ${acc.id} not found.`);
            }
            if (roleRes.rows[0].role !== acc.role) {
                throw new Error(`Role mismatch for user ${acc.id}: expected ${acc.role}, found ${roleRes.rows[0].role}.`);
            }

            // Securely hash password using Argon2id
            const password = passwords[acc.id];
            const passwordHash = await hashPassword(password);

            // Parameterized update preserving immutable primary keys
            await client.query(
                `UPDATE users 
                 SET name = $1, username = $2, password_hash = $3 
                 WHERE id = $4`,
                [acc.expectedName, acc.username, passwordHash, acc.id]
            );

            // Invalidate active sessions for this user upon credential update
            await client.query('DELETE FROM sessions WHERE user_id = $1', [acc.id]);
        }

        await client.query('COMMIT');
        console.log(`Successfully updated credentials and invalidated active sessions for all ${USER_ACCOUNTS.length} users.`);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Credential update failed. Transaction was safely rolled back.');
        throw err;
    } finally {
        if (shouldCloseClient) {
            await client.end();
        }
    }
}

if (require.main === module) {
    updateCredentials()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = {
    updateCredentials,
    getPasswordsFromEnv,
    USER_ACCOUNTS
};
