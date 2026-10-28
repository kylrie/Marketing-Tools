import { getSupabaseAdmin } from '@/lib/supabase/admin';
import type { MktAdCatalogRow, MktAdDailyMetricRow } from './types';

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

interface MetaActionEntry {
  action_type: string;
  value: string;
}

interface MetaGraphAdNode {
  id: string;
  name?: string;
  status?: string;
  adset?: {
    id: string;
    name?: string;
  };
  campaign?: {
    id: string;
    name?: string;
  };
  creative?: {
    id?: string;
    thumbnail_url?: string;
    body?: string;
  };
}

interface MetaGraphInsightNode {
  ad_id: string;
  ad_name?: string;
  date_start: string;
  date_stop?: string;
  spend?: string;
  impressions?: string;
  inline_link_clicks?: string;
  actions?: MetaActionEntry[];
  video_play_actions?: MetaActionEntry[];
  video_thruplay_watched_actions?: MetaActionEntry[];
}

interface MetaPaginatedResponse<T> {
  data?: T[];
  paging?: {
    cursors?: {
      before?: string;
      after?: string;
    };
    next?: string;
  };
  error?: {
    message: string;
    type: string;
    code: number;
    fbtrace_id?: string;
  };
}

function getMetaAccessToken(): string {
  const token =
    process.env.META_SYSTEM_USER_TOKEN ||
    process.env.META_ACCESS_TOKEN ||
    process.env.META_SYSTEM_USER_ACCESS_TOKEN ||
    process.env.META_PAGE_ACCESS_TOKEN;

  if (!token) {
    throw new Error(
      '[MetaInsights] Missing META_SYSTEM_USER_TOKEN or META_ACCESS_TOKEN environment variable.'
    );
  }
  return token;
}

function getNormalizedAdAccountId(): string {
  const raw = process.env.META_AD_ACCOUNT_ID;
  if (!raw) {
    throw new Error('[MetaInsights] Missing META_AD_ACCOUNT_ID environment variable.');
  }
  return raw.startsWith('act_') ? raw : `act_${raw}`;
}

