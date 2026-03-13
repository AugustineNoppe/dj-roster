# Testing Patterns

**Analysis Date:** 2026-03-13

## Test Framework

**Status:** No testing framework detected

**Runner:**
- Not installed or configured
- No test files present in codebase (`**/*.test.js`, `**/*.spec.js`, etc.)
- No test configuration files (`jest.config.js`, `vitest.config.js`, `mocha.config.js`)

**Package Status:**
- `package.json` (`/c/Users/gusno/dj-roster/package.json`) contains only production dependencies
- No dev dependencies configured
- No test scripts defined in `"scripts"` section

**Assertion Library:**
- Not applicable; no testing framework in use

## Run Commands

**Current state:**
```bash
npm start              # Runs server.js (only available command)
```

**Expected test commands (not implemented):**
- `npm test` - Would run test suite (undefined)
- `npm run test:watch` - Watch mode (undefined)
- `npm run coverage` - Coverage report (undefined)

## Test File Organization

**Location:**
- No test files present
- No testing directory structure (`test/`, `tests/`, `__tests__/`, `spec/`)

**Naming:**
- Not applicable; no test files

**Suggested structure for future tests:**
```
/test or /tests
├── unit/
│   ├── auth.test.js
│   ├── cache.test.js
│   ├── roster.test.js
│   └── dj-availability.test.js
├── integration/
│   ├── api.test.js
│   └── database.test.js
└── fixtures/
    ├── mock-djs.json
    └── mock-roster.json
```

## Test Structure

**Current state:** No tests exist

**If tests were to be implemented, patterns to follow based on codebase structure:**

**Unit test pattern** (hypothetical for a fetcher function):
```javascript
describe('fetchDJs', () => {
  let supabase;

  beforeEach(() => {
    // Mock setup
    supabase = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue({
          data: [{ name: 'Test DJ', rate: 100 }],
          error: null
        })
      })
    };
  });

  afterEach(() => {
    cache.djs.data = null; // Reset cache
  });

  it('should return cached data on second call within TTL', async () => {
    const result1 = await fetchDJs();
    const result2 = await fetchDJs();

    expect(result1.djs).toEqual(result2.djs);
    expect(supabase.from).toHaveBeenCalledTimes(1); // Called only once
  });

  it('should parse rate as integer', async () => {
    const result = await fetchDJs();
    expect(result.djs[0].rate).toBe(100);
    expect(typeof result.djs[0].rate).toBe('number');
  });
});
```

**API route test pattern** (hypothetical):
```javascript
describe('POST /api/roster/assign', () => {
  it('should require admin authentication', async () => {
    const response = await request(app)
      .post('/api/roster/assign')
      .send({ venue: 'arkbar', date: '2026-03-15', slot: '14:00–15:00', dj: 'Test DJ', month: 'March 2026' })
      .set('x-admin-password', 'wrong');

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it('should normalize slot format in database write', async () => {
    // Track database call
    const supabaseSpy = jest.spyOn(supabase, 'from');

    await request(app)
      .post('/api/roster/assign')
      .send({ venue: 'arkbar', date: '2026-03-15', slot: '14:00-15:00', dj: 'Test DJ', month: 'March 2026' })
      .set('x-admin-password', process.env.ADMIN_PASSWORD);

    expect(supabaseSpy).toHaveBeenCalledWith('roster_assignments');
    // Verify slot was normalized to en-dash
  });

  it('should invalidate roster cache after assignment', async () => {
    const cacheDeleteSpy = jest.spyOn(cache.roster, 'delete');

    await request(app)
      .post('/api/roster/assign')
      .send({ ... })
      .set('x-admin-password', process.env.ADMIN_PASSWORD);

    expect(cacheDeleteSpy).toHaveBeenCalledWith('arkbar|March 2026');
  });
});
```

## Mocking

**Framework:** Not applicable (no testing framework)

**What would be mocked if tests existed:**

