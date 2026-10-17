-- Elite Brothers Club voting app schema
-- Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS polls (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candidates (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id  uuid NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  name     text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  position int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS voters (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code text NOT NULL UNIQUE,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token      text PRIMARY KEY,
  role       text NOT NULL CHECK (role IN ('voter', 'admin')),
  voter_id   uuid REFERENCES voters(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS votes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id      uuid NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  voter_id     uuid NOT NULL REFERENCES voters(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (poll_id, voter_id)
);

CREATE INDEX IF NOT EXISTS idx_candidates_poll ON candidates (poll_id);
CREATE INDEX IF NOT EXISTS idx_votes_poll ON votes (poll_id);
CREATE INDEX IF NOT EXISTS idx_votes_voter ON votes (voter_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
