-- ============================================================================
-- Phase 6 Migration: Multi-Page Manager (`mkt_connected_pages`)
-- ============================================================================

create table if not exists public.mkt_connected_pages (
  id uuid primary key default gen_random_uuid(),
  page_id text not null unique,
  page_name text not null,
  category text not null default '',
  access_token text not null,
  ig_business_account_id text,
  ad_account_id text,
  picture_url text,
  is_active boolean not null default false,
  webhook_subscribed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.mkt_inbox_conversations
  add column if not exists page_id text;

alter table public.mkt_social_posts
  add column if not exists page_id text;

alter table public.mkt_attribution_ledger
  add column if not exists page_id text;

