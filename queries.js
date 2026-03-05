// ============================================================
// DIGEST QUERIES
//
// All database queries needed to build a digest email.
// Each function takes a userId and returns the data for one
// section of the email.
//
// KEY CONCEPT: Parameterized Queries ($1, $2, etc.)
// We never put user data directly into SQL strings — that would
// allow "SQL injection" attacks. Instead, we use $1, $2 as
// placeholders and pass the actual values in an array. The
// database driver safely escapes them for us.
//
// KEY CONCEPT: Timezone Handling
// Users pick their timezone (e.g., "America/New_York"). PostgreSQL
// can convert timestamps between timezones using:
//   NOW() AT TIME ZONE 'America/New_York'
// This ensures a user in NYC gets their digest at 8am NYC time,
// not 8am server time (which might be UTC).
// ============================================================

const db = require("./db");

// ────────────────────────────────────────────────────────────
// Find users whose digest is due right now.
//
// A user is "due" when:
// 1. Their digest_frequency is not 'none'
// 2. Their preferred send time has passed today (in their timezone)
// 3. They haven't already received a digest today
//
// For weekly digests, also check that today is Monday.
//
// KEY CONCEPT: ISODOW (ISO Day of Week)
// PostgreSQL's EXTRACT(ISODOW FROM ...) returns 1=Monday through
// 7=Sunday. We check for 1 (Monday) for weekly digests so users
// get a summary at the start of their week.
// ────────────────────────────────────────────────────────────
async function getUsersDueForDigest() {
  const result = await db.query(`
    SELECT
      us.user_id,
      u.email,
      us.digest_frequency,
      us.digest_time,
      us.timezone,
      us.last_digest_sent
    FROM user_settings us
    JOIN users u ON u.id = us.user_id
    WHERE us.digest_frequency != 'none'
      -- Current time in user's timezone has passed their preferred send time
      AND (NOW() AT TIME ZONE us.timezone)::time >= us.digest_time::time
      -- Haven't sent today (in user's timezone)
      AND (
        us.last_digest_sent IS NULL
        OR (us.last_digest_sent AT TIME ZONE us.timezone)::date < (NOW() AT TIME ZONE us.timezone)::date
      )
      -- Minimum 20-hour cooldown prevents timezone-manipulation abuse
      AND (
        us.last_digest_sent IS NULL
        OR us.last_digest_sent < NOW() - INTERVAL '20 hours'
      )
      -- Weekly digests only send on Monday (1 = Monday in PostgreSQL)
      AND (
        us.digest_frequency = 'daily'
        OR EXTRACT(ISODOW FROM NOW() AT TIME ZONE us.timezone) = 1
      )
      AND u.email_verified = true
  `);
  return result.rows;
}

// ────────────────────────────────────────────────────────────
// Items created today (in the user's timezone)
//
// This powers the "Today's Captures" section of the digest.
// We compare dates in the user's timezone so "today" means
// their today, not the server's today.
// ────────────────────────────────────────────────────────────
async function getTodaysCaptures(userId, timezone) {
  const result = await db.query(`
    SELECT type, content, tags, created_at
    FROM stashes
    WHERE user_id = $1
      AND (created_at AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date
    ORDER BY created_at DESC
  `, [userId, timezone]);
  return result.rows;
}

// ────────────────────────────────────────────────────────────
// All incomplete items grouped by type, with counts and the
// 3 oldest per type.
//
// KEY CONCEPT: Window Functions (ROW_NUMBER() OVER ...)
// A window function performs a calculation across a set of rows
// that are related to the current row. ROW_NUMBER() assigns
// 1, 2, 3... to each row within its "partition" (group).
//
// PARTITION BY type means: restart numbering for each type.
// ORDER BY created_at ASC means: oldest items get the lowest
// numbers. Then we filter WHERE rn <= 3 to keep only the
// 3 oldest per type.
//
// This is much more efficient than running a separate query
// for each type!
// ────────────────────────────────────────────────────────────
async function getUncheckedByCategory(userId) {
  // First get counts per type
  const counts = await db.query(`
    SELECT type, COUNT(*) as count
    FROM stashes
    WHERE user_id = $1 AND completed = false
    GROUP BY type
    ORDER BY count DESC
  `, [userId]);

  // Then get the 3 oldest per type using a window function
  const items = await db.query(`
    SELECT type, content, tags, created_at
    FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY type ORDER BY created_at ASC) as rn
      FROM stashes
      WHERE user_id = $1 AND completed = false
    ) ranked
    WHERE rn <= 3
    ORDER BY type, created_at ASC
  `, [userId]);

  return { counts: counts.rows, items: items.rows };
}

// ────────────────────────────────────────────────────────────
// Quick stats: total stashes, completed this week
//
// KEY CONCEPT: FILTER clause
// COUNT(*) FILTER (WHERE ...) is a PostgreSQL feature that lets
// you count only rows matching a condition, within the same query.
// It's like a conditional count — much cleaner than writing a
// CASE WHEN ... THEN 1 END inside COUNT().
//
// date_trunc('week', ...) rounds a date down to the start of
// its week (Monday at midnight), so we can check if something
// was completed "this week."
// ────────────────────────────────────────────────────────────
async function getQuickStats(userId, timezone) {
  const result = await db.query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE completed = true
        AND (completed_at AT TIME ZONE $2)::date >= date_trunc('week', (NOW() AT TIME ZONE $2))::date
      ) as completed_this_week
    FROM stashes
    WHERE user_id = $1
  `, [userId, timezone]);
  return result.rows[0];
}

// ────────────────────────────────────────────────────────────
// 10 oldest untouched incomplete items (for weekly digest)
//
// "Forgotten" items are things that haven't been updated or
// completed in a long time. COALESCE(updated_at, created_at)
// picks updated_at if it exists, otherwise falls back to
// created_at. This way we sort by "last touched" date.
//
// KEY CONCEPT: COALESCE
// COALESCE returns the first non-NULL value from its arguments.
// If updated_at is NULL (item was never edited), it uses
// created_at instead. Very handy for fallback values!
// ────────────────────────────────────────────────────────────
async function getForgottenItems(userId) {
  const result = await db.query(`
    SELECT type, content, tags, created_at, updated_at
    FROM stashes
    WHERE user_id = $1 AND completed = false
    ORDER BY COALESCE(updated_at, created_at) ASC
    LIMIT 10
  `, [userId]);
  return result.rows;
}

// ────────────────────────────────────────────────────────────
// Mark that we sent a digest to this user.
//
// Updates last_digest_sent to NOW() so the getUsersDueForDigest
// query won't pick them up again until tomorrow.
// ────────────────────────────────────────────────────────────
async function markDigestSent(userId) {
  await db.query(
    "UPDATE user_settings SET last_digest_sent = NOW() WHERE user_id = $1",
    [userId]
  );
}

// Export all query functions so other files can use them
module.exports = {
  getUsersDueForDigest,
  getTodaysCaptures,
  getUncheckedByCategory,
  getQuickStats,
  getForgottenItems,
  markDigestSent,
};
