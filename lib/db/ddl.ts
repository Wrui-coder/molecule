/** Idempotent schema bootstrap. Single source of truth is `schema.ts`; this is
 *  the SQL that mirrors it. Applied on demand (`npm run db:push`) rather than at
 *  build time so the same file works for both drivers and there is no codegen
 *  step to keep in sync. */
export const DDL = /* sql */ `
CREATE TABLE IF NOT EXISTS apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  prompt text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  current_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS apps_updated_at_idx ON apps (updated_at DESC);

CREATE TABLE IF NOT EXISTS versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  version integer NOT NULL,
  instruction text NOT NULL,
  summary text NOT NULL DEFAULT '',
  html text NOT NULL,
  duration_ms integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS versions_app_version_idx ON versions (app_id, version);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  version integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_app_created_idx ON messages (app_id, created_at);
`;
