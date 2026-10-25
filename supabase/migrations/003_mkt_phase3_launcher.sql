-- ============================================================================
-- Migration: 003_mkt_phase3_launcher.sql
-- Project:   Meta Marketing Attribution & Executive BI Web App (Phase 3)
-- Purpose:   Bulk Click-to-Message Ad Launcher Studio tables (`mkt_chat_templates`
--            and `mkt_launch_batches`), strictly `mkt_` prefixed.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Table: mkt_chat_templates
-- Saved Messenger & Instagram DM Greeting + Icebreaker JSON templates
-- attached to `object_story_spec.page_welcome_message` during ad creation.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.mkt_chat_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_name   TEXT NOT NULL,
    greeting_text   TEXT NOT NULL,
    icebreakers     JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.mkt_chat_templates IS 'Reusable Messenger & Instagram DM welcome greeting and icebreaker button templates for Click-to-Message ads.';

CREATE INDEX IF NOT EXISTS idx_mkt_chat_templates_created_at
    ON public.mkt_chat_templates (created_at DESC);

DROP TRIGGER IF EXISTS trg_mkt_chat_templates_updated_at ON public.mkt_chat_templates;
CREATE TRIGGER trg_mkt_chat_templates_updated_at
    BEFORE UPDATE ON public.mkt_chat_templates
    FOR EACH ROW
    EXECUTE FUNCTION public.mkt_set_updated_at();

-- ============================================================================
-- 2. Table: mkt_launch_batches
-- Audit & history log of bulk Click-to-Message ad launches
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.mkt_launch_batches (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id         TEXT NOT NULL,
    campaign_name       TEXT,
    adset_id            TEXT NOT NULL,
    adset_name          TEXT,
    taxonomy_prefix     TEXT NOT NULL,
    total_ads_created   INTEGER NOT NULL DEFAULT 0 CHECK (total_ads_created >= 0),
    launch_status       TEXT NOT NULL DEFAULT 'PAUSED'
                        CHECK (launch_status IN ('PAUSED', 'ACTIVE')),
    created_ad_ids      TEXT[] NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.mkt_launch_batches IS 'History of bulk Click-to-Message ad launches pushed to Meta Ads Manager.';

CREATE INDEX IF NOT EXISTS idx_mkt_launch_batches_created_at
    ON public.mkt_launch_batches (created_at DESC);

COMMIT;
