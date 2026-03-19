'use strict';

// Mock supabase before requiring lockout module.
// The mock factory supports chainable: .from().update().ilike() and
// .from().select().ilike().maybeSingle() patterns.

let mockUpdateData = null;
let mockUpdateError = null;
let mockSelectData = null;
let mockSelectError = null;
const mockCalls = { update: [], select: [] };

function resetMocks() {
  mockUpdateData = null;
  mockUpdateError = null;
  mockSelectData = null;
  mockSelectError = null;
  mockCalls.update = [];
  mockCalls.select = [];
}

// Build chainable mock supabase
function makeMockSupabase() {
  const mockSupabase = {
    from: jest.fn((table) => {
      const chain = {
        select: jest.fn((fields) => {
          mockCalls.select.push({ table, fields });
          return {
            ilike: jest.fn((col, val) => ({
              maybeSingle: jest.fn(() => Promise.resolve({
                data: mockSelectData,
                error: mockSelectError,
              })),
            })),
          };
        }),
        update: jest.fn((payload) => {
          mockCalls.update.push({ table, payload });
          return {
            ilike: jest.fn((col, val) => ({
              then: jest.fn((resolve) => resolve({ error: mockUpdateError })),
            })),
            eq: jest.fn((col, val) => Promise.resolve({ error: mockUpdateError })),
          };
        }),
      };
      return chain;
    }),
  };
  return mockSupabase;
}

// We test the lockout functions with an injected supabase dependency.
// The lockout module exports a factory: createLockoutFunctions(supabase, constants)
const { createLockoutFunctions } = require('./lockout');

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

describe('checkLockout', () => {
  let supabase, checkLockout;

  beforeEach(() => {
    resetMocks();
    supabase = makeMockSupabase();
    ({ checkLockout } = createLockoutFunctions(supabase, { MAX_LOGIN_ATTEMPTS, LOCKOUT_DURATION_MS }));
  });

  test('returns true when djRow.locked_until is a future timestamp', async () => {
    const futureDate = new Date(Date.now() + 60000).toISOString();
    const djRow = { locked_until: futureDate, failed_attempts: 3 };
    const result = await checkLockout(djRow);
    expect(result).toBe(true);
  });

  test('returns false when djRow.locked_until is null', async () => {
    const djRow = { locked_until: null, failed_attempts: 0 };
    const result = await checkLockout(djRow);
    expect(result).toBe(false);
  });

  test('returns false when djRow.locked_until is undefined/missing', async () => {
    const djRow = { failed_attempts: 0 };
    const result = await checkLockout(djRow);
    expect(result).toBe(false);
  });

  test('returns false when djRow.locked_until is in the past AND clears the lock', async () => {
    const pastDate = new Date(Date.now() - 60000).toISOString();
    const djRow = { id: 'test-uuid', locked_until: pastDate, failed_attempts: 5 };
    const result = await checkLockout(djRow);
    expect(result).toBe(false);
    // Should have called supabase.from('djs').update with cleared values
    expect(mockCalls.update.length).toBeGreaterThan(0);
    expect(mockCalls.update[0].table).toBe('djs');
    expect(mockCalls.update[0].payload).toEqual({ failed_attempts: 0, locked_until: null });
  });

  test('returns false when djRow is null (no crash)', async () => {
    const result = await checkLockout(null);
    expect(result).toBe(false);
  });

  test('returns false when djRow is undefined (no crash)', async () => {
    const result = await checkLockout(undefined);
    expect(result).toBe(false);
  });
});

describe('recordFailedAttempt', () => {
  let supabase, recordFailedAttempt;

  beforeEach(() => {
    resetMocks();
    supabase = makeMockSupabase();
    ({ recordFailedAttempt } = createLockoutFunctions(supabase, { MAX_LOGIN_ATTEMPTS, LOCKOUT_DURATION_MS }));
  });

  test('increments failed_attempts and does not set locked_until when below MAX', async () => {
    mockSelectData = { id: 'uuid-1', failed_attempts: 2 };
    await recordFailedAttempt('Test DJ');
    expect(mockCalls.update.length).toBeGreaterThan(0);
    const payload = mockCalls.update[0].payload;
    expect(payload.failed_attempts).toBe(3);
    expect(payload.locked_until).toBeUndefined();
  });

  test('sets locked_until when failed_attempts reaches MAX_LOGIN_ATTEMPTS', async () => {
    mockSelectData = { id: 'uuid-1', failed_attempts: 4 }; // one below MAX=5
    const before = Date.now();
    await recordFailedAttempt('Test DJ');
    const after = Date.now();
    expect(mockCalls.update.length).toBeGreaterThan(0);
    const payload = mockCalls.update[0].payload;
    expect(payload.failed_attempts).toBe(5);
    expect(payload.locked_until).toBeDefined();
    const lockedTime = new Date(payload.locked_until).getTime();
    expect(lockedTime).toBeGreaterThanOrEqual(before + LOCKOUT_DURATION_MS);
    expect(lockedTime).toBeLessThanOrEqual(after + LOCKOUT_DURATION_MS + 100);
  });

  test('does not set locked_until when failed_attempts stays below MAX', async () => {
    mockSelectData = { id: 'uuid-1', failed_attempts: 1 };
    await recordFailedAttempt('Test DJ');
    const payload = mockCalls.update[0].payload;
    expect(payload.failed_attempts).toBe(2);
    expect(payload.locked_until).toBeUndefined();
  });

  test('does not throw on supabase select error (swallows and logs)', async () => {
    mockSelectError = { message: 'DB error' };
    mockSelectData = null;
    await expect(recordFailedAttempt('Test DJ')).resolves.not.toThrow();
  });
});

describe('clearFailedAttempts', () => {
  let supabase, clearFailedAttempts;

  beforeEach(() => {
    resetMocks();
    supabase = makeMockSupabase();
    ({ clearFailedAttempts } = createLockoutFunctions(supabase, { MAX_LOGIN_ATTEMPTS, LOCKOUT_DURATION_MS }));
  });

  test('calls supabase update with failed_attempts=0 and locked_until=null', async () => {
    await clearFailedAttempts('Test DJ');
    expect(mockCalls.update.length).toBeGreaterThan(0);
    expect(mockCalls.update[0].table).toBe('djs');
    expect(mockCalls.update[0].payload).toEqual({ failed_attempts: 0, locked_until: null });
  });

  test('does not throw on supabase update error (swallows and logs)', async () => {
    mockUpdateError = { message: 'DB update error' };
    await expect(clearFailedAttempts('Test DJ')).resolves.not.toThrow();
  });
});
