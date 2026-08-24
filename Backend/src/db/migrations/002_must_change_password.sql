-- ============================================================
-- 002_must_change_password.sql
--
-- Marks an account whose password was set by someone other than
-- its owner — the bootstrapped default administrator, or a user
-- an admin created with a generated password.
--
-- The API reports this on the session user so the portal can nudge
-- the owner to set their own password. Without it, a documented
-- default credential would stay valid indefinitely and nobody
-- would be reminded it is still in place.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- Finding "is a default credential still active?" at boot should not
-- require a full scan of the users table.
CREATE INDEX IF NOT EXISTS users_must_change_password_idx
  ON users (must_change_password) WHERE must_change_password = TRUE;
