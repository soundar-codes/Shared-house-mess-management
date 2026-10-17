require('dotenv').config();
const { Client } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { hashPassword } = require('../src/services/authService');

const LOCAL_DEV_CREDENTIALS_FILE = path.join(__dirname, '../.dev_credentials.local');

/**
 * Validates that the current runtime environment is strictly local development or test.
 * Prevents accidental execution in production or against non-local databases.
 */
function validateDevEnvironment(options = {}) {
    const nodeEnv = options.nodeEnv || process.env.NODE_ENV;
    if (nodeEnv === 'production') {
        throw new Error('Refusing to execute setDevPasswords in a production environment.');
    }

    const dbUrl = options.targetDatabaseUrl || process.env.DATABASE_URL || '';
    const isLocalhost = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1') || dbUrl.includes('_test') || dbUrl.includes('_dev');
    if (!options.allowNonLocal && !isLocalhost) {
        throw new Error('Refusing to execute setDevPasswords against non-local database host.');
    }
}

/**
 * Generates distinct per-user development credentials.
 * Ensures no two users share the same development password.
 */
function getDistinctDevPasswords(users, options = {}) {
    const passwords = {};
    const usedPasswords = new Set();

    for (const user of users) {
        const envKey = `DEV_PASSWORD_${(user.username || user.name || user.id).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
        let password = options.passwords?.[user.id] || process.env[envKey];

        if (!password) {
            // Generate distinct, cryptographically secure development password per user
            const entropy = crypto.randomBytes(6).toString('hex');
            password = `dev_${user.id}_${entropy}`;
        }

        if (usedPasswords.has(password)) {
            throw new Error('Security violation: Duplicate password detected. Each user must have a distinct password.');
        }

        usedPasswords.add(password);
        passwords[user.id] = password;
    }

    return passwords;
}

/**
 * Safely updates development passwords for testing and local development only.
 * Guaranteed to never execute in production and never assign a shared password.
 */
async function runDevPasswordReset(options = {}) {
    validateDevEnvironment(options);

    const connectionString = options.targetDatabaseUrl || process.env.DATABASE_URL;
    let client = options.client;
    let shouldCloseClient = false;

    if (!client) {
        if (!connectionString) {
            throw new Error('DATABASE_URL is not set.');
        }
        client = new Client({ connectionString });
        await client.connect();
        shouldCloseClient = true;
    }

    try {
        await client.query('BEGIN');

        const { rows: users } = await client.query('SELECT id, name, username FROM users ORDER BY id');
        if (users.length === 0) {
            console.log('No users found in database to update.');
            await client.query('COMMIT');
            return {};
        }

        const distinctPasswords = getDistinctDevPasswords(users, options);

        for (const user of users) {
            const userPassword = distinctPasswords[user.id];
            const hashedPassword = await hashPassword(userPassword);

            await client.query(
                'UPDATE users SET password_hash = $1 WHERE id = $2',
                [hashedPassword, user.id]
            );

            // Invalidate active sessions
            await client.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
        }

        await client.query('COMMIT');

        // If local dev environment, output distinct credentials to an untracked local file with strict 0600 permissions
        if (!options.skipFileWrite && process.env.NODE_ENV !== 'test') {
            const fileData = Object.entries(distinctPasswords)
                .map(([userId, pwd]) => `${userId}=${pwd}`)
                .join('\n') + '\n';

            fs.writeFileSync(LOCAL_DEV_CREDENTIALS_FILE, fileData, { mode: 0o600 });
            console.log(`Development passwords updated. Distinct credentials written to untracked local file: ${LOCAL_DEV_CREDENTIALS_FILE}`);
        } else {
            console.log(`Successfully updated distinct development passwords for ${users.length} users.`);
        }

        return distinctPasswords;
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Failed to reset development passwords. Transaction safely rolled back.');
        throw err;
    } finally {
        if (shouldCloseClient) {
            await client.end();
        }
    }
}

if (require.main === module) {
    runDevPasswordReset()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = {
    runDevPasswordReset,
    validateDevEnvironment,
    getDistinctDevPasswords
};
