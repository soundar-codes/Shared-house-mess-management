const request = require('supertest');
const app = require('../src/app');
const db = require('../src/utils/db');
const authService = require('../src/services/authService');

// Mock db
jest.mock('../src/utils/db', () => {
    const mPool = {
        connect: jest.fn()
    };
    return {
        query: jest.fn(),
        pool: mPool
    };
});

// Mock authService
jest.mock('../src/services/authService');

describe('Food API', () => {
    let mockClient;
    const testSessionToken = 'test-token-123';
    const testUser = {
        id: 'user-1',
        name: 'Test User',
        householdId: 1,
        role: 'MEMBER'
    };
    
    beforeEach(() => {
        jest.clearAllMocks();
        
        mockClient = {
            query: jest.fn(),
            release: jest.fn()
        };
        db.pool.connect.mockResolvedValue(mockClient);
        
        // Setup default auth mock
        authService.getSessionUser.mockResolvedValue(testUser);
        
        // Setup default db query mock for simple selects
        db.query.mockImplementation((queryStr, params) => {
            if (queryStr.includes('food_configuration')) {
                return Promise.resolve({ rows: [{ id: 1, default_rate_paise: 10000 }] });
            }
            if (queryStr.includes('food_records')) {
                return Promise.resolve({ rows: [] });
            }
            return Promise.resolve({ rows: [] });
        });
        
        // Setup transaction mocks
        mockClient.query.mockImplementation((queryStr, params) => {
            if (queryStr === 'BEGIN' || queryStr === 'COMMIT' || queryStr === 'ROLLBACK') {
                return Promise.resolve();
            }
            if (queryStr.includes('SELECT status, rate_paise FROM food_records')) {
                return Promise.resolve({ rows: [] });
            }
            if (queryStr.includes('INSERT INTO food_records')) {
                return Promise.resolve({ 
                    rows: [{ 
                        id: 1, 
                        user_id: testUser.id, 
                        date: params[2], 
                        status: params[3], 
                        rate_paise: params[4]
                    }] 
                });
            }
            if (queryStr.includes('SELECT user_id FROM household_memberships')) {
                return Promise.resolve({ rows: [{ user_id: 'admin-1' }] });
            }
            if (queryStr.includes('INSERT INTO notifications')) {
                return Promise.resolve();
            }
            return Promise.resolve({ rows: [] });
        });
    });
    
    describe('GET /api/v1/food/config', () => {
        it('requires authentication', async () => {
            const res = await request(app).get('/api/v1/food/config');
            expect(res.status).toBe(401);
        });
        
        it('returns active food configuration', async () => {
            const res = await request(app)
                .get('/api/v1/food/config')
                .set('Cookie', `session_token=${testSessionToken}`);
                
            expect(res.status).toBe(200);
            expect(res.body.config.default_rate_paise).toBe(10000);
            expect(db.query).toHaveBeenCalledWith(expect.stringContaining('food_configuration'), [testUser.householdId]);
        });
    });
    
    describe('GET /api/v1/food', () => {
        it('requires month query parameter', async () => {
            const res = await request(app)
                .get('/api/v1/food')
                .set('Cookie', [`session_token=${testSessionToken}`]);
                
            expect(res.status).toBe(400);
        });
        
        it('returns member food records', async () => {
            db.query.mockResolvedValueOnce({
                rows: [{ id: 1, user_id: testUser.id, date: '2026-10-10', status: 'CANCELLED', rate_paise: 10000 }]
            });
            
            const res = await request(app)
                .get('/api/v1/food?month=2026-10')
                .set('Cookie', [`session_token=${testSessionToken}`]);
                
            expect(res.status).toBe(200);
            expect(res.body.records).toHaveLength(1);
            expect(res.body.records[0].date).toBe('2026-10-10');
            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining('SELECT id, user_id, TO_CHAR(record_date, \'YYYY-MM-DD\') as date, status, rate_paise'),
                [testUser.householdId, testUser.id, '2026-10-01', '2026-10-31']
            );
        });
    });
    
    describe('PUT /api/v1/food/:date', () => {
        const getKolkataTimeForTesting = (utcStr) => {
            return new Date(utcStr);
        };
        
        beforeEach(() => {
            // Mock time to 2026-10-10 12:00:00 UTC (17:30 IST)
            app.locals.mockTime = new Date('2026-10-10T12:00:00Z');
        });
        
        afterEach(() => {
            delete app.locals.mockTime;
        });

        it('rejects invalid status', async () => {
            const res = await request(app)
                .put('/api/v1/food/2026-10-11')
                .set('Cookie', [`session_token=${testSessionToken}`])
                .send({ status: 'INVALID_STATUS' });
                
            expect(res.status).toBe(400);
        });
        
        it('rejects updates for today', async () => {
            const res = await request(app)
                .put('/api/v1/food/2026-10-10')
                .set('Cookie', [`session_token=${testSessionToken}`])
                .send({ status: 'CANCELLED' });
                
            expect(res.status).toBe(403);
            expect(res.body.error.message).toMatch(/Food updates are only allowed for tomorrow/);
        });
        
        it('rejects updates for past dates', async () => {
            const res = await request(app)
                .put('/api/v1/food/2026-10-09')
                .set('Cookie', [`session_token=${testSessionToken}`])
                .send({ status: 'CANCELLED' });
                
            expect(res.status).toBe(403);
        });
        
        it('rejects updates for dates later than tomorrow', async () => {
            const res = await request(app)
                .put('/api/v1/food/2026-10-12')
                .set('Cookie', [`session_token=${testSessionToken}`])
                .send({ status: 'CANCELLED' });
                
            expect(res.status).toBe(403);
        });
        
        it('allows updates for tomorrow before 23:00 IST', async () => {
            // Set time to 22:59:59.999 IST (which is 17:29:59.999 UTC)
            app.locals.mockTime = new Date('2026-10-10T17:29:59.999Z');
            
            const res = await request(app)
                .put('/api/v1/food/2026-10-11')
                .set('Cookie', [`session_token=${testSessionToken}`])
                .send({ status: 'CANCELLED' });
                
            expect(res.status).toBe(200);
            expect(res.body.record.status).toBe('CANCELLED');
            
            // Should have notified admin
            expect(mockClient.query).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO notifications'),
                expect.arrayContaining(['admin-1', 'Food Cancelled'])
            );
        });
        
        it('rejects updates for tomorrow exactly at 23:00:00.000 IST', async () => {
            // Set time to 23:00:00.000 IST (which is 17:30:00.000 UTC)
            app.locals.mockTime = new Date('2026-10-10T17:30:00.000Z');
            
            const res = await request(app)
                .put('/api/v1/food/2026-10-11')
                .set('Cookie', [`session_token=${testSessionToken}`])
                .send({ status: 'CANCELLED' });
                
            expect(res.status).toBe(403);
        });
        
        it('rejects updates for tomorrow after 23:00 IST', async () => {
            // Set time to 23:15 IST (17:45 UTC)
            app.locals.mockTime = new Date('2026-10-10T17:45:00.000Z');
            
            const res = await request(app)
                .put('/api/v1/food/2026-10-11')
                .set('Cookie', [`session_token=${testSessionToken}`])
                .send({ status: 'CANCELLED' });
                
            expect(res.status).toBe(403);
        });

        it('does not send notification if status is changed to FOOD_REQUIRED', async () => {
            app.locals.mockTime = new Date('2026-10-10T17:00:00Z'); // 22:30 IST
            
            const res = await request(app)
                .put('/api/v1/food/2026-10-11')
                .set('Cookie', [`session_token=${testSessionToken}`])
                .send({ status: 'FOOD_REQUIRED' });
                
            expect(res.status).toBe(200);
            
            const notifyCalls = mockClient.query.mock.calls.filter(call => 
                call[0].includes('INSERT INTO notifications')
            );
            expect(notifyCalls.length).toBe(0);
        });

        it('does not send duplicate notification if status is already CANCELLED', async () => {
            app.locals.mockTime = new Date('2026-10-10T17:00:00Z'); // 22:30 IST
            
            // Mock existing record as CANCELLED
            mockClient.query.mockImplementation((queryStr, params) => {
                if (queryStr === 'BEGIN' || queryStr === 'COMMIT') return Promise.resolve();
                if (queryStr.includes('SELECT id, user_id')) {
                    return Promise.resolve({ rows: [{ id: 1, user_id: testUser.id, date: '2026-10-11', status: 'CANCELLED', rate_paise: 9000 }] });
                }
                if (queryStr.includes('INSERT INTO food_records')) {
                    // Simulate WHERE food_records.status != EXCLUDED.status
                    if (params[3] === 'CANCELLED') return Promise.resolve({ rows: [] });
                    return Promise.resolve({ rows: [{ id: 1, status: 'CANCELLED', rate_paise: 9000 }] });
                }
                return Promise.resolve({ rows: [] });
            });

            const res = await request(app)
                .put('/api/v1/food/2026-10-11')
                .set('Cookie', [`session_token=${testSessionToken}`])
                .send({ status: 'CANCELLED' });
                
            expect(res.status).toBe(200);
            
            // Historical rate preservation is natively handled by SQL DO UPDATE (verified in integration tests)
            const upsertCall = mockClient.query.mock.calls.find(call => call[0].includes('INSERT INTO food_records'));
            expect(upsertCall[1][4]).toBe(10000); // JS sends current config rate, SQL ignores it if row exists

            // No notification
            const notifyCalls = mockClient.query.mock.calls.filter(call => call[0].includes('INSERT INTO notifications'));
            expect(notifyCalls.length).toBe(0);
        });

        it('rejects member cancellation if date is declared mess-unavailable', async () => {
            app.locals.mockTime = new Date('2026-10-10T17:00:00Z'); // 22:30 IST, tomorrow is 2026-10-11
            db.query.mockImplementation((queryStr) => {
                if (queryStr.includes('mess_unavailability_declarations')) {
                    return Promise.resolve({ rows: [{ id: 1, reason: 'Cook holiday', declared_by: 'admin-1' }] });
                }
                if (queryStr.includes('food_configuration')) {
                    return Promise.resolve({ rows: [{ id: 1, default_rate_paise: 10000 }] });
                }
                return Promise.resolve({ rows: [] });
            });

            const res = await request(app)
                .put('/api/v1/food/2026-10-11')
                .set('Cookie', [`session_token=${testSessionToken}`])
                .send({ status: 'CANCELLED' });

            expect(res.status).toBe(403);
            expect(res.body.error.message).toContain('Mess food is declared unavailable');
        });
    });

    describe('Mess Unavailability API Endpoints', () => {
        const testAdmin = {
            id: 'admin-1',
            name: 'Admin User',
            householdId: 1,
            role: 'ADMIN'
        };

        it('POST /api/v1/food/unavailable requires admin role', async () => {
            authService.getSessionUser.mockResolvedValue(testUser); // MEMBER
            const res = await request(app)
                .post('/api/v1/food/unavailable')
                .set('Cookie', [`session_token=${testSessionToken}`])
                .send({ date: '2026-10-15', reason: 'Mess closed' });

            expect(res.status).toBe(403);
        });

        it('POST /api/v1/food/unavailable validates date and reason', async () => {
            authService.getSessionUser.mockResolvedValue(testAdmin);
            const res = await request(app)
                .post('/api/v1/food/unavailable')
                .set('Cookie', [`session_token=${testSessionToken}`])
                .send({ date: '2026-10-15', reason: '' });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toContain('non-empty reason is required');
        });

        it('GET /api/v1/food/unavailable returns declarations for a month', async () => {
            authService.getSessionUser.mockResolvedValue(testUser);
            db.query.mockImplementation((queryStr) => {
                if (queryStr.includes('mess_unavailability_declarations')) {
                    return Promise.resolve({
                        rows: [{
                            id: 1,
                            household_id: 1,
                            declaration_date: '2026-10-15',
                            reason: 'Festival holiday',
                            declared_by: 'admin-1',
                            status: 'ACTIVE'
                        }]
                    });
                }
                return Promise.resolve({ rows: [] });
            });

            const res = await request(app)
                .get('/api/v1/food/unavailable?month=2026-10')
                .set('Cookie', [`session_token=${testSessionToken}`]);

            expect(res.status).toBe(200);
            expect(res.body.declarations).toHaveLength(1);
            expect(res.body.declarations[0].declarationDate).toBe('2026-10-15');
        });

        it('PATCH /api/v1/food/unavailable/:date/revoke requires admin and non-empty reason', async () => {
            authService.getSessionUser.mockResolvedValue(testAdmin);
            const res = await request(app)
                .patch('/api/v1/food/unavailable/2026-10-15/revoke')
                .set('Cookie', [`session_token=${testSessionToken}`])
                .send({ reason: '' });

            expect(res.status).toBe(400);
            expect(res.body.error.message).toContain('non-empty revocationReason is required');
        });
    });
});
