-- ============================================================
-- 001_init.sql — OPSTS core schema
--
-- Conventions used throughout:
--   * UUID primary keys (gen_random_uuid is built in on PG 13+),
--     so ids are safe to expose in URLs and cannot be enumerated.
--   * snake_case columns; the API layer maps them to the camelCase
--     shape the frontend expects.
--   * Status values are TEXT + CHECK rather than PG enums so a new
--     status is a one-line migration instead of an ALTER TYPE dance.
--   * Every foreign key states its delete behaviour explicitly.
-- ============================================================

-- ── Shared trigger: keep updated_at honest ──────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ── users ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name             TEXT        NOT NULL CHECK (length(btrim(first_name)) > 0),
  last_name              TEXT        NOT NULL CHECK (length(btrim(last_name))  > 0),
  email                  TEXT        NOT NULL CHECK (email = lower(email)),
  password_hash          TEXT        NOT NULL,
  role                   TEXT        NOT NULL CHECK (role IN ('student', 'supervisor', 'admin')),
  status                 TEXT        NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('pending', 'active', 'suspended')),
  department             TEXT,
  index_number           TEXT,       -- students
  staff_id               TEXT,       -- supervisors and admins
  level                  TEXT,       -- students, e.g. "Level 400"
  specialization         TEXT,       -- supervisors
  -- Bumped on password change / forced logout. Tokens carrying an
  -- older value are rejected, which is how "log out everywhere" works
  -- without server-side session storage.
  token_version          INTEGER     NOT NULL DEFAULT 0,
  reset_token_hash       TEXT,
  reset_token_expires_at TIMESTAMPTZ,
  last_login_at          TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_key         ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS users_index_number_key  ON users (index_number) WHERE index_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_staff_id_key      ON users (staff_id)     WHERE staff_id     IS NOT NULL;