**Supabase client:**
```javascript
// Mock pattern used in Express middleware testing
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn().mockReturnValue({
    from: jest.fn().mockReturnValue({
      select: jest.fn(),
      insert: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      eq: jest.fn(),
      ilike: jest.fn(),
      single: jest.fn(),
      maybeSingle: jest.fn()
    })
  })
}));
```

**Express request/response mocking:**
- Would use `supertest` library for HTTP testing
- Mock request objects would include headers: `x-admin-password`, `x-dj-pin`, `origin`
- Mock response would verify JSON output format: `{ success, error?, ...data }`

**Cache mocking:**
- Cache state reset before each test
- Cache TTL can be overridden in tests to avoid timing issues
- Cache lookup patterns testable by mocking `Date.now()`

**What to Mock:**
- Supabase queries (database operations must be isolated)
- Date/time (for cache TTL testing): `jest.useFakeTimers()`
- Environment variables: `process.env.ADMIN_PASSWORD`, `process.env.SUPABASE_URL`
- External API calls (Supabase realtime)

**What NOT to Mock:**
- Express routing mechanics (test actual routing behavior)
- Middleware chain execution (test auth flows end-to-end)
- Utility functions like `normalizeSlot()`, `parseDateKey()` (deterministic, no side effects)
- Cache invalidation logic (ensure it actually executes)

## Fixtures and Test Data

**Test Data Patterns** (if tests were written):

```javascript
const mockDJs = [
  { name: 'Alex RedWhite', rate: 80 },
  { name: 'Raffo DJ', rate: 75 },
  { name: 'Sound Bogie', rate: 85 },
];

const mockAvailability = {
  '2026-03-15': {
    '14:00–15:00': ['Alex RedWhite', 'Sound Bogie', 'Guest DJ'],
    '15:00–16:00': ['Raffo DJ', 'Guest DJ'],
  },
  '2026-03-16': {
    '14:00–15:00': ['Guest DJ'],
  }
};

const mockRoster = [
  ['2026-03-15', '14:00–15:00', 'Alex RedWhite', 'March 2026'],
  ['2026-03-15', '15:00–16:00', 'Raffo DJ', 'March 2026'],
];
```

**Location** (hypothetical):
- `test/fixtures/mock-data.js` - Shared test data
- `test/fixtures/responses.js` - Sample API response objects

## Coverage

**Requirements:**
- No coverage thresholds currently defined or enforced
- No coverage tools configured

**Recommendation for future implementation:**
- Target 80%+ coverage for route handlers (critical paths)
- Target 90%+ coverage for utility functions (normalizeSlot, parseDateKey, etc.)
- Target 100% coverage for auth middleware
- Cache layer partial coverage acceptable (many edge cases hard to test without timing)

## Test Types

**Unit Tests** (not implemented):
- **Scope:** Individual functions like `normalizeSlot()`, `parseDateKey()`, `makeDateKey()`, `pad2()`
- **Approach:** Pure function testing, no async, no side effects
- **Example:** Verify slot normalization converts all dash variants to en-dash
- **How to test:** Direct function calls with various input formats

**Integration Tests** (not implemented):
- **Scope:** API route → Supabase → Response flow
- **Approach:** Mock Supabase client, test full request/response cycle
- **Example:** POST /api/roster/assign updates database and invalidates cache
- **How to test:** Use `supertest` with mocked Supabase client
- **Critical paths to test:**
  - `/api/roster/assign` - single cell assignment with auth
  - `/api/roster/batch` - batch assignment with mutex lock
  - `/api/dj/availability` - availability submission with cache invalidation
  - `/api/roster/finalize` - monthly finalization with cost calculation

**E2E Tests** (not applicable):
- Not used in this codebase
- Would require Playwright or Cypress for browser testing
- Frontend logic in HTML files would require separate E2E framework

## Common Patterns

