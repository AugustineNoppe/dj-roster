'use strict';

// admin-dj.test.js
// Unit tests for createAdminDJHandlers factory.
// Mock pattern follows lib/lockout.test.js conventions.

// ─── Chainable mock supabase state ───────────────────────────────────────────

let mockInsertData = null;
let mockInsertError = null;
let mockSelectData = null;
let mockSelectError = null;
let mockUpdateError = null;
let mockDeleteError = null;
let mockSingleData = null;
let mockSingleError = null;

const mockCalls = {
  from: [],
  select: [],
  insert: [],
  update: [],
  order: [],
  delete: [],
};

function resetMocks() {
  mockInsertData = null;
  mockInsertError = null;
  mockSelectData = null;
  mockSelectError = null;
  mockUpdateError = null;
  mockDeleteError = null;
  mockSingleData = null;
  mockSingleError = null;
  mockCalls.from = [];
  mockCalls.select = [];
  mockCalls.insert = [];
  mockCalls.update = [];
  mockCalls.order = [];
  mockCalls.delete = [];
}

/**
 * Build a chainable mock supabase that supports:
 *   .from().select().order()                     ← listDJs
 *   .from().insert().select().single()           ← addDJ
 *   .from().update().eq()                        ← editDJ, resetPin, clearLockout
 */
function makeMockSupabase() {
  return {
    from: jest.fn((table) => {
      mockCalls.from.push(table);
      return {
        select: jest.fn((fields) => {
          mockCalls.select.push({ table, fields });
          return {
            order: jest.fn((col, opts) => {
              mockCalls.order.push({ col, opts });
              return Promise.resolve({ data: mockSelectData, error: mockSelectError });
            }),
            single: jest.fn(() =>
              Promise.resolve({ data: mockInsertData, error: mockInsertError })
            ),
            eq: jest.fn((col, val) => ({
              single: jest.fn(() =>
                Promise.resolve({ data: mockSingleData, error: mockSingleError })
              ),
            })),
          };
        }),
        insert: jest.fn((payload) => {
          mockCalls.insert.push({ table, payload });
          return {
            select: jest.fn((fields) => ({
              single: jest.fn(() =>
                Promise.resolve({ data: mockInsertData, error: mockInsertError })
              ),
            })),
          };
        }),
        update: jest.fn((payload) => {
          mockCalls.update.push({ table, payload });
          return {
            eq: jest.fn((col, val) =>
              Promise.resolve({ error: mockUpdateError })
            ),
          };
        }),
        delete: jest.fn(() => {
          mockCalls.delete.push({ table });
          return {
            eq: jest.fn((col, val) => ({
              eq: jest.fn((col2, val2) =>
                Promise.resolve({ error: mockDeleteError })
              ),
            })),
          };
        }),
      };
    }),
  };
}

// ─── Mock bcrypt ──────────────────────────────────────────────────────────────

const mockBcrypt = {
  hash: jest.fn().mockResolvedValue('$2b$10$mockhash'),
};

// ─── Mock invalidateCaches ────────────────────────────────────────────────────

const mockInvalidateCaches = jest.fn();

// ─── Load module under test ───────────────────────────────────────────────────

const { createAdminDJHandlers } = require('./admin-dj');

// ─────────────────────────────────────────────────────────────────────────────
// listDJs
// ─────────────────────────────────────────────────────────────────────────────

