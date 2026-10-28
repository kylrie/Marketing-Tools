export type MktMessagingPlatform = 'MESSENGER' | 'INSTAGRAM';

export type MktCrmStage =
  | 'NEW_INQUIRY'
  | 'QUALIFIED'
  | 'PENDING'
  | 'WON'
  | 'LOST';

export type MktAdToggleStatus = 'ACTIVE' | 'PAUSED';

export interface MktAdCatalogRow {
  ad_id: string;
  ad_name: string;
  adset_id: string | null;
  adset_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  status: string;
  thumbnail_url: string | null;
  creative_body: string | null;
  updated_at?: string;
}

export interface MktAdDailyMetricRow {
  id?: string;
  ad_id: string;
  date_stat: string;
  spend: number;
  impressions: number;
  link_clicks: number;
  video_3s_views: number;
  thruplays: number;
  meta_conversations: number;
  updated_at?: string;
}

export interface MktAttributionLedgerRow {
  id: string;
  customer_psid: string;
  customer_name: string | null;
  platform: MktMessagingPlatform;
  source_ad_id: string | null;
  crm_deal_id: string | null;
  crm_stage: MktCrmStage;
  deal_value: number;
  capi_lead_sent?: boolean;
  capi_purchase_sent: boolean;
  first_inquiry_at: string;
  qualified_at?: string | null;
  closed_at: string | null;
  updated_at: string;
}

export interface MktAdAttributionViewRow {
  ad_id: string;
  ad_name: string;
  adset_id: string | null;
  adset_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  status: string;
  thumbnail_url: string | null;
  creative_body: string | null;
  updated_at: string;
  total_spend: number;
  total_impressions: number;
  total_link_clicks: number;
  total_video_3s_views: number;
  total_thruplays: number;
  hook_rate_pct: number;
  hold_rate_pct: number;
  meta_conversations: number;
  attributed_dms: number;
  total_dms: number;
  qualified_count: number;
  stage_qualified_only_count: number;
  pending_count: number;
  pending_pipeline_value: number;
  won_count: number;
  lost_count: number;
  closed_revenue: number;
  true_cpa: number | null;
  true_roas: number;
  chat_close_rate_pct: number;
  is_window_shopper: boolean;
}

// ============================================================================
// Phase 2 Types: 24/7 Ad Watchdog & AI Comment-to-DM Shield
// ============================================================================

export type MktWatchdogRuleType =
  | 'FREEBIE_SEEKER_KILLER'
  | 'BLEEDING_SPEND_STOPLOSS'
  | 'WINNER_SCALER';

export type MktWatchdogAction =
  | 'PAUSE_AD'
  | 'INCREASE_BUDGET_20_PCT'
  | 'ALERT_ONLY';

export interface MktWatchdogRuleRow {
  id: string;
  rule_name: string;
  is_active: boolean;
  rule_type: MktWatchdogRuleType;
  min_spend_php: number;
  min_dms: number;
  max_qualified_leads: number;
  min_roas: number;
  protect_pending_pipeline: boolean;
  action_to_take: MktWatchdogAction;
  created_at?: string;
  updated_at?: string;
}

export interface MktCommentRuleRow {
  id: string;
  rule_name?: string;
  is_active?: boolean;
  trigger_keywords: string[];
  public_reply_templates: string[];
  private_dm_template: string;
  auto_hide_inquiry_comment: boolean;
  ai_moderation_enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export type MktAutomationModule = 'WATCHDOG' | 'COMMENT_SHIELD';

export interface MktAutomationLogRow {
  id: string;
  module: MktAutomationModule;
  action_taken: string;
  target_id: string;
  target_name: string | null;
  reason: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export type MktCommentIntentCategory =
  | 'PRICE_INQUIRY'
  | 'SPAM_OR_TROLL'
  | 'SUPPORT_COMPLAINT'
  | 'GENERAL_PRAISE';

// ============================================================================
// Phase 3 Types: Bulk Click-to-Message Ad Launcher Engine
// ============================================================================

export interface MktChatIcebreaker {
  question: string;
  payload: string;
}

export interface MktChatTemplateRow {
  id: string;
  template_name: string;
  greeting_text: string;
  icebreakers: MktChatIcebreaker[];
  created_at?: string;
  updated_at?: string;
}

export interface MktLaunchBatchRow {
  id: string;
  campaign_id: string;
  campaign_name?: string | null;
  adset_id: string;
  adset_name?: string | null;
  taxonomy_prefix: string;
  total_ads_created: number;
  launch_status: MktAdToggleStatus;
  created_ad_ids?: string[];
  created_at: string;
}

export interface MktGeneratedCopyHook {
  angle: 'DIRECT_PROMO_OFFER' | 'PROBLEM_AGITATE_SOLVE' | 'TAGLISH_CONVERSATIONAL_HOOK';
  label: string;
  primaryText: string;
}

export interface MktCopyGenerationOutput {
  hooks: MktGeneratedCopyHook[];
  headlines: string[];
}

// ============================================================================
// Phase 5 Types: Business Profile Knowledge Base & 7-Day Content Planner
// ============================================================================

export type MktToneOfVoice = 'TAGLISH' | 'ENGLISH' | 'PROFESSIONAL';

export interface MktBusinessKnowledgeRow {
  id: string;
  page_id: string;
  business_name: string;
  category: string;
  about_description: string;
  pricing_and_packages: string;
  faqs_and_policies: string;
  booking_and_payment_info: string;
  location_and_hours: string;
  contact_info: string;
  tone_of_voice: MktToneOfVoice;
  auto_reply_dms: boolean;
  auto_reply_comments: boolean;
  auto_qualify_leads: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface MktWeeklyCalendarPostPlan {
  dayNumber: number;
  dayName: string;
  theme: string;
  recommendedTime: string;
  headline: string;
  caption: string;
  promoBadge: string;
}

// ============================================================================
// Phase 6 Types: Multi-Page Manager & Page-Scoped AI Bot Router
// ============================================================================

export interface MktConnectedPageRow {
  id: string;
  page_id: string;
  page_name: string;
  category: string;
  access_token: string;
  ig_business_account_id: string | null;
  ad_account_id: string | null;
  picture_url: string | null;
  is_active: boolean;
  webhook_subscribed: boolean;
  created_at?: string;
  updated_at?: string;
}

