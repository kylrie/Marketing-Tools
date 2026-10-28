import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import type {
  MktAdAttributionViewRow,
  MktAdCatalogRow,
} from '@/lib/meta-engine/types';

export const dynamic = 'force-dynamic';

export type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'last_7d'
  | 'last_30d'
  | 'all_time';

function getManilaDateBounds(preset: DateRangePreset): {
  startDate: string | null;
  endDate: string | null;
  startIso: string | null;
  endIso: string | null;
} {
  if (preset === 'all_time') {
    return { startDate: null, endDate: null, startIso: null, endIso: null };
  }

  const now = new Date();
  const manilaFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const todayManilaStr = manilaFormatter.format(now);
  const [year, month, day] = todayManilaStr.split('-').map(Number);
  const todayUtcMidnight = new Date(Date.UTC(year, month - 1, day));

  const formatYmd = (d: Date) => d.toISOString().slice(0, 10);

  let startDateStr = todayManilaStr;
  let endDateStr = todayManilaStr;

  if (preset === 'yesterday') {
    const yest = new Date(todayUtcMidnight);
    yest.setUTCDate(yest.getUTCDate() - 1);
    startDateStr = formatYmd(yest);
    endDateStr = startDateStr;
  } else if (preset === 'last_7d') {
    const start = new Date(todayUtcMidnight);
    start.setUTCDate(start.getUTCDate() - 6);
    startDateStr = formatYmd(start);
    endDateStr = todayManilaStr;
  } else if (preset === 'last_30d') {
    const start = new Date(todayUtcMidnight);
    start.setUTCDate(start.getUTCDate() - 29);
    startDateStr = formatYmd(start);
    endDateStr = todayManilaStr;
  }

  return {
    startDate: startDateStr,
    endDate: endDateStr,
    startIso: `${startDateStr}T00:00:00.000+08:00`,
    endIso: `${endDateStr}T23:59:59.999+08:00`,
  };
}

export interface OrganicAttributionSummary {
  organicDms: number;
  organicQualified: number;
  organicPendingPhp: number;
  organicWonPhp: number;
  organicWonCount: number;
  commentShieldRepliesCount: number;
}

async function computeOrganicSummary(): Promise<OrganicAttributionSummary> {
  const supabase = getSupabaseAdmin();
  const [{ data: allLedger }, { data: shieldLogs }] = await Promise.all([
    supabase
      .from('mkt_attribution_ledger')
      .select('source_ad_id, crm_stage, deal_value'),
    supabase
      .from('mkt_automation_logs')
      .select('id, module')
      .eq('module', 'COMMENT_SHIELD'),
  ]);

  let organicDms = 0;
  let organicQualified = 0;
  let organicPendingPhp = 0;
  let organicWonPhp = 0;
  let organicWonCount = 0;

  for (const row of allLedger || []) {
    if (row.source_ad_id) continue;
    organicDms += 1;
    const stage = String(row.crm_stage || 'NEW_INQUIRY');
    const val = Number(row.deal_value ?? 0);
    if (stage === 'QUALIFIED' || stage === 'PENDING' || stage === 'WON') {
      organicQualified += 1;
    }
    if (stage === 'PENDING') {
      organicPendingPhp += val;
    }
    if (stage === 'WON') {
      organicWonCount += 1;
      organicWonPhp += val;
    }
  }

  return {
    organicDms,
    organicQualified,
    organicPendingPhp: Number(organicPendingPhp.toFixed(2)),
    organicWonPhp: Number(organicWonPhp.toFixed(2)),
    organicWonCount,
    commentShieldRepliesCount: (shieldLogs || []).length,
  };
}