CREATE INDEX        IF NOT EXISTS users_role_status_idx   ON users (role, status);

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── projects ────────────────────────────────────────────────
-- One project per student: the student portal renders projects[0],
-- and the UNIQUE constraint is what makes that assumption safe.
CREATE TABLE IF NOT EXISTS projects (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id         UUID        NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  supervisor_id      UUID                 REFERENCES users (id) ON DELETE SET NULL,
  title              TEXT        NOT NULL DEFAULT 'Untitled Project',
  topic              TEXT,
  topic_status       TEXT        NOT NULL DEFAULT 'Pending'
                                 CHECK (topic_status IN ('Pending', 'Approved', 'Rejected')),
  status             TEXT        NOT NULL DEFAULT 'Pending'
                                 CHECK (status IN ('Pending', 'In Progress', 'Completed')),
  completion_percent INTEGER     NOT NULL DEFAULT 0
                                 CHECK (completion_percent BETWEEN 0 AND 100),
  start_date         DATE,
  deadline           DATE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS projects_supervisor_idx ON projects (supervisor_id);
CREATE INDEX IF NOT EXISTS projects_status_idx     ON projects (status);

DROP TRIGGER IF EXISTS projects_set_updated_at ON projects;
CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── milestones ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS milestones (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  chapter_id TEXT,       -- links a milestone to a chapter, when it maps to one
  label      TEXT        NOT NULL,
  due_date   DATE,
  status     TEXT        NOT NULL DEFAULT 'Pending'
                         CHECK (status IN ('Pending', 'In Progress', 'Completed')),
  position   INTEGER     NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS milestones_project_idx ON milestones (project_id, position);

DROP TRIGGER IF EXISTS milestones_set_updated_at ON milestones;
CREATE TRIGGER milestones_set_updated_at BEFORE UPDATE ON milestones
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── submissions ─────────────────────────────────────────────
-- Uploaded files live on disk under UPLOAD_DIR; only the generated
-- stored_name is recorded, never a client-supplied path.
CREATE TABLE IF NOT EXISTS submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  student_id      UUID        NOT NULL REFERENCES users (id)    ON DELETE CASCADE,
  supervisor_id   UUID                 REFERENCES users (id)    ON DELETE SET NULL,
  chapter_id      TEXT        NOT NULL,
  version         INTEGER     NOT NULL CHECK (version > 0),
  original_name   TEXT        NOT NULL,
  stored_name     TEXT        NOT NULL,
  file_size_bytes BIGINT      NOT NULL CHECK (file_size_bytes >= 0),
  mime_type       TEXT        NOT NULL,
  checksum_sha256 TEXT,
  notes           TEXT,
  status          TEXT        NOT NULL DEFAULT 'Under Review'
                              CHECK (status IN ('Under Review', 'Approved', 'Needs Revision')),
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Version numbers are per student+chapter and allocated under a row
-- lock, so two rapid uploads cannot both claim v2.
CREATE UNIQUE INDEX IF NOT EXISTS submissions_student_chapter_version_key
  ON submissions (student_id, chapter_id, version);
CREATE INDEX IF NOT EXISTS submissions_project_idx    ON submissions (project_id);
CREATE INDEX IF NOT EXISTS submissions_supervisor_idx ON submissions (supervisor_id, status);
CREATE INDEX IF NOT EXISTS submissions_submitted_idx  ON submissions (submitted_at);

DROP TRIGGER IF EXISTS submissions_set_updated_at ON submissions;
CREATE TRIGGER submissions_set_updated_at BEFORE UPDATE ON submissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── feedback ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID        NOT NULL REFERENCES submissions (id) ON DELETE CASCADE,
  project_id    UUID        NOT NULL REFERENCES projects (id)    ON DELETE CASCADE,
  student_id    UUID        NOT NULL REFERENCES users (id)       ON DELETE CASCADE,
  supervisor_id UUID                 REFERENCES users (id)       ON DELETE SET NULL,
  chapter_label TEXT,
  comment       TEXT        NOT NULL CHECK (length(btrim(comment)) > 0),
  rating        TEXT        NOT NULL CHECK (rating IN ('Approved', 'Needs Revision')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_student_idx    ON feedback (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_submission_idx ON feedback (submission_id);
CREATE INDEX IF NOT EXISTS feedback_supervisor_idx ON feedback (supervisor_id);


-- ── meetings ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meetings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT        NOT NULL CHECK (length(btrim(title)) > 0),
  supervisor_id   UUID                 REFERENCES users (id) ON DELETE SET NULL,
  organizer_id    UUID                 REFERENCES users (id) ON DELETE SET NULL,
  scheduled_date  DATE        NOT NULL,
  scheduled_time  TEXT        NOT NULL,          -- "14:30", as supplied by <input type=time>
  duration        TEXT        NOT NULL DEFAULT '1 hour',
  platform        TEXT        NOT NULL DEFAULT 'Zoom'
                              CHECK (platform IN ('Zoom', 'Google Meet', 'In-Person')),
  link            TEXT,
  notes           TEXT,
  meeting_type    TEXT        NOT NULL DEFAULT 'Scheduled'
                              CHECK (meeting_type IN ('Scheduled', 'Requested')),
  status          TEXT        NOT NULL DEFAULT 'Upcoming'
                              CHECK (status IN ('Upcoming', 'Completed', 'Cancelled')),
  zoom_meeting_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meetings_supervisor_idx ON meetings (supervisor_id, scheduled_date);
CREATE INDEX IF NOT EXISTS meetings_status_idx     ON meetings (status, scheduled_date);

DROP TRIGGER IF EXISTS meetings_set_updated_at ON meetings;
CREATE TRIGGER meetings_set_updated_at BEFORE UPDATE ON meetings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE IF NOT EXISTS meeting_participants (
  meeting_id UUID NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users (id)    ON DELETE CASCADE,
  PRIMARY KEY (meeting_id, user_id)
);

CREATE INDEX IF NOT EXISTS meeting_participants_user_idx ON meeting_participants (user_id);


-- ── notifications ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       TEXT        NOT NULL DEFAULT 'system'
                         CHECK (type IN ('feedback', 'meeting', 'deadline', 'submission', 'approval', 'system')),
  message    TEXT        NOT NULL,
  link       TEXT,
  read       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Covers both the list (user + newest first) and the unread badge poll.
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx       ON notifications (user_id) WHERE read = FALSE;
