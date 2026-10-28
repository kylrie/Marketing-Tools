-- ============================================================================
-- Migration 005: Phase 5 Business Knowledge Base & Content Calendar Scheduling
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mkt_business_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id TEXT NOT NULL UNIQUE,
  business_name TEXT NOT NULL DEFAULT '',
  category TEXT DEFAULT '',
  about_description TEXT DEFAULT '',
  pricing_and_packages TEXT DEFAULT '',
  faqs_and_policies TEXT DEFAULT '',
  booking_and_payment_info TEXT DEFAULT '',
  location_and_hours TEXT DEFAULT '',
  contact_info TEXT DEFAULT '',
  tone_of_voice TEXT NOT NULL DEFAULT 'TAGLISH',
  auto_reply_dms BOOLEAN NOT NULL DEFAULT true,
  auto_reply_comments BOOLEAN NOT NULL DEFAULT true,
  auto_qualify_leads BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.mkt_social_posts
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ NULL;

