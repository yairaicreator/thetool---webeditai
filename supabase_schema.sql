-- WebEdit AI - Supabase Schema (actual production tables)
-- Two tables: websites + edits, linked by website_id FK.

-- ═══════════════════════════════════════════════════════════════════
-- TABLE: websites
-- Stores each unique URL a user has made edits on.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.websites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_url TEXT NOT NULL,
  origin TEXT,
  path TEXT,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_websites_user_id ON public.websites(user_id);
CREATE INDEX IF NOT EXISTS idx_websites_full_url ON public.websites(user_id, full_url);

ALTER TABLE public.websites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own websites"
  ON public.websites FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own websites"
  ON public.websites FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own websites"
  ON public.websites FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own websites"
  ON public.websites FOR DELETE
  USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════
-- TABLE: edits
-- Every individual edit a user has made, linked to a website row.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  website_id UUID NOT NULL REFERENCES public.websites(id) ON DELETE CASCADE,
  edit_type TEXT NOT NULL CHECK (edit_type IN ('remove', 'add', 'customize')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  name TEXT,
  description TEXT,
  payload JSONB DEFAULT '{}',
  before_image_url TEXT,
  after_image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_edits_user_id ON public.edits(user_id);
CREATE INDEX IF NOT EXISTS idx_edits_website_id ON public.edits(website_id);
CREATE INDEX IF NOT EXISTS idx_edits_user_website ON public.edits(user_id, website_id);
CREATE INDEX IF NOT EXISTS idx_edits_status ON public.edits(status);

ALTER TABLE public.edits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own edits"
  ON public.edits FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own edits"
  ON public.edits FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own edits"
  ON public.edits FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own edits"
  ON public.edits FOR DELETE
  USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════
-- Auto-update trigger for updated_at
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_websites ON public.websites;
CREATE TRIGGER set_updated_at_websites
  BEFORE UPDATE ON public.websites
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_edits ON public.edits;
CREATE TRIGGER set_updated_at_edits
  BEFORE UPDATE ON public.edits
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ═══════════════════════════════════════════════════════════════════
-- Grants
-- ═══════════════════════════════════════════════════════════════════

GRANT SELECT, INSERT, UPDATE, DELETE ON public.websites TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.edits TO authenticated;
