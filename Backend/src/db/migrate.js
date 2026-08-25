/* ============================================================
   src/db/migrate.js — Forward-only SQL migration runner

   Applies every .sql file in ./migrations that has not been
   applied yet, in filename order, each inside its own
   transaction. Applied filenames are recorded in
   schema_migrations, so running this repeatedly is a no-op.

   Called automatically at boot (server.js) and available as
   `npm run migrate`.
============================================================ */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pool } = require("../config/db");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      checksum    TEXT        NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

function readMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((filename) => {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), "utf8");
      return {
        filename,
        sql,
        checksum: crypto.createHash("sha256").update(sql).digest("hex"),
      };
    });
}

/**
 * Apply all pending migrations.
 * @returns {Promise<string[]>} filenames that were applied this run
 */
async function migrate({ log = console.log } = {}) {
  const client = await pool.connect();
  const applied = [];

  try {
    await ensureMigrationsTable(client);

    const { rows } = await client.query("SELECT filename, checksum FROM schema_migrations");
    const alreadyApplied = new Map(rows.map((r) => [r.filename, r.checksum]));

    for (const migration of readMigrations()) {
      const previousChecksum = alreadyApplied.get(migration.filename);

      if (previousChecksum) {
        /* An edited migration means the database and the repo have
           silently diverged. Warn rather than re-run: re-running is
           not safe in general, and silence would hide the drift. */
        if (previousChecksum !== migration.checksum) {
          log(
            `[migrate] WARNING: ${migration.filename} changed since it was applied. ` +
              "Add a new migration instead of editing an applied one."
          );
        }
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
          [migration.filename, migration.checksum]
        );
        await client.query("COMMIT");
        applied.push(migration.filename);
        log(`[migrate] applied ${migration.filename}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${migration.filename} failed: ${err.message}`);
      }
    }

    if (applied.length === 0) log("[migrate] database already up to date");
    return applied;
  } finally {
    client.release();
  }
}

module.exports = { migrate };

/* Allow `node src/db/migrate.js` as a standalone command. */
if (require.main === module) {
  migrate()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[migrate]", err.message);
      process.exit(1);
    });
}
