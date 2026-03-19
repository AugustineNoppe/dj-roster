'use strict';

/**
 * Factory function that creates the three lockout functions with a given
 * supabase client and constants injected. This design makes unit testing
 * straightforward: tests inject a mock supabase.
 *
 * Usage in server.js:
 *   const { createLockoutFunctions } = require('./lib/lockout');
 *   const { checkLockout, recordFailedAttempt, clearFailedAttempts } =
 *     createLockoutFunctions(supabase, { MAX_LOGIN_ATTEMPTS, LOCKOUT_DURATION_MS });
 *
 * @param {object} supabase - Supabase client instance
 * @param {object} constants - { MAX_LOGIN_ATTEMPTS, LOCKOUT_DURATION_MS }
 * @returns {{ checkLockout, recordFailedAttempt, clearFailedAttempts }}
 */
function createLockoutFunctions(supabase, { MAX_LOGIN_ATTEMPTS, LOCKOUT_DURATION_MS }) {
  /**
   * Check if a DJ account is currently locked.
   * Takes the already-fetched djRow to avoid an extra DB query during auth.
   *
   * @param {object|null|undefined} djRow - DJ row from djs table (may be null)
   * @returns {Promise<boolean>} true if locked, false if not
   */
  async function checkLockout(djRow) {
    if (!djRow) return false;
    const { locked_until } = djRow;
    if (!locked_until) return false;
    const lockTime = new Date(locked_until).getTime();
    if (lockTime > Date.now()) return true;
    // Lock has expired — clear it
    try {
      await supabase
        .from('djs')
        .update({ failed_attempts: 0, locked_until: null })
        .eq('id', djRow.id);
    } catch (err) {
      console.error('[checkLockout] failed to clear expired lock:', err.message || err);
    }
    return false;
  }

  /**
   * Record a failed login attempt for a DJ.
   * Fetches current failed_attempts from DB, increments, and updates.
   * If count reaches MAX_LOGIN_ATTEMPTS, sets locked_until.
   * Swallows errors to avoid crashing the auth flow.
   *
   * @param {string} djName - DJ name (used for ilike query)
   */
  async function recordFailedAttempt(djName) {
    try {
      const { data, error } = await supabase
        .from('djs')
        .select('id, failed_attempts')
        .ilike('name', djName.trim())
        .maybeSingle();
      if (error || !data) {
        console.error('[recordFailedAttempt] could not fetch DJ row:', error ? error.message : 'no data');
        return;
      }
      const newCount = (data.failed_attempts || 0) + 1;
      const payload = { failed_attempts: newCount };
      if (newCount >= MAX_LOGIN_ATTEMPTS) {
        payload.locked_until = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
      }
      await supabase.from('djs').update(payload).eq('id', data.id);
    } catch (err) {
      console.error('[recordFailedAttempt] error:', err.message || err);
    }
  }

  /**
   * Clear the failed attempt counter and lockout for a DJ.
   * Called on successful login or by admin endpoint.
   * Swallows errors to avoid crashing the auth flow.
   *
   * @param {string} djName - DJ name (used for ilike query)
   */
  async function clearFailedAttempts(djName) {
    try {
      await supabase
        .from('djs')
        .update({ failed_attempts: 0, locked_until: null })
        .ilike('name', djName.trim());
    } catch (err) {
      console.error('[clearFailedAttempts] error:', err.message || err);
    }
  }

  return { checkLockout, recordFailedAttempt, clearFailedAttempts };
}

module.exports = { createLockoutFunctions };
