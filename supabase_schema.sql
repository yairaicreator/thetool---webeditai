-- WebEdit AI - Supabase Schema
-- These tables store persistent edits and websites for authenticated users.
-- This file documents the REAL tables that exist in the Supabase project.

-- ═══════════════════════════════════════════════════════════════════════════════
-- websites — one row per unique URL a user has edited
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.websites (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_url   TEXT NOT NULL,
  origin     TEXT,
  path       TEXT,
  title      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_websites_user_id   ON public.websites(user_id);
CREATE INDEX IF NOT EXISTS idx_websites_full_url   ON public.websites(user_id, full_url);

ALTER TABLE public.websites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own websites"
  ON public.websites FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own websites"
  ON public.websites FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own websites"
  ON public.websites FOR UPDATE
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own websites"
  ON public.websites FOR DELETE USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- edits — every individual edit a user has made, linked to a website
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.edits (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  website_id       UUID NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  edit_type        TEXT NOT NULL CHECK (edit_type IN ('remove', 'add', 'customize')),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  name             TEXT,
  description      TEXT,
  before_image_url TEXT,
  after_image_url  TEXT,
  payload          JSONB DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_edits_user_id    ON public.edits(user_id);
CREATE INDEX IF NOT EXISTS idx_edits_website_id ON public.edits(website_id);
CREATE INDEX IF NOT EXISTS idx_edits_status     ON public.edits(status);

ALTER TABLE public.edits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own edits"
  ON public.edits FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own edits"
  ON public.edits FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own edits"
  ON public.edits FOR UPDATE
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own edits"
  ON public.edits FOR DELETE USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Auto-update updated_at trigger (shared by both tables)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON public.websites;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.websites
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.edits;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.edits
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════════
-- Grants
-- ═══════════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE, DELETE ON public.websites TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.edits TO authenticated;
