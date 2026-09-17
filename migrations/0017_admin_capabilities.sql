ALTER TABLE admins ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'legacy';
ALTER TABLE admins ALTER COLUMN role SET DEFAULT 'catalog';
ALTER TABLE admins ADD CONSTRAINT admins_role_allowed
  CHECK (role IN ('catalog', 'visual', 'audio', 'finance', 'access', 'full', 'legacy'));
