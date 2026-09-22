ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS owner_type text NOT NULL DEFAULT 'self',
  ADD COLUMN IF NOT EXISTS member_name text;

ALTER TABLE public.accounts
  DROP CONSTRAINT IF EXISTS accounts_owner_type_check;

ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_owner_type_check CHECK (owner_type IN ('self','partner','child'));