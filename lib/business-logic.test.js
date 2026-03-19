'use strict';

const {
  normalizeSlot,
  pad2,
  makeDateKey,
  parseDateKey,
  buildAvailabilityMap,
  computeFinalizationReport,
  getDJTemplateBlocks,
  FIXED_SCHEDULES,
  DIAG_FIXED_TEMPLATE,
} = require('./business-logic');

/* == UTILITY FUNCTIONS ===================================================== */

describe('Utility functions', () => {
  describe('normalizeSlot', () => {
    test('converts ASCII hyphen to en-dash', () => {
      expect(normalizeSlot('14:00-15:00')).toBe('14:00\u201315:00');
    });

    test('converts en-dash to en-dash (idempotent)', () => {
      expect(normalizeSlot('14:00\u201315:00')).toBe('14:00\u201315:00');
    });

    test('converts em-dash to en-dash', () => {
      expect(normalizeSlot('14:00\u201415:00')).toBe('14:00\u201315:00');
    });

    test('returns null for null input', () => {
      expect(normalizeSlot(null)).toBeNull();
    });

    test('returns undefined for undefined input (falsy passthrough)', () => {
      expect(normalizeSlot(undefined)).toBeUndefined();
    });

    test('handles full-day range with multiple dashes', () => {
      expect(normalizeSlot('22:00-23:00')).toBe('22:00\u201323:00');
    });
  });

  describe('pad2', () => {
    test('pads single digit to 2 chars', () => {
      expect(pad2(1)).toBe('01');
    });

    test('does not pad double digit', () => {
      expect(pad2(10)).toBe('10');
    });

    test('pads 0 to "00"', () => {
      expect(pad2(0)).toBe('00');
    });
  });

  describe('makeDateKey', () => {
    test('zero-pads single-digit month and day', () => {
      expect(makeDateKey(2026, 3, 5)).toBe('2026-03-05');
    });

    test('handles double-digit month and day', () => {
      expect(makeDateKey(2026, 12, 31)).toBe('2026-12-31');
    });

    test('handles single-digit day with double-digit month', () => {
      expect(makeDateKey(2026, 11, 1)).toBe('2026-11-01');
    });
  });

  describe('parseDateKey', () => {
    test('returns YYYY-MM-DD unchanged', () => {
      expect(parseDateKey('2026-03-15')).toBe('2026-03-15');
    });

    test('parses D Mon YYYY format', () => {
      expect(parseDateKey('15 Mar 2026')).toBe('2026-03-15');
    });

    test('parses single-digit D Mon YYYY', () => {
      expect(parseDateKey('5 Mar 2026')).toBe('2026-03-05');
    });

    test('parses M/D/YYYY format', () => {
      expect(parseDateKey('3/15/2026')).toBe('2026-03-15');
    });

    test('parses YYYY/MM/DD format', () => {
      expect(parseDateKey('2026/03/15')).toBe('2026-03-15');
    });

    test('returns null for null input', () => {
      expect(parseDateKey(null)).toBeNull();
    });

    test('returns null for empty string', () => {
      expect(parseDateKey('')).toBeNull();
    });

    test('returns null for garbage input', () => {
      expect(parseDateKey('not-a-date')).toBeNull();
    });
  });
});

/* == AVAILABILITY LOGIC ==================================================== */