/**
 * GET /api/marketing/attribution?range=last_7d
 * Queries `v_mkt_ad_attribution` joined with `mkt_ads_catalog` for `all_time`,
 * or computes date-sliced attribution metrics for `today`, `yesterday`, `last_7d`, `last_30d`.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const range = (searchParams.get('range') || 'last_30d') as DateRangePreset;
    const supabase = getSupabaseAdmin();
    const organicSummary = await computeOrganicSummary();

    if (range === 'all_time') {
      const [{ data: viewRows, error: viewError }, { data: catalogRows, error: catError }] =
        await Promise.all([
          supabase.from('v_mkt_ad_attribution').select('*'),
          supabase.from('mkt_ads_catalog').select('*'),
        ]);

      if (viewError) {
        throw new Error(`[AttributionAPI] Error querying v_mkt_ad_attribution: ${viewError.message}`);
      }
      if (catError) {
        throw new Error(`[AttributionAPI] Error querying mkt_ads_catalog: ${catError.message}`);
      }

      const catalogMap = new Map<string, MktAdCatalogRow>();
      for (const cat of (catalogRows || []) as MktAdCatalogRow[]) {
        catalogMap.set(cat.ad_id, cat);
      }

      const mergedRows: MktAdAttributionViewRow[] = (viewRows || []).map((row: Record<string, unknown>) => {
        const adId = String(row.ad_id);
        const cat = catalogMap.get(adId);
        const totalSpend = Number(row.total_spend ?? 0);
        const totalImpressions = Number(row.total_impressions ?? 0);
        const totalLinkClicks = Number(row.total_link_clicks ?? 0);
        const totalVideo3sViews = Number(row.total_video_3s_views ?? 0);
        const totalThruplays = Number(row.total_thruplays ?? 0);
        const hookRatePct = Number(row.hook_rate_pct ?? 0);
        const holdRatePct = Number(row.hold_rate_pct ?? 0);
        const metaConversations = Number(row.meta_conversations ?? 0);
        const attributedDms = Number(row.attributed_dms ?? 0);
        const totalDms = Number(row.total_dms ?? Math.max(metaConversations, attributedDms));
        const qualifiedCount = Number(row.qualified_count ?? 0);
        const stageQualifiedOnlyCount = Number(row.stage_qualified_only_count ?? 0);
        const pendingCount = Number(row.pending_count ?? 0);
        const pendingPipelineValue = Number(row.pending_pipeline_value ?? 0);
        const wonCount = Number(row.won_count ?? 0);
        const lostCount = Number(row.lost_count ?? 0);
        const closedRevenue = Number(row.closed_revenue ?? 0);
        const trueCpa =
          row.true_cpa !== null && row.true_cpa !== undefined
            ? Number(row.true_cpa)
            : wonCount > 0
              ? Number((totalSpend / wonCount).toFixed(2))
              : null;
        const trueRoas =
          row.true_roas !== null && row.true_roas !== undefined
            ? Number(row.true_roas)
            : totalSpend > 0
              ? Number((closedRevenue / totalSpend).toFixed(2))
              : 0;
        const chatCloseRatePct =
          totalDms > 0 ? Number(((wonCount / totalDms) * 100).toFixed(2)) : 0;

        return {
          ad_id: adId,
          ad_name: String(cat?.ad_name ?? row.ad_name ?? `Ad ${adId}`),
          adset_id: (cat?.adset_id ?? (row.adset_id as string | null)) || null,
          adset_name: (cat?.adset_name ?? (row.adset_name as string | null)) || null,
          campaign_id: (cat?.campaign_id ?? (row.campaign_id as string | null)) || null,
          campaign_name: (cat?.campaign_name ?? (row.campaign_name as string | null)) || null,
          status: String(cat?.status ?? row.status ?? 'UNKNOWN'),
          thumbnail_url: (cat?.thumbnail_url ?? (row.thumbnail_url as string | null)) || null,
          creative_body: (cat?.creative_body ?? (row.creative_body as string | null)) || null,
          updated_at: String(cat?.updated_at ?? row.updated_at ?? new Date().toISOString()),
          total_spend: totalSpend,
          total_impressions: totalImpressions,
          total_link_clicks: totalLinkClicks,
          total_video_3s_views: totalVideo3sViews,
          total_thruplays: totalThruplays,
          hook_rate_pct: hookRatePct,
          hold_rate_pct: holdRatePct,
          meta_conversations: metaConversations,
          attributed_dms: attributedDms,
          total_dms: totalDms,
          qualified_count: qualifiedCount,
          stage_qualified_only_count: stageQualifiedOnlyCount,
          pending_count: pendingCount,
          pending_pipeline_value: pendingPipelineValue,
          won_count: wonCount,
          lost_count: lostCount,
          closed_revenue: closedRevenue,
          true_cpa: trueCpa,
          true_roas: trueRoas,
          chat_close_rate_pct: chatCloseRatePct,
          is_window_shopper: totalDms >= 20 && qualifiedCount === 0 && wonCount === 0,
        };
      });

      mergedRows.sort((a, b) => b.total_spend - a.total_spend);

      return NextResponse.json({
        range,
        ads: mergedRows,
        organicSummary,
        fetchedAt: new Date().toISOString(),
      });
    }

    const { startDate, endDate, startIso, endIso } = getManilaDateBounds(range);

    let metricsQuery = supabase
      .from('mkt_ad_daily_metrics')
      .select('ad_id, spend, impressions, link_clicks, video_3s_views, thruplays, meta_conversations');
    if (startDate) metricsQuery = metricsQuery.gte('date_stat', startDate);
    if (endDate) metricsQuery = metricsQuery.lte('date_stat', endDate);

    let ledgerQuery = supabase
      .from('mkt_attribution_ledger')
      .select('source_ad_id, crm_stage, deal_value, first_inquiry_at')
      .not('source_ad_id', 'is', null);
    if (startIso) ledgerQuery = ledgerQuery.gte('first_inquiry_at', startIso);
    if (endIso) ledgerQuery = ledgerQuery.lte('first_inquiry_at', endIso);

    const [
      { data: catalogRows, error: catError },
      { data: metricRows, error: metricError },
      { data: ledgerRows, error: ledgerError },
    ] = await Promise.all([
      supabase.from('mkt_ads_catalog').select('*'),
      metricsQuery,
      ledgerQuery,
    ]);

    if (catError) throw new Error(`[AttributionAPI] Catalog query error: ${catError.message}`);
    if (metricError) throw new Error(`[AttributionAPI] Metrics query error: ${metricError.message}`);
    if (ledgerError) throw new Error(`[AttributionAPI] Ledger query error: ${ledgerError.message}`);

    const metricsByAd = new Map<
      string,
      {
        spend: number;
        impressions: number;
        linkClicks: number;
        video3sViews: number;
        thruplays: number;
        metaConversations: number;
      }
    >();

    for (const m of metricRows || []) {
      const adId = String(m.ad_id);
      const curr = metricsByAd.get(adId) || {
        spend: 0,
        impressions: 0,
        linkClicks: 0,
        video3sViews: 0,
        thruplays: 0,
        metaConversations: 0,
      };
      curr.spend += Number(m.spend ?? 0);
      curr.impressions += Number(m.impressions ?? 0);
      curr.linkClicks += Number(m.link_clicks ?? 0);
      curr.video3sViews += Number(m.video_3s_views ?? 0);
      curr.thruplays += Number(m.thruplays ?? 0);
      curr.metaConversations += Number(m.meta_conversations ?? 0);
      metricsByAd.set(adId, curr);
    }

    const crmByAd = new Map<
      string,
      {
        attributedDms: number;
        qualifiedCount: number;
        stageQualifiedOnlyCount: number;
        pendingCount: number;
        pendingPipelineValue: number;
        wonCount: number;
        lostCount: number;
        closedRevenue: number;
      }
    >();

    for (const l of ledgerRows || []) {
      const adId = String(l.source_ad_id);
      const curr = crmByAd.get(adId) || {
        attributedDms: 0,
        qualifiedCount: 0,
        stageQualifiedOnlyCount: 0,
        pendingCount: 0,
        pendingPipelineValue: 0,
        wonCount: 0,
        lostCount: 0,
        closedRevenue: 0,
      };
      curr.attributedDms += 1;
      const stage = String(l.crm_stage);
      const val = Number(l.deal_value ?? 0);

      if (stage === 'QUALIFIED' || stage === 'PENDING' || stage === 'WON') {
        curr.qualifiedCount += 1;
      }
      if (stage === 'QUALIFIED') {
        curr.stageQualifiedOnlyCount += 1;
      }
      if (stage === 'PENDING') {
        curr.pendingCount += 1;
        curr.pendingPipelineValue += val;
      }
      if (stage === 'WON') {
        curr.wonCount += 1;
        curr.closedRevenue += val;
      }
      if (stage === 'LOST') {
        curr.lostCount += 1;
      }
      crmByAd.set(adId, curr);
    }

    const ads: MktAdAttributionViewRow[] = ((catalogRows || []) as MktAdCatalogRow[]).map(
      (cat) => {
        const m = metricsByAd.get(cat.ad_id) || {
          spend: 0,
          impressions: 0,
          linkClicks: 0,
          video3sViews: 0,
          thruplays: 0,
          metaConversations: 0,
        };
        const c = crmByAd.get(cat.ad_id) || {
          attributedDms: 0,
          qualifiedCount: 0,
          stageQualifiedOnlyCount: 0,
          pendingCount: 0,
          pendingPipelineValue: 0,
          wonCount: 0,
          lostCount: 0,
          closedRevenue: 0,
        };

        const totalSpend = Number(m.spend.toFixed(2));
        const hookRatePct =
          m.impressions > 0
            ? Number(((m.video3sViews / m.impressions) * 100).toFixed(2))
            : 0;
        const holdRatePct =
          m.video3sViews > 0
            ? Number(((m.thruplays / m.video3sViews) * 100).toFixed(2))
            : 0;

        const totalDms = Math.max(m.metaConversations, c.attributedDms);
        const trueCpa =
          c.wonCount > 0 ? Number((totalSpend / c.wonCount).toFixed(2)) : null;
        const trueRoas =
          totalSpend > 0 ? Number((c.closedRevenue / totalSpend).toFixed(2)) : 0;
        const chatCloseRatePct =
          totalDms > 0 ? Number(((c.wonCount / totalDms) * 100).toFixed(2)) : 0;

        return {
          ad_id: cat.ad_id,
          ad_name: cat.ad_name,
          adset_id: cat.adset_id,
          adset_name: cat.adset_name,
          campaign_id: cat.campaign_id,
          campaign_name: cat.campaign_name,
          status: cat.status,
          thumbnail_url: cat.thumbnail_url,
          creative_body: cat.creative_body,
          updated_at: cat.updated_at || new Date().toISOString(),
          total_spend: totalSpend,
          total_impressions: m.impressions,
          total_link_clicks: m.linkClicks,
          total_video_3s_views: m.video3sViews,
          total_thruplays: m.thruplays,
          hook_rate_pct: hookRatePct,
          hold_rate_pct: holdRatePct,
          meta_conversations: m.metaConversations,
          attributed_dms: c.attributedDms,
          total_dms: totalDms,
          qualified_count: c.qualifiedCount,
          stage_qualified_only_count: c.stageQualifiedOnlyCount,
          pending_count: c.pendingCount,
          pending_pipeline_value: Number(c.pendingPipelineValue.toFixed(2)),
          won_count: c.wonCount,
          lost_count: c.lostCount,
          closed_revenue: Number(c.closedRevenue.toFixed(2)),
          true_cpa: trueCpa,
          true_roas: trueRoas,
          chat_close_rate_pct: chatCloseRatePct,
          is_window_shopper: totalDms >= 20 && c.qualifiedCount === 0 && c.wonCount === 0,
        };
      }
    );

    ads.sort((a, b) => b.total_spend - a.total_spend);

    return NextResponse.json({
      range,
      startDate,
      endDate,
      ads,
      organicSummary,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[AttributionAPI] Failed loading attribution data:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed loading Meta attribution data.',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/marketing/attribution
 * Generates a read-only Executive Report share link in `mkt_share_links`.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: 'CREATE_SHARE_LINK';
      label?: string;
    };

    const supabase = getSupabaseAdmin();
    const token = `exec-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const label =
      body.label?.trim() ||
      `Executive Marketing & Revenue Report (${new Date().toLocaleDateString('en-PH')})`;

    const { error } = await supabase.from('mkt_share_links').insert({
      token,
      label,
      is_active: true,
      created_at: new Date().toISOString(),
      expires_at: null,
    });

    if (error) {
      throw new Error(
        `[AttributionAPI] Failed creating share link: ${error.message}`
      );
    }

    return NextResponse.json({
      success: true,
      token,
      label,
      shareUrl: `/exec-report/${token}`,
    });
  } catch (error) {
    console.error('[AttributionAPI] POST share link error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed generating executive share link.',
      },
      { status: 500 }
    );
  }
}
