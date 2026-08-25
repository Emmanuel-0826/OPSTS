/* ============================================================
   src/config/db.js — PostgreSQL connection pool

   Every query in the app goes through here. Two rules keep this
   layer safe and predictable:

     1. Values are ALWAYS passed as parameters ($1, $2, ...).
        Never interpolate user input into SQL text.
     2. Anything that writes more than one row uses withTransaction,
        so a half-applied change can't be left behind.
============================================================ */

"use strict";

const { Pool } = require("pg");
const config = require("./env");

/* Postgres returns BIGINT/NUMERIC as strings to avoid precision loss.
   Every count and money-free number in this schema fits comfortably in
   a JS number, and the frontend expects real numbers, so parse them. */
const { types } = require("pg");
types.setTypeParser(types.builtins.INT8, (v) => Number.parseInt(v, 10));
types.setTypeParser(types.builtins.NUMERIC, (v) => Number.parseFloat(v));

/* DATE columns (due dates, deadlines) are calendar dates, not instants.
   The default parser turns them into local-midnight Date objects, which
   shifts the day across timezones. Keep them as plain "YYYY-MM-DD". */
types.setTypeParser(types.builtins.DATE, (v) => v);

const pool = new Pool(
  config.db.connectionString
    ? {
        connectionString: config.db.connectionString,
        ssl: config.db.ssl,
        max: config.db.maxPoolSize,
      }
    : {
        host: config.db.host,
        port: config.db.port,
        database: config.db.database,
        user: config.db.user,
        password: config.db.password,
        ssl: config.db.ssl,
        max: config.db.maxPoolSize,
      }
);

/* An idle client that errors (network blip, server restart) would
   otherwise crash the process as an unhandled 'error' event. */
pool.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("[db] idle client error:", err.message);
});

/**
 * Run a single parameterised query.
 * @param {string} text  SQL with $1..$n placeholders
 * @param {Array}  [params]
 */
function query(text, params) {
  return pool.query(text, params);
}

/**
 * Run `fn` inside a transaction, handing it a dedicated client.
 * Commits on success, rolls back on any throw, and always releases
 * the client back to the pool.
 *
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      // eslint-disable-next-line no-console
      console.error("[db] rollback failed:", rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Verify the database is reachable. Called once at boot. */
async function assertConnection() {
  const { rows } = await pool.query("SELECT current_database() AS db, version() AS version");
  return rows[0];
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, withTransaction, assertConnection, close };