**Rate Limiter Testing** (hypothetical):
```javascript
describe('Rate Limiter', () => {
  it('should allow 10 requests within 60s window', async () => {
    const ip = '192.168.1.1';
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post('/api/auth')
        .send({ password: 'test' });
      expect(res.status).not.toBe(429);
    }
  });

  it('should block 11th request within window', async () => {
    // After 10 requests...
    const res = await request(app)
      .post('/api/auth')
      .send({ password: 'test' });
    expect(res.status).toBe(429);
    expect(res.body.error).toContain('Too many attempts');
  });

  it('should reset count after 60s window expires', async () => {
    jest.useFakeTimers();
    // Make 10 requests
    // Advance time 60001ms
    // Next request should succeed
    jest.runOnlyPendingTimers();
  });
});
```

**Cache Testing** (hypothetical):
```javascript
describe('Cache Layer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    cache.djs = { data: null, time: 0, ttl: 10 * 60 * 1000 };
  });

  it('should return cached data within TTL', async () => {
    const result1 = await fetchDJs();
    jest.advanceTimersByTime(5 * 60 * 1000); // 5 minutes
    const result2 = await fetchDJs();
    expect(result1).toBe(result2);
  });

  it('should refresh data after TTL expires', async () => {
    const result1 = await fetchDJs();
    jest.advanceTimersByTime(11 * 60 * 1000); // 11 minutes
    const result2 = await fetchDJs();
    expect(result1).not.toBe(result2);
  });
});
```

**Error Handling Testing** (hypothetical):
```javascript
describe('Error Handling', () => {
  it('should catch database errors and return safe error message', async () => {
    supabase.from.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'Connection timeout' }
      })
    });

    const res = await request(app).get('/api/djs');
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Connection timeout');
  });

  it('should log context for debugging without exposing secrets', async () => {
    const consoleSpy = jest.spyOn(console, 'error');
    // Trigger error in requireDJAuth

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[requireDJAuth]')
    );
    // Verify pin value was not logged
    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('pin: 1234')
    );
  });
});
```

**Authentication Testing** (hypothetical):
```javascript
describe('Authentication Middleware', () => {
  describe('requireAdmin', () => {
    it('should reject requests without admin password header', async () => {
      const res = await request(app)
        .post('/api/roster/assign')
        .send({ ... });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorised');
    });

    it('should accept requests with correct admin password', async () => {
      // Mock successful assignment
      const res = await request(app)
        .post('/api/roster/assign')
        .send({ ... })
        .set('x-admin-password', process.env.ADMIN_PASSWORD);
      expect(res.body.success).toBe(true);
    });
  });

  describe('requireDJAuth', () => {
    it('should verify DJ pin matches database record', async () => {
      supabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          ilike: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: { pin: '1234' },
              error: null
            })
          })
        })
      });

      const res = await request(app)
        .post('/api/dj/availability')
        .send({ name: 'Test DJ', month: 'March 2026', slots: [] })
        .set('x-dj-pin', '1234');

      expect(res.body.success).toBe(true);
    });

    it('should reject mismatched PIN', async () => {
      // ... setup with pin '1234' ...
      const res = await request(app)
        .post('/api/dj/availability')
        .send({ ... })
        .set('x-dj-pin', '5678');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorised');
    });
  });
});
```

## Getting Started with Tests

**Recommended setup for future implementation:**

1. **Install testing framework:**
   ```bash
   npm install --save-dev jest supertest
   npm install --save-dev jest-environment-node
   ```

2. **Create Jest config** (`jest.config.js`):
   ```javascript
   module.exports = {
     testEnvironment: 'node',
     coveragePathIgnorePatterns: ['/node_modules/'],
     testMatch: ['**/test/**/*.test.js'],
     setupFilesAfterEnv: ['<rootDir>/test/setup.js']
   };
   ```

3. **Add test scripts to `package.json`:**
   ```json
   {
     "scripts": {
       "test": "jest",
       "test:watch": "jest --watch",
       "coverage": "jest --coverage"
     }
   }
   ```

4. **Priority test targets:**
   - Authentication middleware (`requireAdmin`, `requireDJAuth`)
   - Rate limiter
   - Cache invalidation logic
   - Slot normalization and date parsing utilities
   - Critical routes: `/api/roster/assign`, `/api/roster/batch`, `/api/dj/availability/submit`

---

*Testing analysis: 2026-03-13*
