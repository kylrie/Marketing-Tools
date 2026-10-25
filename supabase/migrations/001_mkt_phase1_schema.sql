-- ============================================================================
-- Migration: 001_mkt_phase1_schema.sql
-- Project:   Meta Marketing Attribution & Executive BI Web App (Phase 1 MVP)
-- Purpose:   Bridge-ready modular schema (all objects prefixed with `mkt_` / `v_mkt_`)
--            designed for zero-collision merging into the In-House CRM database.
-- ============================================================================

BEGIN;

-- Enable UUID generation extension if not already active
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 0. Shared Utility Trigger: Auto-Update `updated_at` Timestamp
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mkt_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- ============================================================================
-- 1. Table: mkt_ads_catalog
-- Stores Meta Ad metadata, hierarchy (Campaign -> AdSet -> Ad), status, and creative
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.mkt_ads_catalog (
    ad_id           TEXT PRIMARY KEY,
    ad_name         TEXT NOT NULL DEFAULT 'Untitled Ad',
    adset_id        TEXT,
    adset_name      TEXT,
    campaign_id     TEXT,
    campaign_name   TEXT,
    status          TEXT NOT NULL DEFAULT 'UNKNOWN',
    thumbnail_url   TEXT,
    creative_body   TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.mkt_ads_catalog IS 'Meta Ads catalog synced hourly via Marketing API and stub-upserted on real-time webhook referrals.';

CREATE INDEX IF NOT EXISTS idx_mkt_ads_catalog_status
    ON public.mkt_ads_catalog (status);

CREATE INDEX IF NOT EXISTS idx_mkt_ads_catalog_campaign_id
    ON public.mkt_ads_catalog (campaign_id);

CREATE INDEX IF NOT EXISTS idx_mkt_ads_catalog_adset_id
    ON public.mkt_ads_catalog (adset_id);

DROP TRIGGER IF EXISTS trg_mkt_ads_catalog_updated_at ON public.mkt_ads_catalog;
CREATE TRIGGER trg_mkt_ads_catalog_updated_at
    BEFORE UPDATE ON public.mkt_ads_catalog
    FOR EACH ROW
    EXECUTE FUNCTION public.mkt_set_updated_at();

-- ============================================================================
-- 2. Table: mkt_ad_daily_metrics
-- Stores daily ad performance metrics pulled hourly from Meta Insights API
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.mkt_ad_daily_metrics (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_id               TEXT NOT NULL REFERENCES public.mkt_ads_catalog(ad_id) ON DELETE CASCADE,
    date_stat           DATE NOT NULL,
    spend               NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (spend >= 0),
    impressions         INTEGER NOT NULL DEFAULT 0 CHECK (impressions >= 0),
    link_clicks         INTEGER NOT NULL DEFAULT 0 CHECK (link_clicks >= 0),
    video_3s_views      INTEGER NOT NULL DEFAULT 0 CHECK (video_3s_views >= 0),
    thruplays           INTEGER NOT NULL DEFAULT 0 CHECK (thruplays >= 0),
    meta_conversations  INTEGER NOT NULL DEFAULT 0 CHECK (meta_conversations >= 0),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_mkt_ad_daily_metrics_ad_date UNIQUE (ad_id, date_stat)
);

COMMENT ON TABLE public.mkt_ad_daily_metrics IS 'Daily granular ad metrics from Meta Insights API. Upserted hourly on (ad_id, date_stat).';

CREATE INDEX IF NOT EXISTS idx_mkt_ad_daily_metrics_date_stat
    ON public.mkt_ad_daily_metrics (date_stat DESC);

CREATE INDEX IF NOT EXISTS idx_mkt_ad_daily_metrics_ad_id_date
    ON public.mkt_ad_daily_metrics (ad_id, date_stat DESC);

DROP TRIGGER IF EXISTS trg_mkt_ad_daily_metrics_updated_at ON public.mkt_ad_daily_metrics;
CREATE TRIGGER trg_mkt_ad_daily_metrics_updated_at
    BEFORE UPDATE ON public.mkt_ad_daily_metrics
    FOR EACH ROW
    EXECUTE FUNCTION public.mkt_set_updated_at();

-- ============================================================================
-- 3. Table: mkt_attribution_ledger
-- Maps each Messenger PSID / Instagram IGSID to its originating Meta Ad and CRM deal lifecycle
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.mkt_attribution_ledger (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_psid       TEXT NOT NULL UNIQUE,
    customer_name       TEXT,
    platform            TEXT NOT NULL CHECK (platform IN ('MESSENGER', 'INSTAGRAM')),
    source_ad_id        TEXT REFERENCES public.mkt_ads_catalog(ad_id) ON DELETE SET NULL,
    crm_deal_id         TEXT,
    crm_stage           TEXT NOT NULL DEFAULT 'NEW_INQUIRY'
                        CHECK (crm_stage IN ('NEW_INQUIRY', 'QUALIFIED', 'PENDING', 'WON', 'LOST')),
    deal_value          NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (deal_value >= 0),
    capi_purchase_sent  BOOLEAN NOT NULL DEFAULT FALSE,
    first_inquiry_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at           TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.mkt_attribution_ledger IS 'Customer-level attribution ledger bridging Meta messaging webhooks (PSID/IGSID + source_ad_id) with In-House CRM deal stages and CAPI loopback status.';

CREATE INDEX IF NOT EXISTS idx_mkt_attribution_ledger_source_ad_id
    ON public.mkt_attribution_ledger (source_ad_id);

CREATE INDEX IF NOT EXISTS idx_mkt_attribution_ledger_crm_deal_id
    ON public.mkt_attribution_ledger (crm_deal_id)
    WHERE crm_deal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mkt_attribution_ledger_crm_stage
    ON public.mkt_attribution_ledger (crm_stage);

CREATE INDEX IF NOT EXISTS idx_mkt_attribution_ledger_first_inquiry_at
    ON public.mkt_attribution_ledger (first_inquiry_at DESC);

DROP TRIGGER IF EXISTS trg_mkt_attribution_ledger_updated_at ON public.mkt_attribution_ledger;
CREATE TRIGGER trg_mkt_attribution_ledger_updated_at
    BEFORE UPDATE ON public.mkt_attribution_ledger
    FOR EACH ROW
    EXECUTE FUNCTION public.mkt_set_updated_at();

-- ============================================================================
-- 4. Table: mkt_share_links
-- Tokenized access control for simplified Executive / Client BI report views
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.mkt_share_links (
    token       TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ
);

COMMENT ON TABLE public.mkt_share_links IS 'Shareable read-only tokens for `/exec-report/[token]` executive dashboards.';

CREATE INDEX IF NOT EXISTS idx_mkt_share_links_active_token
    ON public.mkt_share_links (token)
    WHERE is_active = TRUE;

-- ============================================================================
-- 5. SQL View: v_mkt_ad_attribution
-- Pre-aggregates daily Meta metrics and CRM ledger conversions in separate CTEs
-- before joining to `mkt_ads_catalog` to prevent 1:N fan-out multiplication.
-- ============================================================================
CREATE OR REPLACE VIEW public.v_mkt_ad_attribution AS
WITH metrics_agg AS (
    SELECT
        m.ad_id,
        COALESCE(SUM(m.spend), 0)::NUMERIC(14, 2)           AS total_spend,
        COALESCE(SUM(m.impressions), 0)::BIGINT             AS total_impressions,
        COALESCE(SUM(m.link_clicks), 0)::BIGINT             AS total_link_clicks,
        COALESCE(SUM(m.video_3s_views), 0)::BIGINT          AS total_video_3s_views,
        COALESCE(SUM(m.thruplays), 0)::BIGINT               AS total_thruplays,
        COALESCE(SUM(m.meta_conversations), 0)::INTEGER     AS meta_conversations
    FROM public.mkt_ad_daily_metrics m
    GROUP BY m.ad_id
),
crm_agg AS (
    SELECT
        l.source_ad_id AS ad_id,
        COUNT(l.id)::INTEGER AS attributed_dms,
        COUNT(l.id) FILTER (
            WHERE l.crm_stage IN ('QUALIFIED', 'PENDING', 'WON')
        )::INTEGER AS qualified_count,
        COUNT(l.id) FILTER (
            WHERE l.crm_stage = 'QUALIFIED'
        )::INTEGER AS stage_qualified_only_count,
        COUNT(l.id) FILTER (
            WHERE l.crm_stage = 'PENDING'
        )::INTEGER AS pending_count,
        COALESCE(
            SUM(l.deal_value) FILTER (WHERE l.crm_stage = 'PENDING'),
            0
        )::NUMERIC(14, 2) AS pending_pipeline_value,
        COUNT(l.id) FILTER (
            WHERE l.crm_stage = 'WON'
        )::INTEGER AS won_count,
        COUNT(l.id) FILTER (
            WHERE l.crm_stage = 'LOST'
        )::INTEGER AS lost_count,
        COALESCE(
            SUM(l.deal_value) FILTER (WHERE l.crm_stage = 'WON'),
            0
        )::NUMERIC(14, 2) AS closed_revenue
    FROM public.mkt_attribution_ledger l
    WHERE l.source_ad_id IS NOT NULL
    GROUP BY l.source_ad_id
)
SELECT
    c.ad_id,
    c.ad_name,
    c.adset_id,
    c.adset_name,
    c.campaign_id,
    c.campaign_name,
    c.status,
    c.thumbnail_url,
    c.creative_body,
    c.updated_at,

    -- Spend & Delivery Metrics
    COALESCE(m.total_spend, 0.00)::NUMERIC(14, 2) AS total_spend,
    COALESCE(m.total_impressions, 0)::BIGINT AS total_impressions,
    COALESCE(m.total_link_clicks, 0)::BIGINT AS total_link_clicks,
    COALESCE(m.total_video_3s_views, 0)::BIGINT AS total_video_3s_views,
    COALESCE(m.total_thruplays, 0)::BIGINT AS total_thruplays,

    -- Creative Attention Ratios (Hook Rate = 3s Views / Impressions, Hold Rate = ThruPlays / 3s Views)
    COALESCE(
        ROUND(
            (COALESCE(m.total_video_3s_views, 0)::NUMERIC / NULLIF(COALESCE(m.total_impressions, 0), 0)) * 100,
            2
        ),
        0.00
    )::NUMERIC(6, 2) AS hook_rate_pct,
    COALESCE(
        ROUND(
            (COALESCE(m.total_thruplays, 0)::NUMERIC / NULLIF(COALESCE(m.total_video_3s_views, 0), 0)) * 100,
            2
        ),
        0.00
    )::NUMERIC(6, 2) AS hold_rate_pct,

    -- Messaging Volume (takes the greater of Meta-reported conversations vs webhook-attributed DMs, while exposing both)
    COALESCE(m.meta_conversations, 0)::INTEGER AS meta_conversations,
    COALESCE(l.attributed_dms, 0)::INTEGER AS attributed_dms,
    GREATEST(COALESCE(m.meta_conversations, 0), COALESCE(l.attributed_dms, 0))::INTEGER AS total_dms,

    -- CRM Pipeline Metrics
    COALESCE(l.qualified_count, 0)::INTEGER AS qualified_count,
    COALESCE(l.stage_qualified_only_count, 0)::INTEGER AS stage_qualified_only_count,
    COALESCE(l.pending_count, 0)::INTEGER AS pending_count,
    COALESCE(l.pending_pipeline_value, 0.00)::NUMERIC(14, 2) AS pending_pipeline_value,
    COALESCE(l.won_count, 0)::INTEGER AS won_count,
    COALESCE(l.lost_count, 0)::INTEGER AS lost_count,
    COALESCE(l.closed_revenue, 0.00)::NUMERIC(14, 2) AS closed_revenue,

    -- Bottom-Line Efficiency Metrics
    -- True CPA = Spend / Won Count (NULL when won_count = 0 so UI can render "—" instead of $0.00)
    ROUND(
        COALESCE(m.total_spend, 0)::NUMERIC / NULLIF(COALESCE(l.won_count, 0), 0),
        2
    )::NUMERIC(14, 2) AS true_cpa,

    -- True ROAS = Closed Revenue / Spend
    COALESCE(
        ROUND(
            COALESCE(l.closed_revenue, 0)::NUMERIC / NULLIF(COALESCE(m.total_spend, 0), 0),
            2
        ),
        0.00
    )::NUMERIC(10, 2) AS true_roas,

    -- Chat Close Rate % = Won Count / Total DMs
    COALESCE(
        ROUND(
            (
                COALESCE(l.won_count, 0)::NUMERIC /
                NULLIF(GREATEST(COALESCE(m.meta_conversations, 0), COALESCE(l.attributed_dms, 0)), 0)
            ) * 100,
            2
        ),
        0.00
    )::NUMERIC(6, 2) AS chat_close_rate_pct,

    -- Window Shopper Warning Flag: > 20 DMs with 0 Qualified/Won deals
    (
        GREATEST(COALESCE(m.meta_conversations, 0), COALESCE(l.attributed_dms, 0)) > 20
        AND COALESCE(l.qualified_count, 0) = 0
        AND COALESCE(l.won_count, 0) = 0
    ) AS is_window_shopper

FROM public.mkt_ads_catalog c
LEFT JOIN metrics_agg m ON m.ad_id = c.ad_id
LEFT JOIN crm_agg l ON l.ad_id = c.ad_id;

COMMENT ON VIEW public.v_mkt_ad_attribution IS 'Unified per-ad attribution view joining Meta Catalog, aggregated Daily Metrics, and aggregated CRM Attribution Ledger.';

-- ============================================================================
-- 6. Date-Filtered Attribution RPC Function: fn_mkt_ad_attribution_by_date
-- Enables dynamic date-range filtering in the Marketer Command Center while
-- preserving identical column names and calculation semantics as `v_mkt_ad_attribution`.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_mkt_ad_attribution_by_date(
    p_start_date DATE DEFAULT NULL,
    p_end_date   DATE DEFAULT NULL
)
RETURNS SETOF public.v_mkt_ad_attribution
LANGUAGE sql
STABLE
AS $$
    WITH metrics_agg AS (
        SELECT
            m.ad_id,
            COALESCE(SUM(m.spend), 0)::NUMERIC(14, 2)           AS total_spend,
            COALESCE(SUM(m.impressions), 0)::BIGINT             AS total_impressions,
            COALESCE(SUM(m.link_clicks), 0)::BIGINT             AS total_link_clicks,
            COALESCE(SUM(m.video_3s_views), 0)::BIGINT          AS total_video_3s_views,
            COALESCE(SUM(m.thruplays), 0)::BIGINT               AS total_thruplays,
            COALESCE(SUM(m.meta_conversations), 0)::INTEGER     AS meta_conversations
        FROM public.mkt_ad_daily_metrics m
        WHERE (p_start_date IS NULL OR m.date_stat >= p_start_date)
          AND (p_end_date   IS NULL OR m.date_stat <= p_end_date)
        GROUP BY m.ad_id
    ),
    crm_agg AS (
        SELECT
            l.source_ad_id AS ad_id,
            COUNT(l.id)::INTEGER AS attributed_dms,
            COUNT(l.id) FILTER (
                WHERE l.crm_stage IN ('QUALIFIED', 'PENDING', 'WON')
            )::INTEGER AS qualified_count,
            COUNT(l.id) FILTER (
                WHERE l.crm_stage = 'QUALIFIED'
            )::INTEGER AS stage_qualified_only_count,
            COUNT(l.id) FILTER (
                WHERE l.crm_stage = 'PENDING'
            )::INTEGER AS pending_count,
            COALESCE(
                SUM(l.deal_value) FILTER (WHERE l.crm_stage = 'PENDING'),
                0
            )::NUMERIC(14, 2) AS pending_pipeline_value,
            COUNT(l.id) FILTER (
                WHERE l.crm_stage = 'WON'
            )::INTEGER AS won_count,
            COUNT(l.id) FILTER (
                WHERE l.crm_stage = 'LOST'
            )::INTEGER AS lost_count,
            COALESCE(
                SUM(l.deal_value) FILTER (WHERE l.crm_stage = 'WON'),
                0
            )::NUMERIC(14, 2) AS closed_revenue
        FROM public.mkt_attribution_ledger l
        WHERE l.source_ad_id IS NOT NULL
          AND (p_start_date IS NULL OR (l.first_inquiry_at AT TIME ZONE 'Asia/Manila')::DATE >= p_start_date)
          AND (p_end_date   IS NULL OR (l.first_inquiry_at AT TIME ZONE 'Asia/Manila')::DATE <= p_end_date)
        GROUP BY l.source_ad_id
    )
    SELECT
        c.ad_id,
        c.ad_name,
        c.adset_id,
        c.adset_name,
        c.campaign_id,
        c.campaign_name,
        c.status,
        c.thumbnail_url,
        c.creative_body,
        c.updated_at,
        COALESCE(m.total_spend, 0.00)::NUMERIC(14, 2) AS total_spend,
        COALESCE(m.total_impressions, 0)::BIGINT AS total_impressions,
        COALESCE(m.total_link_clicks, 0)::BIGINT AS total_link_clicks,
        COALESCE(m.total_video_3s_views, 0)::BIGINT AS total_video_3s_views,
        COALESCE(m.total_thruplays, 0)::BIGINT AS total_thruplays,
        COALESCE(
            ROUND(
                (COALESCE(m.total_video_3s_views, 0)::NUMERIC / NULLIF(COALESCE(m.total_impressions, 0), 0)) * 100,
                2
            ),
            0.00
        )::NUMERIC(6, 2) AS hook_rate_pct,
        COALESCE(
            ROUND(
                (COALESCE(m.total_thruplays, 0)::NUMERIC / NULLIF(COALESCE(m.total_video_3s_views, 0), 0)) * 100,
                2
            ),
            0.00
        )::NUMERIC(6, 2) AS hold_rate_pct,
        COALESCE(m.meta_conversations, 0)::INTEGER AS meta_conversations,
        COALESCE(l.attributed_dms, 0)::INTEGER AS attributed_dms,
        GREATEST(COALESCE(m.meta_conversations, 0), COALESCE(l.attributed_dms, 0))::INTEGER AS total_dms,
        COALESCE(l.qualified_count, 0)::INTEGER AS qualified_count,
        COALESCE(l.stage_qualified_only_count, 0)::INTEGER AS stage_qualified_only_count,
        COALESCE(l.pending_count, 0)::INTEGER AS pending_count,
        COALESCE(l.pending_pipeline_value, 0.00)::NUMERIC(14, 2) AS pending_pipeline_value,
        COALESCE(l.won_count, 0)::INTEGER AS won_count,
        COALESCE(l.lost_count, 0)::INTEGER AS lost_count,
        COALESCE(l.closed_revenue, 0.00)::NUMERIC(14, 2) AS closed_revenue,
        ROUND(
            COALESCE(m.total_spend, 0)::NUMERIC / NULLIF(COALESCE(l.won_count, 0), 0),
            2
        )::NUMERIC(14, 2) AS true_cpa,
        COALESCE(
            ROUND(
                COALESCE(l.closed_revenue, 0)::NUMERIC / NULLIF(COALESCE(m.total_spend, 0), 0),
                2
            ),
            0.00
        )::NUMERIC(10, 2) AS true_roas,
        COALESCE(
            ROUND(
                (
                    COALESCE(l.won_count, 0)::NUMERIC /
                    NULLIF(GREATEST(COALESCE(m.meta_conversations, 0), COALESCE(l.attributed_dms, 0)), 0)
                ) * 100,
                2
            ),
            0.00
        )::NUMERIC(6, 2) AS chat_close_rate_pct,
        (
            GREATEST(COALESCE(m.meta_conversations, 0), COALESCE(l.attributed_dms, 0)) > 20
            AND COALESCE(l.qualified_count, 0) = 0
            AND COALESCE(l.won_count, 0) = 0
        ) AS is_window_shopper
    FROM public.mkt_ads_catalog c
    LEFT JOIN metrics_agg m ON m.ad_id = c.ad_id
    LEFT JOIN crm_agg l ON l.ad_id = c.ad_id;
$$;

COMMIT;
