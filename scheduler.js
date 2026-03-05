// ============================================================
// DIGEST SCHEDULER
//
// Runs every minute via node-cron. Checks which users are due
// for a digest, gathers their data, builds the email, and sends.
//
// The "due" check uses the user's timezone and preferred send time
// so each user gets their email at the time they chose, regardless
// of what timezone the server is in.
//
// KEY CONCEPT: Orchestration
// This file is the "conductor" of the digest process. It doesn't
// know HOW to query the database, build emails, or send them —
// it just coordinates the other modules in the right order:
//   1. queries.js  -> finds who needs a digest & gathers data
//   2. email.js    -> builds the HTML email from that data
//   3. sendgrid.js -> sends the email
//
// This separation of concerns makes each piece easier to
// understand, test, and modify independently.
//
// KEY CONCEPT: Promise.all for Parallel Queries
// When gathering data for a user, we need captures, unchecked
// items, stats, and (maybe) forgotten items. These queries are
// independent — none depends on the result of another. So we
// run them all at the same time with Promise.all instead of
// waiting for each one to finish before starting the next.
// This is much faster! (4 queries in parallel vs 4 in sequence)
// ============================================================

const {
  getUsersDueForDigest,
  getTodaysCaptures,
  getUncheckedByCategory,
  getQuickStats,
  getForgottenItems,
  markDigestSent,
} = require("./queries");
const { buildDigestEmail } = require("./email");
const { sendEmail } = require("./sendgrid");

async function processDigests() {
  try {
    // Step 1: Check which users are due for a digest right now
    const dueUsers = await getUsersDueForDigest();

    // If nobody is due, exit quietly (this will happen most minutes)
    if (dueUsers.length === 0) return;

    // Safety cap: if the query returns a huge number of users due to
    // a bug or data issue, don't try to send thousands of emails in
    // one run. Process at most 50 per tick; the rest will be picked
    // up on the next minute's tick.
    const MAX_PER_RUN = 50;
    if (dueUsers.length > MAX_PER_RUN) {
      console.warn(`[Scheduler] ${dueUsers.length} users due, capping at ${MAX_PER_RUN}`);
      dueUsers.splice(MAX_PER_RUN);
    }

    console.log(`[Scheduler] ${dueUsers.length} user(s) due for digest`);

    // Step 2: Process each due user one at a time
    // We use a for...of loop (not Promise.all) so we don't
    // overwhelm the database or SendGrid with too many simultaneous
    // requests if there are many users.
    for (const user of dueUsers) {
      try {
        // Step 2a: Gather all data for this user's digest in parallel
        // Promise.all runs all 4 queries at the same time and waits
        // for all of them to finish. The results come back in the
        // same order as the promises we passed in.
        const [captures, unchecked, stats, forgotten] = await Promise.all([
          getTodaysCaptures(user.user_id, user.timezone),
          getUncheckedByCategory(user.user_id),
          getQuickStats(user.user_id, user.timezone),
          // Only fetch forgotten items for weekly digests — daily
          // digests don't include this section
          user.digest_frequency === "weekly"
            ? getForgottenItems(user.user_id)
            : Promise.resolve([]),
        ]);

        // Step 2b: Build the email HTML from the gathered data
        const { subject, html } = buildDigestEmail({
          frequency: user.digest_frequency,
          captures,
          unchecked,
          stats,
          forgotten,
        });

        // Step 2c: Send the email via SendGrid
        const sent = await sendEmail({
          to: user.email,
          subject,
          html,
        });

        // Step 2d: If sent successfully, record the timestamp so
        // we don't send again today
        if (sent) {
          await markDigestSent(user.user_id);
        }
      } catch (err) {
        // KEY CONCEPT: Error Isolation
        // If one user's digest fails (bad data, query error, etc.),
        // we log the error but DON'T crash. The loop continues
        // processing other users. This is critical for reliability —
        // one bad record shouldn't block everyone else's email.
        console.error(`[Scheduler] Error for user ${user.user_id}:`, err);
      }
    }
  } catch (err) {
    // This catches errors in getUsersDueForDigest itself
    // (e.g., database connection lost)
    console.error("[Scheduler] Error checking due users:", err);
  }
}

module.exports = { processDigests };