function extractActionMetric(
  actions: MetaActionEntry[] | undefined,
  actionTypes: string[]
): number {
  if (!Array.isArray(actions) || actions.length === 0) {
    return 0;
  }

  for (const targetType of actionTypes) {
    const matched = actions.find((item) => item.action_type === targetType);
    if (matched && matched.value !== undefined) {
      const parsed = parseInt(matched.value, 10);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
}

/**
 * Fetches all pages from a Meta Graph API endpoint up to `maxPages`.
 */
async function fetchAllMetaPages<T>(initialUrl: string, maxPages = 25): Promise<T[]> {
  const results: T[] = [];
  let nextUrl: string | undefined = initialUrl;
  let pageCount = 0;

  while (nextUrl && pageCount < maxPages) {
    pageCount += 1;
    const response = await fetch(nextUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    const payload = (await response.json()) as MetaPaginatedResponse<T>;

    if (!response.ok || payload.error) {
      const errMsg = payload.error?.message || `HTTP ${response.status}`;
      const errCode = payload.error?.code ?? response.status;
      throw new Error(`[MetaInsights] Graph API Error (${errCode}): ${errMsg}`);
    }

    if (Array.isArray(payload.data)) {
      results.push(...payload.data);
    }

    nextUrl = payload.paging?.next;
  }

  return results;
}

/**
 * 1. syncAdsCatalog()
 * Pulls Ad Catalog metadata (hierarchy, creative thumbnail, body, status)
 * from Meta Marketing API and upserts into `mkt_ads_catalog`.
 */
export async function syncAdsCatalog(): Promise<{
  syncedCount: number;
  ads: MktAdCatalogRow[];
}> {
  const accessToken = getMetaAccessToken();
  const adAccountId = getNormalizedAdAccountId();
  const supabase = getSupabaseAdmin();

  const url = new URL(`${GRAPH_BASE_URL}/${adAccountId}/ads`);
  url.searchParams.set(
    'fields',
    'id,name,status,adset{id,name},campaign{id,name},creative{thumbnail_url,body}'
  );
  url.searchParams.set('limit', '200');
  url.searchParams.set('access_token', accessToken);

  const rawAds = await fetchAllMetaPages<MetaGraphAdNode>(url.toString());

  if (rawAds.length === 0) {
    return { syncedCount: 0, ads: [] };
  }

  const nowIso = new Date().toISOString();
  const catalogRows: MktAdCatalogRow[] = rawAds.map((ad) => ({
    ad_id: ad.id,
    ad_name: ad.name?.trim() || `Ad ${ad.id}`,
    adset_id: ad.adset?.id ?? null,
    adset_name: ad.adset?.name ?? null,
    campaign_id: ad.campaign?.id ?? null,
    campaign_name: ad.campaign?.name ?? null,
    status: ad.status || 'UNKNOWN',
    thumbnail_url: ad.creative?.thumbnail_url ?? null,
    creative_body: ad.creative?.body ?? null,
    updated_at: nowIso,
  }));

  const { error } = await supabase
    .from('mkt_ads_catalog')
    .upsert(catalogRows, { onConflict: 'ad_id' });

  if (error) {
    throw new Error(`[MetaInsights] Failed upserting mkt_ads_catalog: ${error.message}`);
  }

  return {
    syncedCount: catalogRows.length,
    ads: catalogRows,
  };
}

/**
 * 2. syncDailyMetrics(datePreset = 'last_7d')
 * Pulls daily granular ad-level performance metrics (`time_increment=1`),
 * extracts `onsite_conversion.messaging_conversation_started_7d` and video hook/hold metrics,
 * and upserts into `mkt_ad_daily_metrics` on conflict `(ad_id, date_stat)`.
 */
export async function syncDailyMetrics(
  datePreset = 'last_7d',
  customTimeRange?: { since: string; until: string }
): Promise<{
  syncedRows: number;
  datePreset: string;
}> {
  const accessToken = getMetaAccessToken();
  const adAccountId = getNormalizedAdAccountId();
  const supabase = getSupabaseAdmin();

  const url = new URL(`${GRAPH_BASE_URL}/${adAccountId}/insights`);
  url.searchParams.set('level', 'ad');
  url.searchParams.set('time_increment', '1');
  url.searchParams.set(
    'fields',
    'ad_id,ad_name,date_start,spend,impressions,inline_link_clicks,actions,video_play_actions,video_thruplay_watched_actions'
  );
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', accessToken);

  if (customTimeRange?.since && customTimeRange?.until) {
    url.searchParams.set(
      'time_range',
      JSON.stringify({
        since: customTimeRange.since,
        until: customTimeRange.until,
      })
    );
  } else {
    url.searchParams.set('date_preset', datePreset);
  }

  const insightNodes = await fetchAllMetaPages<MetaGraphInsightNode>(url.toString());

  if (insightNodes.length === 0) {
    return { syncedRows: 0, datePreset };
  }

  // Ensure every ad_id in insights exists in `mkt_ads_catalog` so FK constraints never fail
  const uniqueStubAdsMap = new Map<string, { ad_id: string; ad_name: string }>();
  for (const row of insightNodes) {
    if (row.ad_id && !uniqueStubAdsMap.has(row.ad_id)) {
      uniqueStubAdsMap.set(row.ad_id, {
        ad_id: row.ad_id,
        ad_name: row.ad_name?.trim() || `Ad ${row.ad_id}`,
      });
    }
  }

  if (uniqueStubAdsMap.size > 0) {
    const { error: stubError } = await supabase
      .from('mkt_ads_catalog')
      .upsert(Array.from(uniqueStubAdsMap.values()), {
        onConflict: 'ad_id',
        ignoreDuplicates: true,
      });

    if (stubError) {
      throw new Error(
        `[MetaInsights] Failed ensuring stub catalog ads prior to metrics upsert: ${stubError.message}`
      );
    }
  }

  const nowIso = new Date().toISOString();
  const dailyMetricRows: MktAdDailyMetricRow[] = insightNodes.map((node) => {
    const spend = Number.parseFloat(node.spend ?? '0') || 0;
    const impressions = Number.parseInt(node.impressions ?? '0', 10) || 0;
    const linkClicks = Number.parseInt(node.inline_link_clicks ?? '0', 10) || 0;

    // 3-second video plays (from video_play_actions or fallback to actions['video_view'])
    const video3sFromPlayActions = extractActionMetric(node.video_play_actions, [
      'video_view',
    ]);
    const video3sFromActions = extractActionMetric(node.actions, ['video_view']);
    const video3sViews =
      video3sFromPlayActions > 0 ? video3sFromPlayActions : video3sFromActions;

    // ThruPlays (15s or 97% completion)
    const thruplays = extractActionMetric(node.video_thruplay_watched_actions, [
      'video_view',
    ]);

    // Messaging Conversations Started
    const metaConversations = extractActionMetric(node.actions, [
      'onsite_conversion.messaging_conversation_started_7d',
      'onsite_conversion.total_messaging_connection',
    ]);

    return {
      ad_id: node.ad_id,
      date_stat: node.date_start,
      spend: Number(spend.toFixed(2)),
      impressions,
      link_clicks: linkClicks,
      video_3s_views: video3sViews,
      thruplays,
      meta_conversations: metaConversations,
      updated_at: nowIso,
    };
  });

  const { error: metricsError } = await supabase
    .from('mkt_ad_daily_metrics')
    .upsert(dailyMetricRows, { onConflict: 'ad_id,date_stat' });

  if (metricsError) {
    throw new Error(
      `[MetaInsights] Failed upserting mkt_ad_daily_metrics: ${metricsError.message}`
    );
  }

  return {
    syncedRows: dailyMetricRows.length,
    datePreset,
  };
}

