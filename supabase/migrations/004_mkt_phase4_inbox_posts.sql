-- ============================================================================
-- Phase 4 Migration: Omnichannel Chat Inbox & Organic Social Post Studio
-- Prefix: mkt_ (Bridge-Ready Modular Schema)
-- ============================================================================

-- 1. Omnichannel Chat Messages Log (`mkt_inbox_messages`)
CREATE TABLE IF NOT EXISTS public.mkt_inbox_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id TEXT NOT NULL,
    customer_psid TEXT NOT NULL,
    customer_name TEXT,
    platform TEXT NOT NULL DEFAULT 'MESSENGER' CHECK (platform IN ('MESSENGER', 'INSTAGRAM')),
    direction TEXT NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND')),
    message_text TEXT NOT NULL,
    message_mid TEXT UNIQUE,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mkt_inbox_messages_psid
    ON public.mkt_inbox_messages (customer_psid, sent_at DESC);

-- 2. Published Organic Social Posts (`mkt_social_posts`)
CREATE TABLE IF NOT EXISTS public.mkt_social_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id TEXT UNIQUE NOT NULL,
    platform TEXT NOT NULL DEFAULT 'FACEBOOK' CHECK (platform IN ('FACEBOOK', 'INSTAGRAM')),
    media_type TEXT NOT NULL DEFAULT 'TEXT' CHECK (media_type IN ('TEXT', 'IMAGE', 'VIDEO')),
    message TEXT NOT NULL,
    media_url TEXT,
    permalink_url TEXT,
    status TEXT NOT NULL DEFAULT 'PUBLISHED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mkt_social_posts_created_at
    ON public.mkt_social_posts (created_at DESC);