describe('Availability logic (buildAvailabilityMap)', () => {
  // March 2026: 31 days, starts on Sunday (dow=0)
  const MARCH_2026 = 'March 2026';

  test('returns Guest DJ on all slots for all days when no portal data', () => {
    const map = buildAvailabilityMap({
      portalRows: [],
      submittedNames: new Set(),
      month: MARCH_2026,
      fixedSchedules: {},
    });
    // March 2026 has 31 days
    expect(Object.keys(map)).toHaveLength(31);
    // Every date key exists
    expect(map['2026-03-01']).toBeDefined();
    expect(map['2026-03-31']).toBeDefined();
    // Guest DJ appears on every slot for a sample date
    const slots = Object.values(map['2026-03-01']);
    slots.forEach(djList => {
      expect(djList).toContain('Guest DJ');
    });
  });

  test('includes submitted DJ who marked available', () => {
    const map = buildAvailabilityMap({
      portalRows: [
        { name: 'Alex RedWhite', date: '2026-03-15', slot: '20:00\u201321:00', month: MARCH_2026, status: 'available' },
      ],
      submittedNames: new Set(['alex redwhite']),
      month: MARCH_2026,
      fixedSchedules: {},
    });
    expect(map['2026-03-15']['20:00\u201321:00']).toContain('Alex RedWhite');
  });

  test('excludes DJ who is not in submittedNames', () => {
    const map = buildAvailabilityMap({
      portalRows: [
        { name: 'Alex RedWhite', date: '2026-03-15', slot: '20:00\u201321:00', month: MARCH_2026, status: 'available' },
      ],
      submittedNames: new Set(), // empty — Alex has not submitted
      month: MARCH_2026,
      fixedSchedules: {},
    });
    expect(map['2026-03-15']['20:00\u201321:00']).not.toContain('Alex RedWhite');
    // Guest DJ still present
    expect(map['2026-03-15']['20:00\u201321:00']).toContain('Guest DJ');
  });

  test('excludes unavailable status slots from the DJ list', () => {
    const map = buildAvailabilityMap({
      portalRows: [
        { name: 'Raffo DJ', date: '2026-03-10', slot: '22:00\u201323:00', month: MARCH_2026, status: 'unavailable' },
      ],
      submittedNames: new Set(['raffo dj']),
      month: MARCH_2026,
      fixedSchedules: {},
    });
    expect(map['2026-03-10']['22:00\u201323:00']).not.toContain('Raffo DJ');
  });

  test('normalizes hyphen slots in portal rows', () => {
    const map = buildAvailabilityMap({
      portalRows: [
        { name: 'Alex RedWhite', date: '2026-03-15', slot: '20:00-21:00', month: MARCH_2026, status: 'available' },
      ],
      submittedNames: new Set(['alex redwhite']),
      month: MARCH_2026,
      fixedSchedules: {},
    });
    // Should appear under normalized en-dash key
    expect(map['2026-03-15']['20:00\u201321:00']).toContain('Alex RedWhite');
  });

  test('injects FIXED_SCHEDULES DJ (Davoted) on correct weekdays', () => {
    // March 2026: 2026-03-05 is Thursday (dow=4)
    const dow4Date = new Date(2026, 2, 5).getDay(); // should be 4
    expect(dow4Date).toBe(4);

    const map = buildAvailabilityMap({
      portalRows: [],
      submittedNames: new Set(),
      month: MARCH_2026,
      fixedSchedules: FIXED_SCHEDULES,
    });
    // Davoted has arkbar Thursday (dow=4): 14:00-15:00, 15:00-16:00, 20:00-21:00, 21:00-22:00, 22:00-23:00
    expect(map['2026-03-05']['14:00\u201315:00']).toContain('Davoted');
    expect(map['2026-03-05']['20:00\u201321:00']).toContain('Davoted');
    expect(map['2026-03-05']['22:00\u201323:00']).toContain('Davoted');
  });

  test('does NOT inject FIXED_SCHEDULES DJ on wrong weekdays', () => {
    // March 1 is Sunday (dow=0) — Davoted is not scheduled on Sunday in FIXED_SCHEDULES
    const map = buildAvailabilityMap({
      portalRows: [],
      submittedNames: new Set(),
      month: MARCH_2026,
      fixedSchedules: FIXED_SCHEDULES,
    });
    const sunSlots = Object.values(map['2026-03-01'] || {});
    const allDJs = sunSlots.flat();
    expect(allDJs).not.toContain('Davoted');
  });

  test('ignores portal rows for a different month', () => {
    const map = buildAvailabilityMap({
      portalRows: [
        { name: 'Alex RedWhite', date: '2026-04-15', slot: '20:00\u201321:00', month: 'April 2026', status: 'available' },
      ],
      submittedNames: new Set(['alex redwhite']),
      month: MARCH_2026, // querying for March
      fixedSchedules: {},
    });
    // April row should not appear in March map
    expect(map['2026-04-15']).toBeUndefined();
  });
});

/* == FINALIZATION ACCOUNTING =============================================== */

