ALTER TABLE books ADD COLUMN IF NOT EXISTS source_metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE reading_progress ADD COLUMN IF NOT EXISTS completed boolean NOT NULL DEFAULT false;
ALTER TABLE audiobook_jobs ADD COLUMN IF NOT EXISTS claim_token text;
ALTER TABLE audiobook_jobs ADD COLUMN IF NOT EXISTS lease_expires_at timestamp;
-- An old worker cannot complete without the new lease contract. Expired work
-- is refunded by the recovery sweep before new work is accepted.
UPDATE audiobook_jobs SET lease_expires_at = now() WHERE status = 'processing' AND lease_expires_at IS NULL;
CREATE INDEX IF NOT EXISTS audiobook_jobs_recovery_idx ON audiobook_jobs(status, lease_expires_at);
