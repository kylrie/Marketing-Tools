import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import type {
  MktAdAttributionViewRow,
  MktAdCatalogRow,
} from '@/lib/meta-engine/types';

export const dynamic = 'force-dynamic';

export type ExecPeriodOption = 'today' | 'last_7d' | 'this_month';

interface ShareLinkRow {
  token: string;
  label: string;
  is_active: boolean;
  created_at?: string;
  expires_at?: string | null;
}

function getManilaPeriodBounds(period: ExecPeriodOption): {
  startDate: string;
  endDate: string;
  startIso: string;
  endIso: string;
} {
  const now = new Date();
  const manilaFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const todayManilaStr = manilaFormatter.format(now); // YYYY-MM-DD
  const [year, month, day] = todayManilaStr.split('-').map(Number);
  const todayUtcMidnight = new Date(Date.UTC(year, month - 1, day));
  const formatYmd = (d: Date) => d.toISOString().slice(0, 10);

  let startDateStr = todayManilaStr;
  const endDateStr = todayManilaStr;

  if (period === 'last_7d') {
    const start = new Date(todayUtcMidnight);
    start.setUTCDate(start.getUTCDate() - 6);
    startDateStr = formatYmd(start);
  } else if (period === 'this_month') {
    const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
    startDateStr = formatYmd(firstOfMonth);
  }

  return {
    startDate: startDateStr,
    endDate: endDateStr,
    startIso: `${startDateStr}T00:00:00.000+08:00`,
    endIso: `${endDateStr}T23:59:59.999+08:00`,
  };
}

/**
 * GET /api/exec-report/[token]?period=this_month
 * Validates the share token in `mkt_share_links` and returns executive-level
 * aggregated metrics, conversion funnel totals, and ad attribution rows.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> | { token: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(context.params);
    const token = resolvedParams.token?.trim();

    if (!token) {
      return NextResponse.json(
        { valid: false, error: 'Missing report share token.' },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const period = (searchParams.get('period') || 'this_month') as ExecPeriodOption;

    const supabase = getSupabaseAdmin();

    // 1. Validate `token` against `mkt_share_links`
    const { data: shareLink, error: tokenError } = await supabase
      .from('mkt_share_links')
      .select('token, label, is_active, created_at, expires_at')
      .eq('token', token)
      .maybeSingle<ShareLinkRow>();

    if (tokenError) {
      throw new Error(`[ExecReportAPI] Failed verifying share token: ${tokenError.message}`);
    }

    if (!shareLink || !shareLink.is_active) {
      return NextResponse.json(
        {
          valid: false,
          error: 'This executive report link is invalid or has been deactivated.',
        },
        { status: 403 }
      );
    }

    if (
      shareLink.expires_at &&
      new Date(shareLink.expires_at).getTime() < Date.now()
    ) {
      return NextResponse.json(
        {
          valid: false,
          error: 'This executive report link has expired.',
        },
        { status: 403 }
      );
    }

    // 2. Compute date bounds in Asia/Manila timezone
    const { startDate, endDate, startIso, endIso } = getManilaPeriodBounds(period);

    const [
      { data: catalogRows, error: catError },
      { data: metricRows, error: metricError },
      { data: ledgerRows, error: ledgerError },
    ] = await Promise.all([
      supabase.from('mkt_ads_catalog').select('*'),
      supabase
        .from('mkt_ad_daily_metrics')
        .select('ad_id, spend, impressions, link_clicks, video_3s_views, thruplays, meta_conversations, updated_at')
        .gte('date_stat', startDate)
        .lte('date_stat', endDate),
      supabase
        .from('mkt_attribution_ledger')
        .select('source_ad_id, crm_stage, deal_value, first_inquiry_at')
        .not('source_ad_id', 'is', null)
        .gte('first_inquiry_at', startIso)
        .lte('first_inquiry_at', endIso),
    ]);

    if (catError) throw new Error(`[ExecReportAPI] Catalog query error: ${catError.message}`);
    if (metricError) throw new Error(`[ExecReportAPI] Metrics query error: ${metricError.message}`);
    if (ledgerError) throw new Error(`[ExecReportAPI] Ledger query error: ${ledgerError.message}`);

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

    let latestSyncTimestamp: string | null = null;

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

      if (m.updated_at && (!latestSyncTimestamp || m.updated_at > latestSyncTimestamp)) {
        latestSyncTimestamp = String(m.updated_at);
      }
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
        if (cat.updated_at && (!latestSyncTimestamp || cat.updated_at > latestSyncTimestamp)) {
          latestSyncTimestamp = cat.updated_at;
        }

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

    return NextResponse.json({
      valid: true,
      reportLabel: shareLink.label,
      period,
      startDate,
      endDate,
      lastSyncedAt: latestSyncTimestamp || new Date().toISOString(),
      ads,
    });
  } catch (error) {
    console.error('[ExecReportAPI] Failed generating executive report:', error);
    return NextResponse.json(
      {
        valid: false,
        error:
          error instanceof Error
            ? error.message
            : 'Internal server error loading executive report.',
      },
      { status: 500 }
    );
  }
}