describe('Finalization accounting (computeFinalizationReport)', () => {
  test('calculates hours per venue correctly for one DJ', () => {
    const signoffRows = [
      { name: 'Alex RedWhite', date: '2026-03-01', slot: '20:00\u201321:00', venue: 'arkbar', action: 'sign' },
      { name: 'Alex RedWhite', date: '2026-03-02', slot: '21:00\u201322:00', venue: 'hip', action: 'sign' },
      { name: 'Alex RedWhite', date: '2026-03-03', slot: '22:00\u201323:00', venue: 'love', action: 'sign' },
    ];
    const djRateMap = { 'alex redwhite': { name: 'Alex RedWhite', rate: 100 } };
    const { report, grandTotal, grandCost } = computeFinalizationReport({ signoffRows, djRateMap });

    expect(report).toHaveLength(1);
    expect(report[0].name).toBe('Alex RedWhite');
    expect(report[0].arkbar).toBe(1);
    expect(report[0].hip).toBe(1);
    expect(report[0].love).toBe(1);
    expect(report[0].total).toBe(3);
    expect(grandTotal).toBe(3);
    expect(grandCost).toBe(300);
  });

  test('applies last-action-wins: sign then unsign = not counted', () => {
    const signoffRows = [
      { name: 'Raffo DJ', date: '2026-03-05', slot: '20:00\u201321:00', venue: 'arkbar', action: 'sign' },
      { name: 'Raffo DJ', date: '2026-03-05', slot: '20:00\u201321:00', venue: 'arkbar', action: 'unsign' },
    ];
    const djRateMap = { 'raffo dj': { name: 'Raffo DJ', rate: 200 } };
    const { report, grandTotal, grandCost } = computeFinalizationReport({ signoffRows, djRateMap });

    expect(report).toHaveLength(0);
    expect(grandTotal).toBe(0);
    expect(grandCost).toBe(0);
  });

  test('applies last-action-wins: unsign then sign = counted', () => {
    const signoffRows = [
      { name: 'Raffo DJ', date: '2026-03-05', slot: '20:00\u201321:00', venue: 'arkbar', action: 'unsign' },
      { name: 'Raffo DJ', date: '2026-03-05', slot: '20:00\u201321:00', venue: 'arkbar', action: 'sign' },
    ];
    const djRateMap = { 'raffo dj': { name: 'Raffo DJ', rate: 200 } };
    const { report, grandTotal, grandCost } = computeFinalizationReport({ signoffRows, djRateMap });

    expect(report).toHaveLength(1);
    expect(report[0].total).toBe(1);
    expect(grandTotal).toBe(1);
    expect(grandCost).toBe(200);
  });

  test('excludes Guest DJ from report', () => {
    const signoffRows = [
      { name: 'Guest DJ', date: '2026-03-01', slot: '20:00\u201321:00', venue: 'arkbar', action: 'sign' },
    ];
    const djRateMap = {};
    const { report } = computeFinalizationReport({ signoffRows, djRateMap });
    expect(report).toHaveLength(0);
  });

  test('calculates cost = total * rate correctly', () => {
    const signoffRows = [];
    for (let i = 1; i <= 10; i++) {
      signoffRows.push({ name: 'Sound Bogie', date: `2026-03-${pad2(i)}`, slot: '20:00\u201321:00', venue: 'arkbar', action: 'sign' });
    }
    const djRateMap = { 'sound bogie': { name: 'Sound Bogie', rate: 500 } };
    const { report, grandTotal, grandCost } = computeFinalizationReport({ signoffRows, djRateMap });

    expect(report[0].total).toBe(10);
    expect(report[0].cost).toBe(5000);
    expect(grandTotal).toBe(10);
    expect(grandCost).toBe(5000);
  });

  test('normalizes venue: Love Beach -> love', () => {
    const signoffRows = [
      { name: 'Alex RedWhite', date: '2026-03-01', slot: '20:00\u201321:00', venue: 'Love Beach', action: 'sign' },
    ];
    const djRateMap = { 'alex redwhite': { name: 'Alex RedWhite', rate: 100 } };
    const { report } = computeFinalizationReport({ signoffRows, djRateMap });
    expect(report[0].love).toBe(1);
    expect(report[0].arkbar).toBe(0);
  });

  test('normalizes venue: ARKbar -> arkbar', () => {
    const signoffRows = [
      { name: 'Alex RedWhite', date: '2026-03-01', slot: '20:00\u201321:00', venue: 'ARKbar', action: 'sign' },
    ];
    const djRateMap = { 'alex redwhite': { name: 'Alex RedWhite', rate: 100 } };
    const { report } = computeFinalizationReport({ signoffRows, djRateMap });
    expect(report[0].arkbar).toBe(1);
    expect(report[0].love).toBe(0);
  });

  test('normalizes venue: HIP -> hip', () => {
    const signoffRows = [
      { name: 'Alex RedWhite', date: '2026-03-01', slot: '21:00\u201322:00', venue: 'HIP', action: 'sign' },
    ];
    const djRateMap = { 'alex redwhite': { name: 'Alex RedWhite', rate: 100 } };
    const { report } = computeFinalizationReport({ signoffRows, djRateMap });
    expect(report[0].hip).toBe(1);
  });

  test('grandTotal and grandCost aggregate across multiple DJs', () => {
    const signoffRows = [
      { name: 'Alex RedWhite', date: '2026-03-01', slot: '20:00\u201321:00', venue: 'arkbar', action: 'sign' },
      { name: 'Raffo DJ',      date: '2026-03-01', slot: '21:00\u201322:00', venue: 'arkbar', action: 'sign' },
      { name: 'Raffo DJ',      date: '2026-03-02', slot: '22:00\u201323:00', venue: 'love',   action: 'sign' },
    ];
    const djRateMap = {
      'alex redwhite': { name: 'Alex RedWhite', rate: 100 },
      'raffo dj':      { name: 'Raffo DJ',      rate: 200 },
    };
    const { report, grandTotal, grandCost } = computeFinalizationReport({ signoffRows, djRateMap });
    expect(report).toHaveLength(2);
    expect(grandTotal).toBe(3);
    expect(grandCost).toBe(1 * 100 + 2 * 200); // 100 + 400 = 500
  });

  test('report is sorted alphabetically by DJ name', () => {
    const signoffRows = [
      { name: 'Raffo DJ',      date: '2026-03-01', slot: '20:00\u201321:00', venue: 'arkbar', action: 'sign' },
      { name: 'Alex RedWhite', date: '2026-03-01', slot: '21:00\u201322:00', venue: 'arkbar', action: 'sign' },
    ];
    const djRateMap = {
      'alex redwhite': { name: 'Alex RedWhite', rate: 100 },
      'raffo dj':      { name: 'Raffo DJ',      rate: 200 },
    };
    const { report } = computeFinalizationReport({ signoffRows, djRateMap });
    expect(report[0].name).toBe('Alex RedWhite');
    expect(report[1].name).toBe('Raffo DJ');
  });

  test('uses rate 0 when DJ not found in djRateMap', () => {
    const signoffRows = [
      { name: 'Unknown DJ', date: '2026-03-01', slot: '20:00\u201321:00', venue: 'arkbar', action: 'sign' },
    ];
    const djRateMap = {};
    const { report } = computeFinalizationReport({ signoffRows, djRateMap });
    expect(report[0].rate).toBe(0);
    expect(report[0].cost).toBe(0);
  });

  test('handles empty signoffRows gracefully', () => {
    const { report, grandTotal, grandCost } = computeFinalizationReport({ signoffRows: [], djRateMap: {} });
    expect(report).toHaveLength(0);
    expect(grandTotal).toBe(0);
    expect(grandCost).toBe(0);
  });
});

