-- ============================================================================
-- Migration: 002_mkt_phase2_watchdog_comments.sql
-- Project:   Meta Marketing Attribution & Executive BI Web App (Phase 2)
-- Purpose:   24/7 Ad Watchdog Rules Engine, AI Comment-to-DM Shield, and
--            Unified Automation Audit Logs (strictly `mkt_` prefixed).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Table: mkt_watchdog_rules
-- Stores automated 24/7 Ad Watchdog stop-loss, freebie-seeker killer, and scaling rules
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.mkt_watchdog_rules (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name                   TEXT NOT NULL,
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    rule_type                   TEXT NOT NULL CHECK (
                                    rule_type IN (
                                        'FREEBIE_SEEKER_KILLER',
                                        'BLEEDING_SPEND_STOPLOSS',
                                        'WINNER_SCALER'
                                    )
                                ),
    min_spend_php               NUMERIC(14, 2) NOT NULL DEFAULT 0.00 CHECK (min_spend_php >= 0),
    min_dms                     INTEGER NOT NULL DEFAULT 0 CHECK (min_dms >= 0),
    max_qualified_leads         INTEGER NOT NULL DEFAULT 0 CHECK (max_qualified_leads >= 0),
    min_roas                    NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (min_roas >= 0),
    protect_pending_pipeline    BOOLEAN NOT NULL DEFAULT TRUE,
    action_to_take              TEXT NOT NULL CHECK (
                                    action_to_take IN (
                                        'PAUSE_AD',
                                        'INCREASE_BUDGET_20_PCT',
                                        'ALERT_ONLY'
                                    )
                                ),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.mkt_watchdog_rules IS 'Automated 24/7 Watchdog rules evaluating v_mkt_ad_attribution to pause bleeding/window-shopper ads or scale high-ROAS winners.';

CREATE INDEX IF NOT EXISTS idx_mkt_watchdog_rules_active
    ON public.mkt_watchdog_rules (is_active)
    WHERE is_active = TRUE;

DROP TRIGGER IF EXISTS trg_mkt_watchdog_rules_updated_at ON public.mkt_watchdog_rules;
CREATE TRIGGER trg_mkt_watchdog_rules_updated_at
    BEFORE UPDATE ON public.mkt_watchdog_rules
    FOR EACH ROW
    EXECUTE FUNCTION public.mkt_set_updated_at();

-- ============================================================================
-- 2. Table: mkt_comment_rules
-- Stores AI Comment-to-DM Shield keyword triggers, randomized public replies,
-- Private Reply DM templates, and competitor anti-poaching hide settings.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.mkt_comment_rules (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name                   TEXT NOT NULL DEFAULT 'Primary Comment-to-DM Shield',
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    trigger_keywords            TEXT[] NOT NULL DEFAULT '{}',
    public_reply_templates      TEXT[] NOT NULL DEFAULT '{}',
    private_dm_template         TEXT NOT NULL DEFAULT '',
    auto_hide_inquiry_comment   BOOLEAN NOT NULL DEFAULT TRUE,
    ai_moderation_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.mkt_comment_rules IS 'Configuration for Meta Post/Ad Comment-to-DM automation, competitor anti-poaching comment hiding, and Gemini AI comment moderation.';

DROP TRIGGER IF EXISTS trg_mkt_comment_rules_updated_at ON public.mkt_comment_rules;
CREATE TRIGGER trg_mkt_comment_rules_updated_at
    BEFORE UPDATE ON public.mkt_comment_rules
    FOR EACH ROW
    EXECUTE FUNCTION public.mkt_set_updated_at();

-- ============================================================================
-- 3. Table: mkt_automation_logs
-- Immutable audit trail for both WATCHDOG and COMMENT_SHIELD automated actions
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.mkt_automation_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module          TEXT NOT NULL CHECK (module IN ('WATCHDOG', 'COMMENT_SHIELD')),
    action_taken    TEXT NOT NULL,
    target_id       TEXT NOT NULL,
    target_name     TEXT,
    reason          TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.mkt_automation_logs IS 'Audit log recording every automated action executed by the 24/7 Ad Watchdog and AI Comment-to-DM Shield.';

CREATE INDEX IF NOT EXISTS idx_mkt_automation_logs_module_created
    ON public.mkt_automation_logs (module, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mkt_automation_logs_target_id
    ON public.mkt_automation_logs (target_id, created_at DESC);

COMMIT;
