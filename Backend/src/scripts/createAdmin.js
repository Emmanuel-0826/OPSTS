/* ============================================================
   src/scripts/createAdmin.js — Create an administrator

   There is no admin registration in the UI on purpose: the only
   way to mint an admin account is shell access to the server.
   (A first admin is also seeded automatically on an empty
   database — see src/services/bootstrap.js.)

   Usage:
     npm run create-admin -- --email admin@school.edu --password "S3cure-Pass" \
       [--first Ama] [--last Mensah] [--staff ADM001] [--must-change]

   Or via environment variables:
     ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run create-admin
============================================================ */

"use strict";

const bcrypt = require("bcryptjs");
const config = require("../config/env");
const db = require("../config/db");
const { migrate } = require("../db/migrate");

function readArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

async function main() {
  const email = (readArg("email") || process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = readArg("password") || process.env.ADMIN_PASSWORD || "";
  const firstName = readArg("first") || "System";
  const lastName = readArg("last") || "Administrator";
  const staffId = readArg("staff") || "ADM001";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Provide a valid email with --email or ADMIN_EMAIL.");
  }
  if (password.length < 8) {
    throw new Error("Provide a password of at least 8 characters with --password or ADMIN_PASSWORD.");
  }

  /* --must-change flags the account so the portal prompts for a new
     password on sign-in. Use it whenever the password here is a shared
     or documented one rather than a secret only the owner knows. */
  const mustChange = process.argv.includes("--must-change");

  await migrate({ log: () => {} });

  const passwordHash = await bcrypt.hash(password, config.auth.bcryptRounds);

  const { rows } = await db.query(
    `INSERT INTO users (first_name, last_name, email, password_hash, role, status,
                        staff_id, department, must_change_password)
     VALUES ($1, $2, $3, $4, 'admin', 'active', $5, 'Administration', $6)
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [firstName, lastName, email, passwordHash, staffId, mustChange]
  );

  if (rows.length === 0) {
    console.log(`[create-admin] an account with ${email} already exists — nothing changed.`);
  } else {
    console.log(`[create-admin] administrator ${email} created (id ${rows[0].id}).`);
  }
}

main()
  .then(() => db.close())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[create-admin]", err.message);
    process.exit(1);
  });
