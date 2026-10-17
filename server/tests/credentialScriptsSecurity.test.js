const fs = require('fs');
const path = require('path');
const {
    getPasswordsFromEnv,
    updateCredentials,
    USER_ACCOUNTS
} = require('../scripts/update_user_credentials');
const {
    validateDevEnvironment,
    getDistinctDevPasswords,
    runDevPasswordReset
} = require('../scripts/setDevPasswords');

describe('Credential Scripts Security & Hardening Suite (In-Memory / Isolated)', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
        // Clear password env vars
        for (const acc of USER_ACCOUNTS) {
            delete process.env[acc.envVar];
        }
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('update_user_credentials.js - Environment Variable Validation', () => {
        test('Requirement: Rejects execution with descriptive error when all required password env vars are missing', () => {
            expect(() => getPasswordsFromEnv()).toThrow(/Missing required password environment variable\(s\)/);
        });

        test('Requirement: Rejects execution when a subset of password env vars are missing', () => {
            process.env.USER_PASSWORD_SOUNDAR = 'MockSecretPass1';
            process.env.USER_PASSWORD_SANJAY = 'MockSecretPass2';

            expect(() => getPasswordsFromEnv()).toThrow(/USER_PASSWORD_MUKESH.*USER_PASSWORD_RAJ/);
        });

        test('Requirement: Rejects passwords shorter than 8 characters', () => {
            process.env.USER_PASSWORD_SOUNDAR = 'Short1';
            process.env.USER_PASSWORD_SANJAY = 'MockSecretPass2';
            process.env.USER_PASSWORD_MUKESH = 'MockSecretPass3';
            process.env.USER_PASSWORD_RAJ = 'MockSecretPass4';

            expect(() => getPasswordsFromEnv()).toThrow(/at least 8 characters long/);
        });

        test('Requirement: Successfully extracts passwords when all valid env vars are present', () => {
            process.env.USER_PASSWORD_SOUNDAR = 'MockPassSoundar1';
            process.env.USER_PASSWORD_SANJAY = 'MockPassSanjay2';
            process.env.USER_PASSWORD_MUKESH = 'MockPassMukesh3';
            process.env.USER_PASSWORD_RAJ = 'MockPassRaj4444';

            const passwords = getPasswordsFromEnv();
            expect(passwords['user_soundar']).toBe('MockPassSoundar1');
            expect(passwords['user_sanjay']).toBe('MockPassSanjay2');
            expect(passwords['user_mukesh']).toBe('MockPassMukesh3');
            expect(passwords['user_raj']).toBe('MockPassRaj4444');
        });

        test('Requirement: Error messages never leak secret values', () => {
            const shortSecret = '12345';
            process.env.USER_PASSWORD_SOUNDAR = shortSecret;
            process.env.USER_PASSWORD_SANJAY = 'ValidPassSanjay1';
            process.env.USER_PASSWORD_MUKESH = 'ValidPassMukesh2';
            process.env.USER_PASSWORD_RAJ = 'ValidPassRaj3333';

            try {
                getPasswordsFromEnv();
                throw new Error('Should have thrown error');
            } catch (err) {
                expect(err.message).not.toContain(shortSecret);
                expect(err.message).toContain('USER_PASSWORD_SOUNDAR');
            }
        });
    });

    describe('update_user_credentials.js - Transaction Rollback & Leak Prevention', () => {
        test('Requirement: Aborts and issues ROLLBACK when query fails on mock client', async () => {
            const queriesIssued = [];
            const mockClient = {
                query: jest.fn(async (sql) => {
                    queriesIssued.push(sql);
                    if (sql === 'BEGIN') return {};
                    if (sql.includes('SELECT id, name FROM users')) {
                        // Simulate failure finding user
                        return { rows: [] };
                    }
                    if (sql === 'ROLLBACK') return {};
                    return {};
                })
            };

            const mockPasswords = {
                user_soundar: 'MockPassSoundar1',
                user_sanjay: 'MockPassSanjay2',
                user_mukesh: 'MockPassMukesh3',
                user_raj: 'MockPassRaj4444'
            };

            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            await expect(updateCredentials({ client: mockClient, passwords: mockPasswords }))
                .rejects.toThrow(/not found in database/);

            expect(queriesIssued).toContain('BEGIN');
            expect(queriesIssued).toContain('ROLLBACK');
            expect(queriesIssued).not.toContain('COMMIT');

            // Verify console.error does not leak passwords
            const loggedErrors = consoleErrorSpy.mock.calls.flat().join(' ');
            for (const pwd of Object.values(mockPasswords)) {
                expect(loggedErrors).not.toContain(pwd);
            }

            consoleErrorSpy.mockRestore();
        });

        test('Requirement: Successful transaction issues BEGIN and COMMIT without logging secrets', async () => {
            const queriesIssued = [];
            const mockClient = {
                query: jest.fn(async (sql, params) => {
                    queriesIssued.push({ sql, params });
                    if (sql === 'BEGIN' || sql === 'COMMIT') return {};
                    if (sql.includes('SELECT id, name FROM users')) {
                        return { rows: [{ id: params[0], name: 'Mock Name' }] };
                    }
                    if (sql.includes('SELECT role FROM household_memberships')) {
                        const targetUser = USER_ACCOUNTS.find(u => u.id === params[0]);
                        return { rows: [{ role: targetUser.role }] };
                    }
                    return { rows: [] };
                })
            };

            const mockPasswords = {
                user_soundar: 'MockPassSoundar1',
                user_sanjay: 'MockPassSanjay2',
                user_mukesh: 'MockPassMukesh3',
                user_raj: 'MockPassRaj4444'
            };

            const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

            await updateCredentials({ client: mockClient, passwords: mockPasswords });

            const sqlStrings = queriesIssued.map(q => q.sql);
            expect(sqlStrings).toContain('BEGIN');
            expect(sqlStrings).toContain('COMMIT');

            // Verify parameterized queries used for updates
            const updateQueries = queriesIssued.filter(q => q.sql.includes('UPDATE users'));
            expect(updateQueries.length).toBe(4);
            for (const uq of updateQueries) {
                expect(uq.sql).toContain('$1');
                expect(uq.sql).toContain('$4');
            }

            // Verify logs do not leak passwords or hashes
            const loggedOutput = consoleLogSpy.mock.calls.flat().join(' ');
            for (const pwd of Object.values(mockPasswords)) {
                expect(loggedOutput).not.toContain(pwd);
            }
            expect(loggedOutput).not.toContain('$argon2id');

            consoleLogSpy.mockRestore();
        });
    });

    describe('setDevPasswords.js - Non-Production & Non-Shared Safeguards', () => {
        test('Requirement: Strictly rejects execution if NODE_ENV is production', () => {
            expect(() => validateDevEnvironment({ nodeEnv: 'production' }))
                .toThrow(/Refusing to execute setDevPasswords in a production environment/);
        });

        test('Requirement: Rejects execution against remote or non-local database host', () => {
            expect(() => validateDevEnvironment({
                nodeEnv: 'development',
                targetDatabaseUrl: 'postgres://app:secret@db.cloud-cluster.internal:5432/shared_house'
            })).toThrow(/Refusing to execute setDevPasswords against non-local database host/);
        });

        test('Requirement: Ensures each user receives a distinct development password (never shared)', () => {
            const mockUsers = [
                { id: 'u1', username: 'Soundar', name: 'Soundar M' },
                { id: 'u2', username: 'Sanjay', name: 'Sanjay K' },
                { id: 'u3', username: 'Mukesh', name: 'Mukesh S' },
                { id: 'u4', username: 'Raj', name: 'Raj Priyan A' }
            ];

            const passwords = getDistinctDevPasswords(mockUsers);
            const values = Object.values(passwords);

            // Verify count matches
            expect(values.length).toBe(mockUsers.length);

            // Verify all passwords are unique and distinct per user
            const uniqueSet = new Set(values);
            expect(uniqueSet.size).toBe(mockUsers.length);
            for (const pwd of values) {
                expect(pwd).toMatch(/^dev_/);
                expect(pwd.length).toBeGreaterThanOrEqual(10);
            }
        });

        test('Requirement: Rollback occurs on failure without logging secrets', async () => {
            const queries = [];
            const mockClient = {
                query: jest.fn(async (sql) => {
                    queries.push(sql);
                    if (sql === 'BEGIN') return {};
                    if (sql.includes('SELECT id, name, username FROM users')) {
                        throw new Error('Simulated DB query error');
                    }
                    if (sql === 'ROLLBACK') return {};
                    return {};
                })
            };

            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            await expect(runDevPasswordReset({
                nodeEnv: 'development',
                targetDatabaseUrl: 'postgres://localhost/shared_house_test',
                client: mockClient,
                skipFileWrite: true
            })).rejects.toThrow('Simulated DB query error');

            expect(queries).toContain('BEGIN');
            expect(queries).toContain('ROLLBACK');
            expect(queries).not.toContain('COMMIT');

            consoleErrorSpy.mockRestore();
        });
    });

    describe('Source Code Secrets Audit', () => {
        test('Requirement: update_user_credentials.js contains zero hardcoded passwords', () => {
            const content = fs.readFileSync(path.join(__dirname, '../scripts/update_user_credentials.js'), 'utf-8');

            expect(content).not.toMatch(/password:\s*['"`][^'"`]+['"`]/);
            expect(content).not.toMatch(/USER_PASSWORD_[A-Z]+\s*=\s*['"`][^'"`]+['"`]/);
        });

        test('Requirement: setDevPasswords.js contains zero shared default passwords', () => {
            const content = fs.readFileSync(path.join(__dirname, '../scripts/setDevPasswords.js'), 'utf-8');

            expect(content).not.toContain('DEFAULT_DEV_PASSWORD');
            expect(content).not.toMatch(/DEFAULT_[A-Z_]*PASSWORD/);
        });
    });
});
