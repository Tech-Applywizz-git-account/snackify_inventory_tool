-- Add brand_name column
ALTER TABLE manual_purchases 
ADD COLUMN IF NOT EXISTS brand_name TEXT;

-- Add confirmation_step column
ALTER TABLE manual_purchases 
ADD COLUMN IF NOT EXISTS confirmation_step TEXT DEFAULT 'done';

-- Update status CHECK constraint to include pending_confirmation
ALTER TABLE manual_purchases 
DROP CONSTRAINT IF EXISTS manual_purchases_status_check;

ALTER TABLE manual_purchases 
ADD CONSTRAINT manual_purchases_status_check 
CHECK (status IN (
  'pending_confirmation',
  'draft_needs_clarification',
  'pending_review',
  'auto_approved',
  'approved',
  'rejected',
  'synced_to_inventory'
));
