// ============================================================
// DATABASE CONNECTION
//
// Same pattern as stash-server/db/index.js — connects to the
// shared Railway PostgreSQL. The digest worker only READS
// stashes and settings, and WRITES the last_digest_sent timestamp.
//
// KEY CONCEPT: Connection Pooling
// A "pool" keeps a few database connections open and reuses them.
// Instead of connecting/disconnecting for every query (slow),
// we borrow a connection from the pool, run our query, and
// return it. Think of it like a library lending books — you
// don't buy a new book every time you want to read.
// ============================================================

require("dotenv").config();
const { Pool } = require("pg");

// Grab the database URL from environment variables
const dbUrl = process.env.DATABASE_URL || "";

// Detect if we're connecting to a remote database (Railway, etc.)
// Remote databases need SSL encryption; local ones don't.
const isRemote = dbUrl && !dbUrl.includes("localhost") && !dbUrl.includes("127.0.0.1");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  // SSL (Secure Sockets Layer) encrypts data between our worker and
  // the database. Railway requires it. When DATABASE_CA_CERT is set,
  // we verify the server's certificate (secure). Otherwise we fall
  // back to rejectUnauthorized:false for Railway's self-signed cert.
  ssl: isRemote
    ? {
        rejectUnauthorized: !!process.env.DATABASE_CA_CERT,
        ...(process.env.DATABASE_CA_CERT && { ca: process.env.DATABASE_CA_CERT }),
      }
    : false,

  // Small pool — this worker only runs queries every minute.
  // No need for 10+ connections like a web server might use.
  max: 3,

  // Close idle connections after 30 seconds to free resources
  idleTimeoutMillis: 30000,

  // How long to wait for a connection from the pool before erroring.
  // Prevents the worker from hanging forever if the DB is unreachable.
  connectionTimeoutMillis: 10000,

  // Max time a single SQL statement can run before PostgreSQL cancels it.
  // Prevents a stuck query from blocking the entire digest pipeline.
  statement_timeout: 30000,
});

// These event listeners help us debug connection issues.
// "on" means "when this event happens, run this function."
pool.on("connect", () => {
  console.log("[DB] Connected to PostgreSQL");
});

pool.on("error", (err) => {
  console.error("[DB] Unexpected error:", err.message);
});

// Export the pool so other files can use it with:
//   const db = require("./db");
//   db.query("SELECT ...");
module.exports = pool;
