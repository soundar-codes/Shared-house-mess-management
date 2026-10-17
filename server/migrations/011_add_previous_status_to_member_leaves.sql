-- 011_add_previous_status_to_member_leaves.sql
ALTER TABLE member_leaves
ADD COLUMN IF NOT EXISTS overwritten_records JSONB DEFAULT '[]'::jsonb;

