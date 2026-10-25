'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  ArrowRight,
  Award,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  Image as ImageIcon,
  Layers,
  Loader2,
  Lock,
  MessageCircle,
  MousePointerClick,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type {
  MktAdAttributionViewRow,
  MktAdCatalogRow,
} from '@/lib/meta-engine/types';

type ExecPeriodOption = 'today' | 'last_7d' | 'this_month';

const PERIOD_LABELS: Record<ExecPeriodOption, string> = {
  today: 'Today',
  last_7d: 'Last 7 Days',
  this_month: 'This Month',
};

function formatPhp(amount: number | null | undefined, decimals = 0): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return '₱0';
  }
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined || Number.isNaN(num)) {
    return '0';
  }
  return new Intl.NumberFormat('en-PH').format(num);
}

export default function ExecutiveReportPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === 'string' ? params.token : '';

  const [period, setPeriod] = useState<ExecPeriodOption>('this_month');
  const [loading, setLoading] = useState<boolean>(true);
  const [accessDeniedError, setAccessDeniedError] = useState<string | null>(null);
  const [reportLabel, setReportLabel] = useState<string>('Executive Marketing & Revenue Report');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [ads, setAds] = useState<MktAdAttributionViewRow[]>([]);

  /**
   * Loads token-validated executive report data from `/api/exec-report/[token]?period=...`
   * with direct Supabase fallback querying `mkt_share_links` + `v_mkt_ad_attribution`.
   */
  const loadExecutiveReport = useCallback(
    async (selectedPeriod: ExecPeriodOption) => {
      if (!token) {
        setAccessDeniedError('Missing report share token.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setAccessDeniedError(null);

      try {
        const res = await fetch(
          `/api/exec-report/${encodeURIComponent(token)}?period=${encodeURIComponent(selectedPeriod)}`,
          { cache: 'no-store' }
        );

        if (res.status === 403 || res.status === 404) {
          const errPayload = (await res.json().catch(() => ({}))) as { error?: string };
          setAccessDeniedError(
            errPayload.error || 'This executive report link is invalid or inactive.'
          );
          setLoading(false);
          return;
        }

        if (res.ok) {
          const data = (await res.json()) as {
            valid: boolean;
            reportLabel: string;
            lastSyncedAt: string;
            ads: MktAdAttributionViewRow[];
            error?: string;
          };

          if (!data.valid) {
            setAccessDeniedError(data.error || 'Invalid report share link.');
            setLoading(false);
            return;
          }

          setReportLabel(data.reportLabel || 'Executive Marketing & Revenue Report');
          setLastSyncedAt(data.lastSyncedAt || new Date().toISOString());
          setAds(data.ads || []);
          setLoading(false);
          return;
        }

        // Direct Supabase fallback if server route is unavailable
        const supabase = getSupabaseBrowserClient();
        if (!supabase) {
          throw new Error('Unable to connect to reporting service.');
        }

        const { data: shareLink, error: linkErr } = await supabase
          .from('mkt_share_links')
          .select('token, label, is_active')
          .eq('token', token)
          .maybeSingle();

        if (linkErr || !shareLink || !shareLink.is_active) {
          setAccessDeniedError(
            'This executive report link is invalid or has been deactivated.'
          );
          setLoading(false);
          return;
        }

        const [{ data: viewRows, error: viewErr }, { data: catalogRows, error: catErr }] =
          await Promise.all([
            supabase.from('v_mkt_ad_attribution').select('*'),
            supabase.from('mkt_ads_catalog').select('*'),
          ]);

        if (viewErr) throw new Error(viewErr.message);
        if (catErr) throw new Error(catErr.message);

        const catalogMap = new Map<string, MktAdCatalogRow>();
        for (const cat of (catalogRows || []) as MktAdCatalogRow[]) {
          catalogMap.set(cat.ad_id, cat);
        }

        const merged: MktAdAttributionViewRow[] = (viewRows || []).map(
          (row: Record<string, unknown>) => {
            const adId = String(row.ad_id);
            const cat = catalogMap.get(adId);
            const spend = Number(row.total_spend ?? 0);
            const dms = Number(row.total_dms ?? 0);
            const qualified = Number(row.qualified_count ?? 0);
            const won = Number(row.won_count ?? 0);
            const revenue = Number(row.closed_revenue ?? 0);

            return {
              ad_id: adId,
              ad_name: String(cat?.ad_name ?? row.ad_name ?? `Ad ${adId}`),
              adset_id: (cat?.adset_id ?? (row.adset_id as string | null)) || null,
              adset_name: (cat?.adset_name ?? (row.adset_name as string | null)) || null,
              campaign_id: (cat?.campaign_id ?? (row.campaign_id as string | null)) || null,
              campaign_name:
                (cat?.campaign_name ?? (row.campaign_name as string | null)) || null,
              status: String(cat?.status ?? row.status ?? 'UNKNOWN'),
              thumbnail_url:
                (cat?.thumbnail_url ?? (row.thumbnail_url as string | null)) || null,
              creative_body:
                (cat?.creative_body ?? (row.creative_body as string | null)) || null,
              updated_at: String(
                cat?.updated_at ?? row.updated_at ?? new Date().toISOString()
              ),
              total_spend: spend,
              total_impressions: Number(row.total_impressions ?? 0),
              total_link_clicks: Number(row.total_link_clicks ?? 0),
              total_video_3s_views: Number(row.total_video_3s_views ?? 0),
              total_thruplays: Number(row.total_thruplays ?? 0),
              hook_rate_pct: Number(row.hook_rate_pct ?? 0),
              hold_rate_pct: Number(row.hold_rate_pct ?? 0),
              meta_conversations: Number(row.meta_conversations ?? 0),
              attributed_dms: Number(row.attributed_dms ?? 0),
              total_dms: dms,
              qualified_count: qualified,
              stage_qualified_only_count: Number(row.stage_qualified_only_count ?? 0),
              pending_count: Number(row.pending_count ?? 0),
              pending_pipeline_value: Number(row.pending_pipeline_value ?? 0),
              won_count: won,
              lost_count: Number(row.lost_count ?? 0),
              closed_revenue: revenue,
              true_cpa:
                row.true_cpa !== null && row.true_cpa !== undefined
                  ? Number(row.true_cpa)
                  : won > 0
                    ? Number((spend / won).toFixed(2))
                    : null,
              true_roas:
                row.true_roas !== null && row.true_roas !== undefined
                  ? Number(row.true_roas)
                  : spend > 0
                    ? Number((revenue / spend).toFixed(2))
                    : 0,
              chat_close_rate_pct:
                dms > 0 ? Number(((won / dms) * 100).toFixed(2)) : 0,
              is_window_shopper: dms >= 20 && qualified === 0 && won === 0,
            };
          }
        );

        setReportLabel(shareLink.label);
        setLastSyncedAt(new Date().toISOString());
        setAds(merged);
      } catch (err) {
        setAccessDeniedError(
          err instanceof Error ? err.message : 'Unable to load executive report.'
        );
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    loadExecutiveReport(period);
  }, [period, loadExecutiveReport]);

  // Aggregate Executive Metrics, Funnel, Top 3 Winning Ads, and 3-Bullet Plain-English Summary
  const execMetrics = useMemo(() => {
    let totalSpend = 0;
    let totalLinkClicks = 0;
    let totalDms = 0;
    let qualifiedLeads = 0;
    let pendingPipelinePhp = 0;
    let pendingDealsCount = 0;
    let closedRevenuePhp = 0;
    let wonDealsCount = 0;
    let pausedWindowShopperAds = 0;
    let activeWindowShopperAds = 0;

    for (const ad of ads) {
      totalSpend += Number(ad.total_spend || 0);
      totalLinkClicks += Number(ad.total_link_clicks || 0);
      totalDms += Number(ad.total_dms || 0);
      qualifiedLeads += Number(ad.qualified_count || 0);
      pendingPipelinePhp += Number(ad.pending_pipeline_value || 0);
      pendingDealsCount += Number(ad.pending_count || 0);
      closedRevenuePhp += Number(ad.closed_revenue || 0);
      wonDealsCount += Number(ad.won_count || 0);

      const isLowIntentAd =
        (ad.total_dms >= 20 && ad.qualified_count === 0 && ad.won_count === 0) ||
        (ad.status?.toUpperCase() === 'PAUSED' && ad.won_count === 0 && ad.total_dms > 0);

      if (isLowIntentAd) {
        if (ad.status?.toUpperCase() === 'PAUSED') {
          pausedWindowShopperAds += 1;
        } else {
          activeWindowShopperAds += 1;
        }
      }
    }

    // Ensure top-of-funnel link clicks is never visually smaller than DMs if link click tracking lags
    const effectiveLinkClicks = Math.max(totalLinkClicks, totalDms);

    const costPerInquiry = totalDms > 0 ? totalSpend / totalDms : 0;
    const trueRoas = totalSpend > 0 ? closedRevenuePhp / totalSpend : 0;
    const overallCloseRatePct = totalDms > 0 ? (wonDealsCount / totalDms) * 100 : 0;

    // #1 Highest-ROAS Ad Creative (among ads with closed revenue)
    const adsWithRevenue = ads.filter((a) => a.closed_revenue > 0);
    const highestRoasAd =
      adsWithRevenue.length > 0
        ? [...adsWithRevenue].sort((a, b) => {
            if (b.true_roas !== a.true_roas) return b.true_roas - a.true_roas;
            return b.closed_revenue - a.closed_revenue;
          })[0]
        : null;

    // Top 3 Winning Ads ranked by `closed_revenue`
    const top3WinningAds = [...ads]
      .sort((a, b) => {
        if (b.closed_revenue !== a.closed_revenue) {
          return b.closed_revenue - a.closed_revenue;
        }
        if (b.true_roas !== a.true_roas) {
          return b.true_roas - a.true_roas;
        }
        return b.total_dms - a.total_dms;
      })
      .slice(0, 3);

    return {
      totalSpend,
      effectiveLinkClicks,
      totalDms,
      costPerInquiry,
      qualifiedLeads,
      pendingPipelinePhp,
      pendingDealsCount,
      closedRevenuePhp,
      wonDealsCount,
      trueRoas,
      overallCloseRatePct,
      highestRoasAd,
      top3WinningAds,
      pausedWindowShopperAds,
      activeWindowShopperAds,
    };
  }, [ads]);

  // Invalid / Expired Share Link Screen
  if (!loading && accessDeniedError) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-3xl border border-slate-800 bg-slate-900/80 p-8 text-center shadow-2xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/30">
            <Lock className="h-7 w-7" />
          </div>
          <h1 className="mt-5 text-xl font-bold text-white">
            Executive Report Unavailable
          </h1>
          <p className="mt-2 text-sm text-slate-400 leading-relaxed">
            {accessDeniedError}
          </p>
          <p className="mt-6 text-xs text-slate-500">
            Please request an active share link from your marketing or growth team.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-indigo-500 selection:text-white">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* 1. Executive Header */}
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-5 border-b border-slate-800/80 pb-6">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/25">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              Verified Live Attribution Report
              {lastSyncedAt && (
                <span className="text-slate-400 pl-1 border-l border-slate-700/80 inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Last Synced{' '}
                  {new Date(lastSyncedAt).toLocaleString('en-PH', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              {reportLabel}
            </h1>
            <p className="text-sm text-slate-400">
              Direct Click-to-Chat Ad Spend vs. Verified CRM Pipeline &amp; Closed Sales
            </p>
          </div>

          {/* Date Period Selector (`Today`, `Last 7 Days`, `This Month`) */}
          <div className="inline-flex items-center self-start md:self-auto rounded-2xl border border-slate-800 bg-slate-900/90 p-1.5 shadow-inner">
            <Calendar className="h-4 w-4 text-slate-400 ml-2.5 mr-1.5" />
            {(Object.keys(PERIOD_LABELS) as ExecPeriodOption[]).map((key) => {
              const active = period === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPeriod(key)}
                  className={`rounded-xl px-4 py-2 text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                    active
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  {PERIOD_LABELS[key]}
                </button>
              );
            })}
          </div>
        </header>

        {loading ? (
          <div className="rounded-3xl border border-slate-800/80 bg-slate-900/40 py-24 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-indigo-400" />
            <p className="mt-3 text-sm font-medium text-slate-300">
              Compiling executive revenue &amp; chat attribution summary...
            </p>
          </div>
        ) : (
          <>
            {/* 2. Auto-Generated Executive Summary Banner (3 Plain-English Bullets) */}
            <section className="rounded-3xl border border-indigo-500/30 bg-gradient-to-br from-indigo-950/40 via-slate-900/90 to-slate-900/90 p-6 shadow-xl">
              <div className="flex items-center gap-2.5 text-indigo-300 font-semibold text-sm">
                <Sparkles className="h-4 w-4 text-indigo-400" />
                <span>Executive Takeaways ({PERIOD_LABELS[period]})</span>
              </div>

              <ul className="mt-4 space-y-3 text-sm sm:text-base text-slate-200 leading-relaxed">
                {/* Bullet 1: Spend vs. Closed Chat Revenue */}
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    We invested{' '}
                    <strong className="font-bold text-white">
                      {formatPhp(execMetrics.totalSpend)}
                    </strong>{' '}
                    in Meta Click-to-Chat ads, generating{' '}
                    <strong className="font-bold text-emerald-300">
                      {formatPhp(execMetrics.closedRevenuePhp)}
                    </strong>{' '}
                    in verified closed sales (
                    <strong className="font-bold text-emerald-300">
                      {execMetrics.trueRoas.toFixed(2)}x Return on Ad Spend
                    </strong>
                    ) across{' '}
                    <strong className="text-white">
                      {formatNumber(execMetrics.wonDealsCount)} paying customers
                    </strong>
                    {execMetrics.pendingPipelinePhp > 0 && (
                      <>
                        , plus an additional{' '}
                        <strong className="text-amber-300">
                          {formatPhp(execMetrics.pendingPipelinePhp)}
                        </strong>{' '}
                        actively in CRM negotiation.
                      </>
                    )}
                    {execMetrics.pendingPipelinePhp === 0 && '.'}
                  </span>
                </li>

                {/* Bullet 2: #1 Highest-ROAS Ad Creative */}
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-indigo-400 shrink-0 mt-0.5" />
                  <span>
                    {execMetrics.highestRoasAd ? (
                      <>
                        Our #1 highest-ROAS ad creative is{' '}
                        <strong className="font-bold text-white">
                          &ldquo;{execMetrics.highestRoasAd.ad_name}&rdquo;
                        </strong>
                        , delivering{' '}
                        <strong className="font-bold text-emerald-300">
                          {execMetrics.highestRoasAd.true_roas.toFixed(2)}x ROAS
                        </strong>{' '}
                        (
                        <strong className="text-white">
                          {formatPhp(execMetrics.highestRoasAd.closed_revenue)}
                        </strong>{' '}
                        closed from{' '}
                        <strong className="text-slate-300">
                          {formatPhp(execMetrics.highestRoasAd.total_spend)}
                        </strong>{' '}
                        spend, converting{' '}
                        <strong className="text-indigo-300">
                          {execMetrics.highestRoasAd.chat_close_rate_pct.toFixed(1)}%
                        </strong>{' '}
                        of its chat inquiries).
                      </>
                    ) : (
                      <>
                        Chat inquiries are actively entering the CRM pipeline (
                        <strong className="text-white">
                          {formatNumber(execMetrics.totalDms)} DMs started
                        </strong>
                        ); closed revenue rankings will populate as agents mark deals Won.
                      </>
                    )}
                  </span>
                </li>

                {/* Bullet 3: Window-Shopper Ads Paused / Budget Efficiency */}
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    {execMetrics.pausedWindowShopperAds > 0 ? (
                      <>
                        Budget protection is active:{' '}
                        <strong className="font-bold text-white">
                          {execMetrics.pausedWindowShopperAds} window-shopper{' '}
                          {execMetrics.pausedWindowShopperAds === 1 ? 'ad is' : 'ads are'} currently paused
                        </strong>{' '}
                        after generating chat volume without qualified buyers, reallocating budget to our top-closing creatives.
                      </>
                    ) : execMetrics.activeWindowShopperAds > 0 ? (
                      <>
                        Attention needed:{' '}
                        <strong className="font-bold text-rose-300">
                          {execMetrics.activeWindowShopperAds} high-chat window-shopper{' '}
                          {execMetrics.activeWindowShopperAds === 1 ? 'ad has' : 'ads have'}
                        </strong>{' '}
                        exceeded 20 DMs with 0 qualified deals and should be reviewed by the media buyer.
                      </>
                    ) : (
                      <>
                        Zero budget waste detected:{' '}
                        <strong className="font-bold text-white">
                          0 active window-shopper traps
                        </strong>{' '}
                        in this period, with an overall{' '}
                        <strong className="text-emerald-300">
                          {execMetrics.overallCloseRatePct.toFixed(1)}% chat-to-customer close rate
                        </strong>
                        .
                      </>
                    )}
                  </span>
                </li>
              </ul>
            </section>

            {/* 3. 4 Bold "Money" KPI Cards */}
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
              {/* KPI 1: Total Ad Spend */}
              <div className="rounded-3xl border border-slate-800/90 bg-slate-900/75 p-6 shadow-lg">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Total Ad Spend
                  </span>
                  <span className="rounded-xl bg-slate-800 p-2 text-slate-300">
                    <DollarSign className="h-5 w-5" />
                  </span>
                </div>
                <p className="mt-4 text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
                  {formatPhp(execMetrics.totalSpend)}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  Total Meta investment ({PERIOD_LABELS[period]})
                </p>
              </div>

              {/* KPI 2: Chat Inquiries Started */}
              <div className="rounded-3xl border border-slate-800/90 bg-slate-900/75 p-6 shadow-lg">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Chat Inquiries Started
                  </span>
                  <span className="rounded-xl bg-sky-500/15 p-2 text-sky-400">
                    <MessageCircle className="h-5 w-5" />
                  </span>
                </div>
                <p className="mt-4 text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
                  {formatNumber(execMetrics.totalDms)}{' '}
                  <span className="text-lg font-bold text-sky-400">DMs</span>
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  <strong className="text-sky-300">
                    {execMetrics.totalDms > 0
                      ? `${formatPhp(execMetrics.costPerInquiry)} / inquiry`
                      : '₱0 / inquiry'}
                  </strong>{' '}
                  across Messenger &amp; IG
                </p>
              </div>

              {/* KPI 3: In-Progress Pipeline */}
              <div className="rounded-3xl border border-slate-800/90 bg-slate-900/75 p-6 shadow-lg">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    In-Progress Pipeline
                  </span>
                  <span className="rounded-xl bg-amber-500/15 p-2 text-amber-400">
                    <Layers className="h-5 w-5" />
                  </span>
                </div>
                <p className="mt-4 text-3xl sm:text-4xl font-extrabold tracking-tight text-amber-300">
                  {formatPhp(execMetrics.pendingPipelinePhp)}
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  <strong className="text-slate-200">
                    {formatNumber(execMetrics.pendingDealsCount)} pending deals
                  </strong>{' '}
                  in CRM
                </p>
              </div>

              {/* KPI 4: Closed Revenue & True ROAS */}
              <div className="rounded-3xl border border-emerald-500/40 bg-gradient-to-br from-emerald-950/60 via-slate-900/90 to-slate-900 p-6 shadow-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
                    Closed Revenue &amp; ROAS
                  </span>
                  <span className="rounded-xl bg-emerald-500/20 p-2 text-emerald-300">
                    <TrendingUp className="h-5 w-5" />
                  </span>
                </div>
                <p className="mt-4 text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
                  {formatPhp(execMetrics.closedRevenuePhp)}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="inline-flex items-center rounded-lg bg-emerald-500/20 px-2.5 py-0.5 text-xs font-bold text-emerald-300 ring-1 ring-inset ring-emerald-500/40">
                    {execMetrics.trueRoas.toFixed(2)}x Return on Ad Spend
                  </span>
                </div>
              </div>
            </section>

            {/* 4. Visual Chat-to-Cash Conversion Funnel */}
            <section className="rounded-3xl border border-slate-800/90 bg-slate-900/70 p-6 sm:p-8 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-indigo-400" />
                    Chat-to-Cash Conversion Funnel
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-400">
                    How ad clicks progress into real conversations, qualified opportunities, and closed customers
                  </p>
                </div>
                <span className="inline-flex items-center self-start sm:self-auto rounded-xl bg-slate-800/90 px-3 py-1.5 text-xs font-semibold text-slate-300">
                  Overall DM-to-Close Rate:{' '}
                  <strong className="ml-1 text-emerald-400">
                    {execMetrics.overallCloseRatePct.toFixed(1)}%
                  </strong>
                </span>
              </div>

              {(() => {
                const clicks = execMetrics.effectiveLinkClicks;
                const dms = execMetrics.totalDms;
                const qualified = execMetrics.qualifiedLeads;
                const won = execMetrics.wonDealsCount;

                const maxBase = Math.max(clicks, dms, 1);

                const stages = [
                  {
                    label: 'Ad Link Clicks',
                    count: clicks,
                    subtext: 'Clicked ad to message',
                    barPct: Math.max((clicks / maxBase) * 100, 12),
                    conversionFromPrev: null as string | null,
                    colorClass: 'from-slate-500 to-slate-400',
                    badgeClass: 'bg-slate-800 text-slate-200',
                    icon: MousePointerClick,
                  },
                  {
                    label: 'Messenger / IG DMs',
                    count: dms,
                    subtext: `${formatPhp(execMetrics.costPerInquiry)} per inquiry`,
                    barPct: Math.max((dms / maxBase) * 100, 10),
                    conversionFromPrev:
                      clicks > 0 ? `${((dms / clicks) * 100).toFixed(1)}% started chat` : '—',
                    colorClass: 'from-sky-500 to-cyan-400',
                    badgeClass: 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30',
                    icon: MessageCircle,
                  },
                  {
                    label: 'CRM Qualified Leads',
                    count: qualified,
                    subtext: 'Verified serious buyers',
                    barPct: Math.max((qualified / maxBase) * 100, 8),
                    conversionFromPrev:
                      dms > 0 ? `${((qualified / dms) * 100).toFixed(1)}% of DMs qualified` : '—',
                    colorClass: 'from-indigo-500 to-violet-400',
                    badgeClass: 'bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30',
                    icon: ShieldCheck,
                  },
                  {
                    label: 'Closed Won Deals',
                    count: won,
                    subtext: `${formatPhp(execMetrics.closedRevenuePhp)} revenue`,
                    barPct: Math.max((won / maxBase) * 100, 6),
                    conversionFromPrev:
                      qualified > 0
                        ? `${((won / qualified) * 100).toFixed(1)}% of qualified won`
                        : dms > 0
                          ? `${((won / dms) * 100).toFixed(1)}% of DMs won`
                          : '—',
                    colorClass: 'from-emerald-500 to-teal-400',
                    badgeClass: 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40',
                    icon: Award,
                  },
                ];

                return (
                  <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                    {stages.map((stage, idx) => {
                      const IconComponent = stage.icon;
                      return (
                        <div
                          key={stage.label}
                          className="relative flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-950/70 p-5"
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                                <IconComponent className="h-4 w-4 text-slate-400" />
                                {stage.label}
                              </span>
                              <span className="text-[11px] font-mono text-slate-500">
                                Step {idx + 1}
                              </span>
                            </div>

                            <p className="mt-3 text-2xl sm:text-3xl font-extrabold text-white">
                              {formatNumber(stage.count)}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-400">{stage.subtext}</p>
                          </div>

                          {/* Horizontal Progress Bar */}
                          <div className="mt-5 space-y-2">
                            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800/90">
                              <div
                                className={`h-full rounded-full bg-gradient-to-r ${stage.colorClass} transition-all duration-500`}
                                style={{ width: `${Math.min(stage.barPct, 100)}%` }}
                              />
                            </div>

                            <div className="flex items-center justify-between text-[11px]">
                              {stage.conversionFromPrev ? (
                                <span
                                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-semibold ${stage.badgeClass}`}
                                >
                                  <ArrowRight className="h-3 w-3" />
                                  {stage.conversionFromPrev}
                                </span>
                              ) : (
                                <span className="text-slate-500">Top of Funnel (100%)</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </section>

            {/* 5. Top 3 Winning Ads Showcase */}
            <section className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Trophy className="h-5 w-5 text-amber-400" />
                    Top 3 Winning Ads by Closed Revenue
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-400">
                    Creatives bringing in the highest verified customer revenue from Messenger &amp; Instagram chat
                  </p>
                </div>
              </div>

              {execMetrics.top3WinningAds.length === 0 ? (
                <div className="rounded-3xl border border-slate-800 bg-slate-900/50 p-12 text-center text-sm text-slate-400">
                  No ad performance records available for this period yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  {execMetrics.top3WinningAds.map((ad, index) => {
                    const rank = index + 1;
                    const rankStyles =
                      rank === 1
                        ? 'border-amber-500/40 bg-gradient-to-b from-amber-950/25 via-slate-900/90 to-slate-900'
                        : rank === 2
                          ? 'border-slate-700/90 bg-slate-900/80'
                          : 'border-slate-800/90 bg-slate-900/75';

                    return (
                      <div
                        key={ad.ad_id}
                        className={`flex flex-col justify-between rounded-3xl border p-6 shadow-xl ${rankStyles}`}
                      >
                        <div>
                          {/* Top Row: Rank Badge + True ROAS Badge */}
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
                                rank === 1
                                  ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                                  : 'bg-slate-800 text-slate-300'
                              }`}
                            >
                              <Trophy className="h-3.5 w-3.5" />#{rank} Winning Ad
                            </span>

                            <span className="inline-flex items-center rounded-xl bg-emerald-500/20 px-3 py-1 font-mono text-xs font-extrabold text-emerald-300 ring-1 ring-inset ring-emerald-500/40">
                              {ad.true_roas.toFixed(2)}x ROAS
                            </span>
                          </div>

                          {/* Creative Thumbnail + Name */}
                          <div className="mt-4 flex items-center gap-3.5">
                            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-800 flex items-center justify-center">
                              {ad.thumbnail_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={ad.thumbnail_url}
                                  alt={ad.ad_name}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <ImageIcon className="h-6 w-6 text-slate-500" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <h3
                                className="text-base font-bold text-white truncate"
                                title={ad.ad_name}
                              >
                                {ad.ad_name}
                              </h3>
                              <p className="text-xs text-slate-400 truncate mt-0.5">
                                {ad.campaign_name || 'Meta Click-to-Chat Campaign'}
                              </p>
                            </div>
                          </div>

                          {/* Spend vs. Closed Revenue Comparison Box */}
                          <div className="mt-5 grid grid-cols-2 gap-3 rounded-2xl border border-slate-800/90 bg-slate-950/70 p-4">
                            <div>
                              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                                Ad Spend
                              </span>
                              <p className="mt-1 text-lg font-bold text-slate-200 font-mono">
                                {formatPhp(ad.total_spend)}
                              </p>
                            </div>
                            <div className="border-l border-slate-800 pl-3">
                              <span className="text-[11px] font-medium uppercase tracking-wider text-emerald-400">
                                Closed Revenue
                              </span>
                              <p className="mt-1 text-lg font-extrabold text-emerald-300 font-mono">
                                {formatPhp(ad.closed_revenue)}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Chat Close Rate % Plain-English Callout */}
                        <div className="mt-5 pt-4 border-t border-slate-800/80">
                          <div className="flex items-center justify-between text-xs mb-1.5">
                            <span className="font-semibold text-slate-300">
                              Chat Close Rate
                            </span>
                            <span className="font-mono font-bold text-indigo-300">
                              {ad.chat_close_rate_pct.toFixed(1)}% ({ad.won_count}/
                              {ad.total_dms} DMs)
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 leading-relaxed">
                            <strong className="text-white">
                              {ad.chat_close_rate_pct.toFixed(1)}% of DMs
                            </strong>{' '}
                            from this ad turned into paying customers.
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

