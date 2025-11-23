-- WebEdit AI - Supabase Schema for Edit Rules
-- This table stores persistent edit rules for authenticated users

-- Create the edit_rules table
CREATE TABLE IF NOT EXISTS public.edit_rules (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_key TEXT NOT NULL,
  selector TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('hide', 'remove', 'style', 'text', 'custom')),
  metadata JSONB DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_edit_rules_user_id ON public.edit_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_edit_rules_page_key ON public.edit_rules(page_key);
CREATE INDEX IF NOT EXISTS idx_edit_rules_user_page ON public.edit_rules(user_id, page_key);
CREATE INDEX IF NOT EXISTS idx_edit_rules_active ON public.edit_rules(active);

-- Enable Row Level Security
ALTER TABLE public.edit_rules ENABLE ROW LEVEL SECURITY;

-- Create policies for RLS
-- Users can only read their own rules
CREATE POLICY "Users can read own rules"
  ON public.edit_rules
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own rules
CREATE POLICY "Users can insert own rules"
  ON public.edit_rules
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own rules
CREATE POLICY "Users can update own rules"
  ON public.edit_rules
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own rules
CREATE POLICY "Users can delete own rules"
  ON public.edit_rules
  FOR DELETE
  USING (auth.uid() = user_id);

-- Create a function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create a trigger to call the function
DROP TRIGGER IF EXISTS set_updated_at ON public.edit_rules;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.edit_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Optional: Create a view for active rules only
CREATE OR REPLACE VIEW public.active_edit_rules AS
  SELECT * FROM public.edit_rules
  WHERE active = true
  ORDER BY created_at DESC;

-- Grant permissions (adjust as needed for your setup)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.edit_rules TO authenticated;
GRANT SELECT ON public.active_edit_rules TO authenticated;

-- Example query to get rules for a specific page
-- SELECT * FROM edit_rules WHERE user_id = 'user-uuid' AND page_key = 'example.com/path' AND active = true;

-- Example query to get all rules for a user
-- SELECT * FROM edit_rules WHERE user_id = 'user-uuid' ORDER BY created_at DESC;