/* == AUTO-SUGGEST TEMPLATE BLOCKS ========================================== */

describe('Auto-suggest template blocks (getDJTemplateBlocks)', () => {
  test('returns contiguous blocks for Davoted on arkbar Thursday (dow=4)', () => {
    // DIAG_FIXED_TEMPLATE.arkbar[4]: Davoted is at 20:00-21:00, 21:00-22:00, 22:00-23:00 (one block)
    const blocks = getDJTemplateBlocks('arkbar', 4, 'Davoted', 0, DIAG_FIXED_TEMPLATE);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual([
      '20:00\u201321:00',
      '21:00\u201322:00',
      '22:00\u201323:00',
    ]);
  });

  test('returns empty array for DJ not in the template', () => {
    const blocks = getDJTemplateBlocks('arkbar', 4, 'NonExistentDJ', 0, DIAG_FIXED_TEMPLATE);
    expect(blocks).toHaveLength(0);
  });

  test('returns HIP_SLOTS block for the assigned DJ at hip venue', () => {
    // DIAG_FIXED_TEMPLATE.hip[4] = 'Tobi' (Thursday)
    const blocks = getDJTemplateBlocks('hip', 4, 'Tobi', 0, DIAG_FIXED_TEMPLATE);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual([
      '21:00\u201322:00',
      '22:00\u201323:00',
      '23:00\u201300:00',
      '00:00\u201301:00',
    ]);
  });

  test('returns empty array for wrong DJ at hip venue', () => {
    const blocks = getDJTemplateBlocks('hip', 4, 'Raffo DJ', 0, DIAG_FIXED_TEMPLATE);
    expect(blocks).toHaveLength(0);
  });

  test('handles hip Saturday array toggle: index 0 = Pick', () => {
    // DIAG_FIXED_TEMPLATE.hip[6] = ['Pick','Tony']
    const blocks0 = getDJTemplateBlocks('hip', 6, 'Pick', 0, DIAG_FIXED_TEMPLATE);
    expect(blocks0).toHaveLength(1);
  });

  test('handles hip Saturday array toggle: index 1 = Tony', () => {
    // DIAG_FIXED_TEMPLATE.hip[6] = ['Pick','Tony']
    const blocks1 = getDJTemplateBlocks('hip', 6, 'Tony', 1, DIAG_FIXED_TEMPLATE);
    expect(blocks1).toHaveLength(1);
  });

  test('returns love weekday blocks correctly', () => {
    // DIAG_FIXED_TEMPLATE.love.weekday[3] (Thursday): Pick has 14:00-17:00, Davoted has 20:00-23:00+00:00
    const picksBlocks = getDJTemplateBlocks('love', 3, 'Pick', 0, DIAG_FIXED_TEMPLATE);
    expect(picksBlocks).toHaveLength(1);
    expect(picksBlocks[0]).toEqual([
      '14:00\u201315:00',
      '15:00\u201316:00',
      '16:00\u201317:00',
    ]);
  });

  test('returns multiple blocks for DJ with non-contiguous slots', () => {
    // DIAG_FIXED_TEMPLATE.arkbar[0] (Sunday): Alex RedWhite has 14:00-15:00, 15:00-16:00, 16:00-17:00
    // (one afternoon block) and 23:00-00:00, 00:00-01:00, 01:00-02:00 (one late-night block)
    const blocks = getDJTemplateBlocks('arkbar', 0, 'Alex RedWhite', 0, DIAG_FIXED_TEMPLATE);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual(['14:00\u201315:00', '15:00\u201316:00', '16:00\u201317:00']);
    expect(blocks[1]).toEqual(['23:00\u201300:00', '00:00\u201301:00', '01:00\u201302:00']);
  });

  test('uses DIAG_FIXED_TEMPLATE as default when template param is omitted', () => {
    // Should behave the same as passing DIAG_FIXED_TEMPLATE explicitly
    const withDefault = getDJTemplateBlocks('hip', 4, 'Tobi', 0);
    const withExplicit = getDJTemplateBlocks('hip', 4, 'Tobi', 0, DIAG_FIXED_TEMPLATE);
    expect(withDefault).toEqual(withExplicit);
  });
});

