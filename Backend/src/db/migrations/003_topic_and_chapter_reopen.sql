-- ============================================================
-- 003_topic_and_chapter_reopen.sql
--
-- Two changes, both about who decides something:
--
--   * users.proposed_topic — a student names their own project
--     topic when they register. The project shell created at
--     approval carries it straight through, so an administrator
--     no longer has to type a topic on behalf of someone who
--     already told us what it was.
--
--   * submissions.reopened_at / reopened_by — an approved chapter
--     is closed to further submissions. Reopening it is a
--     deliberate supervisor action recorded on the approved
--     version itself, which is the row the constraint reads.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS proposed_topic TEXT;

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reopened_by UUID REFERENCES users (id) ON DELETE SET NULL;
