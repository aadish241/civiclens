-- Complaint Upvotes Table
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS complaint_upvotes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(complaint_id, user_id)
);

-- Add upvote_count column to complaints for fast reads
ALTER TABLE complaints ADD COLUMN IF NOT EXISTS upvote_count INTEGER DEFAULT 0;

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_upvotes_complaint ON complaint_upvotes(complaint_id);
CREATE INDEX IF NOT EXISTS idx_upvotes_user ON complaint_upvotes(user_id);

-- RLS Policies
ALTER TABLE complaint_upvotes ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can view upvotes
CREATE POLICY "Authenticated users can view upvotes"
  ON complaint_upvotes FOR SELECT
  TO authenticated
  USING (true);

-- Users can insert their own upvotes
CREATE POLICY "Users can insert own upvotes"
  ON complaint_upvotes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own upvotes
CREATE POLICY "Users can delete own upvotes"
  ON complaint_upvotes FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Function to sync upvote_count on complaints table
CREATE OR REPLACE FUNCTION update_upvote_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE complaints SET upvote_count = upvote_count + 1 WHERE id = NEW.complaint_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE complaints SET upvote_count = GREATEST(upvote_count - 1, 0) WHERE id = OLD.complaint_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-update count
DROP TRIGGER IF EXISTS trg_upvote_count ON complaint_upvotes;
CREATE TRIGGER trg_upvote_count
  AFTER INSERT OR DELETE ON complaint_upvotes
  FOR EACH ROW EXECUTE FUNCTION update_upvote_count();
