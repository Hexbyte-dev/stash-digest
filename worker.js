// ============================================================
// STASH DIGEST WORKER
//
// Entry point for the email digest service. Starts a cron job
// that checks every minute if any users are due for their
// daily or weekly digest email.
//
// This is a standalone service that runs on Railway alongside
// stash-server. They share the same PostgreSQL database.
//
// To run locally:  node worker.js (or npm run dev)
// To test:         Set SEND_NOW=true to send immediately
//
// KEY CONCEPT: Entry Point
// Every Node.js application needs a "starting point" — the file
// that runs first. For stash-server, it's server.js. For this
// digest worker, it's worker.js. The package.json "main" field
// and "start" script both point here.
//
// KEY CONCEPT: Worker Service vs Web Server
// A web server (like stash-server) listens for HTTP requests.
// A worker service doesn't — it runs on a schedule or processes
// a queue. This worker wakes up every minute, checks if anyone
// needs a digest email, sends it, then goes back to sleep.
// Railway can run both types of services.
//
// KEY CONCEPT: Cron Jobs
// "Cron" is a Unix scheduling system. A cron expression like
// "* * * * *" means "every minute." The five positions represent:
//   minute | hour | day-of-month | month | day-of-week
// So "0 8 * * 1" would mean "8:00 AM every Monday."
// We use "every minute" and let our own logic (in queries.js)
// handle the per-user timing based on their timezone + preferences.
// ============================================================

require("dotenv").config();
const cron = require("node-cron");

// ────────────────────────────────────────────────────────────
// ENVIRONMENT VALIDATION
//
// Check that all required environment variables are set BEFORE
// loading other modules. This is important because some modules
// (like sendgrid.js) use env vars at load time. By validating
// first, we guarantee a clear error message instead of a cryptic
// "undefined" failure deep in a library.
//
// KEY CONCEPT: Fail Fast
// "Fail fast" means detect problems as early as possible and
// stop immediately with a clear error. It's better to crash on
// startup with "SENDGRID_API_KEY is required" than to run for
// hours and then fail silently when trying to send the first email.
// ────────────────────────────────────────────────────────────
const required = ["DATABASE_URL", "SENDGRID_API_KEY", "SENDGRID_FROM_EMAIL"];
for (const name of required) {
  if (!process.env[name]) {
    console.error(`FATAL: ${name} environment variable is required`);
    process.exit(1);
  }
}

// Validate FRONTEND_URL starts with https:// if provided (defense-in-depth)
const frontendUrl = process.env.FRONTEND_URL;
if (frontendUrl && !frontendUrl.startsWith("https://")) {
  console.error("FATAL: FRONTEND_URL must start with https://");
  process.exit(1);
}

// Now that env vars are validated, load modules that depend on them
const { processDigests } = require("./scheduler");
const db = require("./db");

// ────────────────────────────────────────────────────────────
// STARTUP BANNER
//
// A nice visual indicator in the logs that the worker started.
// Makes it easy to find the start point when scrolling through
// Railway logs.
// ────────────────────────────────────────────────────────────
console.log("╔══════════════════════════════════════╗");
console.log("║      Stash Digest Worker Running     ║");
console.log("╚══════════════════════════════════════╝");
console.log(`  Schedule: Every minute`);
console.log(`  SendGrid from: ${process.env.SENDGRID_FROM_EMAIL}`);

// ────────────────────────────────────────────────────────────
// CRON SCHEDULE
//
// "* * * * *" = run every minute. The processDigests function
// checks each user's timezone and preferred send time, so even
// though we check every minute, each user only gets one email
// per day (or per week for weekly digests).
//
// Think of it like a clock that ticks every minute and asks:
// "Is anyone due for their digest right now?"
//
// KEY CONCEPT: Concurrency Guard
// What if processDigests takes longer than 1 minute (slow DB,
// many users, SendGrid timeout)? The next cron tick would start
// a second run while the first is still going — potentially
// sending duplicate emails. The `isRunning` flag prevents this:
// if a run is still in progress, we skip that tick.
// ────────────────────────────────────────────────────────────
let isRunning = false;

// Store the cron task reference so we can stop it during shutdown
const cronTask = cron.schedule("* * * * *", async () => {
  if (isRunning) {
    console.log("[Scheduler] Previous run still in progress, skipping");
    return;
  }
  isRunning = true;
  try {
    await processDigests();
  } catch (err) {
    console.error("[Worker] Unexpected error in processDigests:", err);
  } finally {
    isRunning = false;
  }
});

// ────────────────────────────────────────────────────────────
// TESTING MODE
//
// When developing or debugging, you don't want to wait for the
// cron job to fire. Set SEND_NOW=true in your .env file (or
// run with: SEND_NOW=true node worker.js) to trigger a digest
// check immediately on startup.
//
// We set isRunning=true so the cron job won't overlap with this
// immediate run (prevents duplicate digests).
// ────────────────────────────────────────────────────────────
if (process.env.SEND_NOW === "true") {
  console.log("[Worker] SEND_NOW=true — running digest immediately");
  isRunning = true;
  processDigests()
    .catch((err) => {
      console.error("[Worker] SEND_NOW failed:", err);
    })
    .finally(() => {
      isRunning = false;
    });
}

// ────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN
//
// KEY CONCEPT: Graceful Shutdown
// When Railway restarts or deploys a new version of this service,
// it sends a SIGTERM signal (like a polite "please stop"). If we
// just crash, database connections might be left hanging open.
//
// Instead, we listen for these signals and:
// 1. Stop the cron scheduler (no new ticks will fire)
// 2. Close the database connection pool cleanly
// 3. Then exit
//
// A 5-second timeout ensures the process always exits, even if
// db.end() hangs (e.g., a stuck query holding a connection).
//
// SIGTERM = sent by Railway/Docker when stopping a service
// SIGINT  = sent when you press Ctrl+C in your terminal
// ────────────────────────────────────────────────────────────
function gracefulShutdown(signal) {
  console.log(`\n[${signal}] Shutting down...`);

  // Stop cron so no new ticks fire during teardown
  cronTask.stop();

  // Force-exit after 5 seconds if db.end() hangs
  const forceExit = setTimeout(() => {
    console.error("[Shutdown] Forced exit after timeout");
    process.exit(1);
  }, 5000);

  db.end(() => {
    clearTimeout(forceExit);
    console.log("[DB] Pool closed");
    process.exit(0);
  });
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Catch unhandled promise rejections so they don't silently crash
process.on("unhandledRejection", (err) => {
  console.error("[Worker] Unhandled promise rejection:", err);
});
