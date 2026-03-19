'use strict';

/**
 * Factory function that creates all admin DJ handler functions with injected
 * dependencies. This enables unit testing without coupling to server.js globals.
 *
 * Usage in server.js:
 *   const { createAdminDJHandlers } = require('./lib/admin-dj');
 *   const { listDJs, addDJ, editDJ, resetPin, clearLockout } =
 *     createAdminDJHandlers(supabase, bcrypt, invalidateCaches);
 *
 * @param {object} supabase - Supabase client instance
 * @param {object} bcrypt   - bcrypt module (injected for testability)
 * @param {Function} invalidateCaches - Cache invalidation callback (called with 'djs')
 * @returns {{ listDJs, addDJ, editDJ, resetPin, clearLockout, updateRecurringAvailability, updateFixedSchedules }}
 */
function createAdminDJHandlers(supabase, bcrypt, invalidateCaches) {
  const ALLOWED_TYPES = ['resident', 'guest', 'casual'];
  const ALLOWED_EDIT_KEYS = ['name', 'rate', 'type', 'active'];
  const DJ_SELECT_FIELDS = 'id, name, rate, type, active, venues, failed_attempts, locked_until';

  /**
   * List all DJs (active and inactive) for admin view.
   * Never returns pin_hash.
   *
   * @returns {Promise<{ success: boolean, djs?: object[], error?: string }>}
   */
  async function listDJs() {
    try {
      const { data, error } = await supabase
        .from('djs')
        .select(DJ_SELECT_FIELDS)
        .order('name', { ascending: true });

      if (error) {
        console.error('[listDJs] supabase error:', error.message || error);
        return { success: false, error: 'Failed to retrieve DJs' };
      }

      return { success: true, djs: data || [] };
    } catch (err) {
      console.error('[listDJs] unexpected error:', err.message || err);
      return { success: false, error: 'Failed to retrieve DJs' };
    }
  }

  /**
   * Add a new DJ with a hashed PIN.
   * Validates required fields and type before inserting.
   *
   * @param {{ name: string, rate: number, type: string, pin: string }} params
   * @returns {Promise<{ success: boolean, dj?: object, error?: string, status?: number }>}
   */
  async function addDJ({ name, rate, type, pin } = {}) {
    if (!name || !String(name).trim()) {
      return { success: false, error: 'name is required', status: 400 };
    }
    if (pin === undefined || pin === null || String(pin).trim() === '') {
      return { success: false, error: 'pin is required', status: 400 };
    }
    if (!type || !ALLOWED_TYPES.includes(type)) {
      return { success: false, error: `type must be one of: ${ALLOWED_TYPES.join(', ')}`, status: 400 };
    }

    try {
      const pin_hash = await bcrypt.hash(String(pin).trim(), 10);

      const { data, error } = await supabase
        .from('djs')
        .insert({ name: String(name).trim(), rate, type, active: true, pin_hash })
        .select('id, name, rate, type, active')
        .single();

      if (error) {
        console.error('[addDJ] supabase insert error:', error.message || error);
        return { success: false, error: 'Failed to create DJ' };
      }

      invalidateCaches('djs');

      // Ensure pin_hash is never returned
      const { pin_hash: _removed, ...dj } = data || {};
      return { success: true, dj };
    } catch (err) {
      console.error('[addDJ] unexpected error:', err.message || err);
      return { success: false, error: 'Failed to create DJ' };
    }
  }

  /**
   * Edit allowed fields on an existing DJ.
   * Filters to only allowed keys: name, rate, type, active.
   * Supports deactivating (active=false) and reactivating (active=true).
   *
   * @param {{ id: string, name?: string, rate?: number|string, type?: string, active?: boolean }} params
   * @returns {Promise<{ success: boolean, error?: string, status?: number }>}
   */
  async function editDJ({ id, ...fields } = {}) {
    const updates = {};

    for (const key of ALLOWED_EDIT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        updates[key] = fields[key];
      }
    }

    // Trim name if present
    if (updates.name !== undefined) {
      updates.name = String(updates.name).trim();
    }

    // Parse rate as integer if present
    if (updates.rate !== undefined) {
      const parsed = parseInt(updates.rate, 10);
      if (isNaN(parsed)) {
        return { success: false, error: 'rate must be a valid integer', status: 400 };
      }
      updates.rate = parsed;
    }

    if (Object.keys(updates).length === 0) {
      return { success: false, error: 'No valid fields provided for update', status: 400 };
    }

    try {
      const { error } = await supabase
        .from('djs')
        .update(updates)
        .eq('id', id);

      if (error) {
        console.error('[editDJ] supabase update error:', error.message || error);
        return { success: false, error: 'Failed to update DJ' };
      }

      invalidateCaches('djs');
      return { success: true };
    } catch (err) {
      console.error('[editDJ] unexpected error:', err.message || err);
      return { success: false, error: 'Failed to update DJ' };
    }
  }

  /**
   * Reset a DJ's PIN by hashing the new value and updating pin_hash.
   *
   * @param {{ id: string, pin: string }} params
   * @returns {Promise<{ success: boolean, error?: string, status?: number }>}
   */
  async function resetPin({ id, pin } = {}) {
    if (pin === undefined || pin === null || String(pin).trim() === '') {
      return { success: false, error: 'pin is required', status: 400 };
    }

    try {
      const pin_hash = await bcrypt.hash(String(pin).trim(), 10);

      const { error } = await supabase
        .from('djs')
        .update({ pin_hash })
        .eq('id', id);

      if (error) {
        console.error('[resetPin] supabase update error:', error.message || error);
        return { success: false, error: 'Failed to reset PIN' };
      }

      invalidateCaches('djs');
      return { success: true };
    } catch (err) {
      console.error('[resetPin] unexpected error:', err.message || err);
      return { success: false, error: 'Failed to reset PIN' };
    }
  }

  /**
   * Clear lockout state for a DJ: reset failed_attempts and locked_until.
   *
   * @param {{ id: string }} params
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async function clearLockout({ id } = {}) {
    try {
      const { error } = await supabase
        .from('djs')
        .update({ failed_attempts: 0, locked_until: null })
        .eq('id', id);

      if (error) {
        console.error('[clearLockout] supabase update error:', error.message || error);
        return { success: false, error: 'Failed to clear lockout' };
      }

      invalidateCaches('djs');
      return { success: true };
    } catch (err) {
      console.error('[clearLockout] unexpected error:', err.message || err);
      return { success: false, error: 'Failed to clear lockout' };
    }
  }

  /**
   * Update a DJ's recurring_availability JSONB column.
   * Keyed by day-of-week string "0"–"6", values are arrays of slot strings.
   *
   * @param {{ id: string, recurring_availability: object }} params
   * @returns {Promise<{ success: boolean, error?: string, status?: number }>}
   */
  async function updateRecurringAvailability({ id, recurring_availability } = {}) {
    if (!id) {
      return { success: false, error: 'id is required', status: 400 };
    }
    if (recurring_availability === undefined || recurring_availability === null) {
      return { success: false, error: 'recurring_availability is required', status: 400 };
    }

    try {
      const { error } = await supabase
        .from('djs')
        .update({ recurring_availability })
        .eq('id', id);

      if (error) {
        console.error('[updateRecurringAvailability] supabase update error:', error.message || error);
        return { success: false, error: 'Failed to update recurring availability' };
      }

      invalidateCaches('djs');
      return { success: true };
    } catch (err) {
      console.error('[updateRecurringAvailability] unexpected error:', err.message || err);
      return { success: false, error: 'Failed to update recurring availability' };
    }
  }

  /**
   * Update a DJ's fixed_schedules JSONB column.
   * Keyed by venue ("arkbar" or "loveBeach"), then day-of-week string, then slot arrays.
   * Rejects any venue key not in the allowed list.
   *
   * @param {{ id: string, fixed_schedules: object }} params
   * @returns {Promise<{ success: boolean, error?: string, status?: number }>}
   */
  async function updateFixedSchedules({ id, fixed_schedules } = {}) {
    const ALLOWED_VENUE_KEYS = ['arkbar', 'loveBeach'];

    if (!id) {
      return { success: false, error: 'id is required', status: 400 };
    }
    if (fixed_schedules === undefined || fixed_schedules === null) {
      return { success: false, error: 'fixed_schedules is required', status: 400 };
    }

    for (const key of Object.keys(fixed_schedules)) {
      if (!ALLOWED_VENUE_KEYS.includes(key)) {
        return {
          success: false,
          error: `Invalid venue key: ${key}. Allowed: arkbar, loveBeach`,
          status: 400,
        };
      }
    }

    try {
      const { error } = await supabase
        .from('djs')
        .update({ fixed_schedules })
        .eq('id', id);

      if (error) {
        console.error('[updateFixedSchedules] supabase update error:', error.message || error);
        return { success: false, error: 'Failed to update fixed schedules' };
      }

      invalidateCaches('djs');
      return { success: true };
    } catch (err) {
      console.error('[updateFixedSchedules] unexpected error:', err.message || err);
      return { success: false, error: 'Failed to update fixed schedules' };
    }
  }

  return { listDJs, addDJ, editDJ, resetPin, clearLockout, updateRecurringAvailability, updateFixedSchedules };
}

module.exports = { createAdminDJHandlers };
