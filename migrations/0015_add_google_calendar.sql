-- Title: Add Google Calendar Credentials
-- Description: Per-user Google OAuth credentials (encrypted refresh/access tokens) for the google-calendar recipe, with RLS scoped to the owning user

-- =============================================================================
-- Part 1: Create google_calendar_credentials table
-- =============================================================================
-- One row per user. Tokens are encrypted at rest (AES-256-GCM) by the app
-- before insert; the database never sees plaintext tokens. The device render
-- path reads this row (scoped via SET ROLE byos_app + app.current_user_id) to
-- mint a fresh access token without any browser session present.

CREATE TABLE IF NOT EXISTS google_calendar_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL UNIQUE REFERENCES "user"("id") ON DELETE CASCADE,
    refresh_token_enc TEXT NOT NULL,
    access_token_enc TEXT,
    access_token_expires_at TIMESTAMPTZ,
    scope TEXT,
    google_email TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "google_calendar_credentials_user_id_idx"
    ON google_calendar_credentials ("user_id");

-- =============================================================================
-- Part 2: Row Level Security (per-user; no shared NULL rows)
-- =============================================================================

ALTER TABLE google_calendar_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS google_calendar_credentials_select_policy ON google_calendar_credentials;
DROP POLICY IF EXISTS google_calendar_credentials_insert_policy ON google_calendar_credentials;
DROP POLICY IF EXISTS google_calendar_credentials_update_policy ON google_calendar_credentials;
DROP POLICY IF EXISTS google_calendar_credentials_delete_policy ON google_calendar_credentials;

CREATE POLICY google_calendar_credentials_select_policy ON google_calendar_credentials
    FOR SELECT
    USING (user_id = current_setting('app.current_user_id', true));

CREATE POLICY google_calendar_credentials_insert_policy ON google_calendar_credentials
    FOR INSERT
    WITH CHECK (user_id = current_setting('app.current_user_id', true));

CREATE POLICY google_calendar_credentials_update_policy ON google_calendar_credentials
    FOR UPDATE
    USING (user_id = current_setting('app.current_user_id', true))
    WITH CHECK (user_id = current_setting('app.current_user_id', true));

CREATE POLICY google_calendar_credentials_delete_policy ON google_calendar_credentials
    FOR DELETE
    USING (user_id = current_setting('app.current_user_id', true));

-- =============================================================================
-- Part 3: Grant DML to the RLS app role (mirrors migration 0009)
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON google_calendar_credentials TO byos_app;