/* == DB-SHAPED fixedSchedules ============================================== */
// Verifies that buildAvailabilityMap works identically when fixedSchedules
// has string keys (as returned from Supabase JSONB) vs integer keys (JS constants).

describe('fixedSchedules from DB', () => {
  // March 2026: 31 days, starts on Sunday (dow=0)
  const MARCH_2026 = 'March 2026';

  // DB-shaped: same schedule as FIXED_SCHEDULES['Davoted'] but with STRING keys
  // Supabase stores JSON — all object keys come back as strings.
  const DB_FIXED_SCHEDULES = {
    'Davoted': {
      arkbar: {
        '1': ['14:00\u201315:00', '15:00\u201316:00'],
        '3': ['14:00\u201315:00', '15:00\u201316:00', '16:00\u201317:00'],
        '4': ['14:00\u201315:00', '15:00\u201316:00', '20:00\u201321:00', '21:00\u201322:00', '22:00\u201323:00'],
        '5': ['14:00\u201315:00', '15:00\u201316:00', '16:00\u201317:00'],
      },
      loveBeach: {
        '2': ['20:00\u201321:00', '21:00\u201322:00', '22:00\u201323:00', '23:00\u201300:00'],
        '3': ['20:00\u201321:00', '21:00\u201322:00', '22:00\u201323:00', '23:00\u201300:00'],
      },
    },
  };

  // Constant-shaped: same as what FIXED_SCHEDULES exports (integer keys)
  const CONST_FIXED_SCHEDULES = FIXED_SCHEDULES;

  test('DB string-key fixedSchedules produces identical output to integer-key constant', () => {
    const mapFromConst = buildAvailabilityMap({
      portalRows: [],
      submittedNames: new Set(),
      month: MARCH_2026,
      fixedSchedules: CONST_FIXED_SCHEDULES,
    });
    const mapFromDB = buildAvailabilityMap({
      portalRows: [],
      submittedNames: new Set(),
      month: MARCH_2026,
      fixedSchedules: DB_FIXED_SCHEDULES,
    });
    expect(mapFromDB).toEqual(mapFromConst);
  });

  test('empty fixedSchedules object returns map without fixed DJ entries', () => {
    const map = buildAvailabilityMap({
      portalRows: [],
      submittedNames: new Set(),
      month: MARCH_2026,
      fixedSchedules: {},
    });
    // No 'Davoted' should appear in any slot — only 'Guest DJ'
    for (const dateSlots of Object.values(map)) {
      for (const djList of Object.values(dateSlots)) {
        expect(djList).not.toContain('Davoted');
      }
    }
    // Guest DJ still present on every slot
    expect(map['2026-03-01']['14:00\u201315:00']).toContain('Guest DJ');
  });
});