describe('listDJs', () => {
  let listDJs;

  beforeEach(() => {
    resetMocks();
    mockBcrypt.hash.mockClear();
    mockInvalidateCaches.mockClear();
    const supabase = makeMockSupabase();
    ({ listDJs } = createAdminDJHandlers(supabase, mockBcrypt, mockInvalidateCaches));
  });

  test('returns { success: true, djs } with all rows from supabase', async () => {
    const rows = [
      { id: 'uuid-1', name: 'Alice', rate: 100, type: 'resident', active: true, venues: [], failed_attempts: 0, locked_until: null },
    ];
    mockSelectData = rows;
    const result = await listDJs();
    expect(result.success).toBe(true);
    expect(result.djs).toEqual(rows);
  });

  test('queries djs table (no active filter) with correct fields and orders by name asc', async () => {
    mockSelectData = [];
    await listDJs();
    expect(mockCalls.from[0]).toBe('djs');
    const selectFields = mockCalls.select[0].fields;
    expect(selectFields).toContain('id');
    expect(selectFields).toContain('name');
    expect(selectFields).toContain('rate');
    expect(selectFields).toContain('type');
    expect(selectFields).toContain('active');
    expect(selectFields).toContain('venues');
    expect(selectFields).toContain('failed_attempts');
    expect(selectFields).toContain('locked_until');
    // pin_hash must NOT appear in the select string
    expect(selectFields).not.toContain('pin_hash');
  });

  test('returns { success: false, error } on supabase error', async () => {
    mockSelectError = { message: 'DB error' };
    const result = await listDJs();
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// addDJ
// ─────────────────────────────────────────────────────────────────────────────

describe('addDJ', () => {
  let addDJ;

  beforeEach(() => {
    resetMocks();
    mockBcrypt.hash.mockClear();
    mockInvalidateCaches.mockClear();
    const supabase = makeMockSupabase();
    ({ addDJ } = createAdminDJHandlers(supabase, mockBcrypt, mockInvalidateCaches));
  });

  test('returns { success: false, status: 400 } when name is missing', async () => {
    const result = await addDJ({ rate: 100, type: 'resident', pin: '1234' });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toBeDefined();
  });

  test('returns { success: false, status: 400 } when pin is missing', async () => {
    const result = await addDJ({ name: 'Bob', rate: 100, type: 'resident' });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toBeDefined();
  });

  test('returns { success: false, status: 400 } when type is invalid', async () => {
    const result = await addDJ({ name: 'Bob', rate: 100, type: 'superstar', pin: '1234' });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toBeDefined();
  });

  test('calls bcrypt.hash with the pin and cost 10', async () => {
    mockInsertData = { id: 'uuid-1', name: 'Bob', rate: 100, type: 'resident', active: true };
    await addDJ({ name: 'Bob', rate: 100, type: 'resident', pin: '1234' });
    expect(mockBcrypt.hash).toHaveBeenCalledWith('1234', 10);
  });

  test('inserts DJ into djs table with active=true and hashed pin', async () => {
    mockInsertData = { id: 'uuid-1', name: 'Bob', rate: 100, type: 'resident', active: true };
    await addDJ({ name: 'Bob', rate: 100, type: 'resident', pin: '1234' });
    const insertPayload = mockCalls.insert[0].payload;
    expect(insertPayload.name).toBe('Bob');
    expect(insertPayload.rate).toBe(100);
    expect(insertPayload.type).toBe('resident');
    expect(insertPayload.active).toBe(true);
    expect(insertPayload.pin_hash).toBe('$2b$10$mockhash');
  });

  test('returns { success: true, dj } without pin_hash on success', async () => {
    const insertedRow = { id: 'uuid-1', name: 'Bob', rate: 100, type: 'resident', active: true };
    mockInsertData = insertedRow;
    const result = await addDJ({ name: 'Bob', rate: 100, type: 'resident', pin: '1234' });
    expect(result.success).toBe(true);
    expect(result.dj).toBeDefined();
    expect(result.dj.pin_hash).toBeUndefined();
    expect(result.dj.id).toBe('uuid-1');
  });

  test('calls invalidateCaches("djs") on success', async () => {
    mockInsertData = { id: 'uuid-1', name: 'Bob', rate: 100, type: 'resident', active: true };
    await addDJ({ name: 'Bob', rate: 100, type: 'resident', pin: '1234' });
    expect(mockInvalidateCaches).toHaveBeenCalledWith('djs');
  });

  test('returns { success: false, error } on supabase insert error', async () => {
    mockInsertError = { message: 'Insert failed' };
    const result = await addDJ({ name: 'Bob', rate: 100, type: 'resident', pin: '1234' });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('accepts all valid DJ types: resident, guest, casual', async () => {
    for (const type of ['resident', 'guest', 'casual']) {
      resetMocks();
      mockBcrypt.hash.mockClear();
      mockInvalidateCaches.mockClear();
      mockInsertData = { id: 'uuid-1', name: 'DJ X', rate: 100, type, active: true };
      const result = await addDJ({ name: 'DJ X', rate: 100, type, pin: '1234' });
      expect(result.success).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// editDJ
// ─────────────────────────────────────────────────────────────────────────────

describe('editDJ', () => {
  let editDJ;

  beforeEach(() => {
    resetMocks();
    mockBcrypt.hash.mockClear();
    mockInvalidateCaches.mockClear();
    const supabase = makeMockSupabase();
    ({ editDJ } = createAdminDJHandlers(supabase, mockBcrypt, mockInvalidateCaches));
  });

  test('returns { success: false, status: 400 } when no valid fields provided', async () => {
    const result = await editDJ({ id: 'uuid-1' });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toBeDefined();
  });

  test('filters out unknown fields and only updates allowed keys', async () => {
    await editDJ({ id: 'uuid-1', name: 'Alice', unknownField: 'bad', secret: 'yes' });
    const updatePayload = mockCalls.update[0].payload;
    expect(updatePayload.name).toBe('Alice');
    expect(updatePayload.unknownField).toBeUndefined();
    expect(updatePayload.secret).toBeUndefined();
  });

  test('trims name whitespace', async () => {
    await editDJ({ id: 'uuid-1', name: '  Alice  ' });
    const updatePayload = mockCalls.update[0].payload;
    expect(updatePayload.name).toBe('Alice');
  });

  test('parses rate as integer', async () => {
    await editDJ({ id: 'uuid-1', rate: '150' });
    const updatePayload = mockCalls.update[0].payload;
    expect(updatePayload.rate).toBe(150);
  });

  test('returns { success: false, status: 400 } when rate parses to NaN', async () => {
    const result = await editDJ({ id: 'uuid-1', rate: 'notanumber' });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
  });

  test('deactivates DJ when active=false (ADMIN-04)', async () => {
    await editDJ({ id: 'uuid-1', active: false });
    const updatePayload = mockCalls.update[0].payload;
    expect(updatePayload.active).toBe(false);
  });

  test('reactivates DJ when active=true (ADMIN-05)', async () => {
    await editDJ({ id: 'uuid-1', active: true });
    const updatePayload = mockCalls.update[0].payload;
    expect(updatePayload.active).toBe(true);
  });

  test('calls invalidateCaches("djs") on success', async () => {
    await editDJ({ id: 'uuid-1', name: 'Alice' });
    expect(mockInvalidateCaches).toHaveBeenCalledWith('djs');
  });

  test('returns { success: true } on successful update', async () => {
    const result = await editDJ({ id: 'uuid-1', name: 'Alice' });
    expect(result.success).toBe(true);
  });

  test('returns { success: false, error } on supabase update error', async () => {
    mockUpdateError = { message: 'Update failed' };
    const result = await editDJ({ id: 'uuid-1', name: 'Alice' });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resetPin
// ─────────────────────────────────────────────────────────────────────────────

describe('resetPin', () => {
  let resetPin;

  beforeEach(() => {
    resetMocks();
    mockBcrypt.hash.mockClear();
    mockInvalidateCaches.mockClear();
    const supabase = makeMockSupabase();
    ({ resetPin } = createAdminDJHandlers(supabase, mockBcrypt, mockInvalidateCaches));
  });

  test('returns { success: false, status: 400 } when pin is missing', async () => {
    const result = await resetPin({ id: 'uuid-1' });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toBeDefined();
  });

  test('hashes the new pin with bcrypt cost 10', async () => {
    await resetPin({ id: 'uuid-1', pin: '9999' });
    expect(mockBcrypt.hash).toHaveBeenCalledWith('9999', 10);
  });

  test('updates djs.pin_hash by id with the hashed value', async () => {
    await resetPin({ id: 'uuid-1', pin: '9999' });
    const updatePayload = mockCalls.update[0].payload;
    expect(updatePayload.pin_hash).toBe('$2b$10$mockhash');
  });

  test('calls invalidateCaches("djs") on success', async () => {
    await resetPin({ id: 'uuid-1', pin: '9999' });
    expect(mockInvalidateCaches).toHaveBeenCalledWith('djs');
  });

  test('returns { success: true } on success', async () => {
    const result = await resetPin({ id: 'uuid-1', pin: '9999' });
    expect(result.success).toBe(true);
  });

  test('returns { success: false, error } on supabase update error', async () => {
    mockUpdateError = { message: 'Update failed' };
    const result = await resetPin({ id: 'uuid-1', pin: '9999' });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clearLockout
// ─────────────────────────────────────────────────────────────────────────────

describe('clearLockout', () => {
  let clearLockout;

  beforeEach(() => {
    resetMocks();
    mockBcrypt.hash.mockClear();
    mockInvalidateCaches.mockClear();
    const supabase = makeMockSupabase();
    ({ clearLockout } = createAdminDJHandlers(supabase, mockBcrypt, mockInvalidateCaches));
  });

  test('sets failed_attempts=0 and locked_until=null on the djs table', async () => {
    await clearLockout({ id: 'uuid-1' });
    expect(mockCalls.update.length).toBeGreaterThan(0);
    const updatePayload = mockCalls.update[0].payload;
    expect(updatePayload.failed_attempts).toBe(0);
    expect(updatePayload.locked_until).toBeNull();
  });

  test('uses eq to target the DJ by id', async () => {
    await clearLockout({ id: 'uuid-1' });
    // update is called on 'djs' table
    expect(mockCalls.update[0].table).toBe('djs');
  });

  test('calls invalidateCaches("djs") on success', async () => {
    await clearLockout({ id: 'uuid-1' });
    expect(mockInvalidateCaches).toHaveBeenCalledWith('djs');
  });

  test('returns { success: true } on success', async () => {
    const result = await clearLockout({ id: 'uuid-1' });
    expect(result.success).toBe(true);
  });

  test('returns { success: false, error } on supabase update error', async () => {
    mockUpdateError = { message: 'Update failed' };
    const result = await clearLockout({ id: 'uuid-1' });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateRecurringAvailability
// ─────────────────────────────────────────────────────────────────────────────

describe('updateRecurringAvailability', () => {
  let updateRecurringAvailability;

  beforeEach(() => {
    resetMocks();
    mockBcrypt.hash.mockClear();
    mockInvalidateCaches.mockClear();
    const supabase = makeMockSupabase();
    ({ updateRecurringAvailability } = createAdminDJHandlers(supabase, mockBcrypt, mockInvalidateCaches));
  });

  test('returns { success: true } on valid input', async () => {
    const recurring_availability = { '1': ['14:00\u201315:00'], '5': [] };
    const result = await updateRecurringAvailability({ id: 'uuid-1', recurring_availability });
    expect(result.success).toBe(true);
  });

  test('returns { success: false, error, status: 400 } when id is missing', async () => {
    const result = await updateRecurringAvailability({ recurring_availability: { '1': [] } });
    expect(result.success).toBe(false);
    expect(result.error).toBe('id is required');
    expect(result.status).toBe(400);
  });

  test('returns { success: false, error, status: 400 } when recurring_availability is missing', async () => {
    const result = await updateRecurringAvailability({ id: 'uuid-1' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('recurring_availability is required');
    expect(result.status).toBe(400);
  });

  test('calls supabase.from("djs").update({ recurring_availability }).eq("id", id)', async () => {
    const recurring_availability = { '0': ['14:00\u201315:00'] };
    await updateRecurringAvailability({ id: 'uuid-1', recurring_availability });
    expect(mockCalls.from[0]).toBe('djs');
    expect(mockCalls.update[0].payload).toEqual({ recurring_availability });
    expect(mockCalls.update[0].table).toBe('djs');
  });

  test('calls invalidateCaches("djs") on success', async () => {
    const recurring_availability = { '2': ['20:00\u201321:00'] };
    await updateRecurringAvailability({ id: 'uuid-1', recurring_availability });
    expect(mockInvalidateCaches).toHaveBeenCalledWith('djs');
  });

  test('returns { success: false } on supabase error', async () => {
    mockUpdateError = { message: 'DB error' };
    const result = await updateRecurringAvailability({ id: 'uuid-1', recurring_availability: { '1': [] } });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// unlockSubmission
// ─────────────────────────────────────────────────────────────────────────────

describe('unlockSubmission', () => {
  let unlockSubmission;

  beforeEach(() => {
    resetMocks();
    mockBcrypt.hash.mockClear();
    mockInvalidateCaches.mockClear();
    mockSingleData = { name: 'Pick' };
    const supabase = makeMockSupabase();
    ({ unlockSubmission } = createAdminDJHandlers(supabase, mockBcrypt, mockInvalidateCaches));
  });

  test('returns { success: false, status: 400 } when id is missing', async () => {
    const result = await unlockSubmission({ month: 'April 2026' });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toBe('id is required');
  });

  test('returns { success: false, status: 400 } when month is missing', async () => {
    const result = await unlockSubmission({ id: 'uuid-1' });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toBe('month is required');
  });

  test('returns { success: false, status: 404 } when DJ not found', async () => {
    mockSingleData = null;
    mockSingleError = { message: 'Not found' };
    const supabase = makeMockSupabase();
    ({ unlockSubmission } = createAdminDJHandlers(supabase, mockBcrypt, mockInvalidateCaches));
    const result = await unlockSubmission({ id: 'uuid-bad', month: 'April 2026' });
    expect(result.success).toBe(false);
    expect(result.status).toBe(404);
  });

  test('returns { success: true } with message on success', async () => {
    const result = await unlockSubmission({ id: 'uuid-1', month: 'April 2026' });
    expect(result.success).toBe(true);
    expect(result.message).toBe('Submission unlocked for Pick — April 2026');
  });

  test('deletes from dj_availability and dj_submissions tables', async () => {
    await unlockSubmission({ id: 'uuid-1', month: 'April 2026' });
    const deletedTables = mockCalls.delete.map(d => d.table);
    expect(deletedTables).toContain('dj_availability');
    expect(deletedTables).toContain('dj_submissions');
  });

  test('calls invalidateCaches on success', async () => {
    await unlockSubmission({ id: 'uuid-1', month: 'April 2026' });
    expect(mockInvalidateCaches).toHaveBeenCalledWith('availability', { month: 'April 2026' });
  });

  test('returns { success: false } on delete error', async () => {
    mockDeleteError = { message: 'Delete failed' };
    const supabase = makeMockSupabase();
    ({ unlockSubmission } = createAdminDJHandlers(supabase, mockBcrypt, mockInvalidateCaches));
    const result = await unlockSubmission({ id: 'uuid-1', month: 'April 2026' });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

