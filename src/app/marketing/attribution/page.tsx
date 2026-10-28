'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownUp,
  Calendar,
  CheckCircle2,
  DollarSign,
  ExternalLink,
  Filter,
  Flame,
  Image as ImageIcon,
  Layers,
  Loader2,
  MessageSquare,
  PlayCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Target,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import PageSwitcherBar from '@/components/marketing/PageSwitcherBar';
import type {
  MktAdAttributionViewRow,
  MktAdCatalogRow,
  MktAdToggleStatus,
} from '@/lib/meta-engine/types';

type DateRangeOption =
  | 'today'
  | 'yesterday'
  | 'last_7d'
  | 'last_30d'
  | 'all_time';

type StatusFilterOption = 'ALL' | 'ACTIVE' | 'PAUSED';

type SortField =
  | 'total_spend'
  | 'total_dms'
  | 'qualified_count'
  | 'pending_pipeline_value'
  | 'closed_revenue'
  | 'true_cpa'
  | 'true_roas';

interface ToastNotification {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  message: string;
}

const DATE_RANGE_LABELS: Record<DateRangeOption, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7d: 'Last 7 Days',
  last_30d: 'Last 30 Days',
  all_time: 'All Time',
};

function formatPhp(amount: number | null | undefined, decimals = 2): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return '—';
  }
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

function formatCompactPhp(amount: number): string {
  if (Math.abs(amount) >= 1_000_000) {
    return `₱${(amount / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(amount) >= 100_000) {
    return `₱${(amount / 1_000).toFixed(1)}K`;
  }
  return formatPhp(amount, 0);
}

function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined || Number.isNaN(num)) {
    return '0';
  }
  return new Intl.NumberFormat('en-PH').format(num);
}

export default function MarketerAttributionPage() {
  const [ads, setAds] = useState<MktAdAttributionViewRow[]>([]);
  const [organicSummary, setOrganicSummary] = useState<{
    organicDms: number;
    organicQualified: number;
    organicPendingPhp: number;
    organicWonPhp: number;
    organicWonCount: number;
    commentShieldRepliesCount: number;
  }>({
    organicDms: 0,
    organicQualified: 0,
    organicPendingPhp: 0,
    organicWonPhp: 0,
    organicWonCount: 0,
    commentShieldRepliesCount: 0,
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [syncingMeta, setSyncingMeta] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [generatingShareLink, setGeneratingShareLink] = useState<boolean>(false);
  const [generatedShareUrl, setGeneratedShareUrl] = useState<string | null>(null);

  // Filters & Sorting
  const [dateRange, setDateRange] = useState<DateRangeOption>('last_30d');
  const [statusFilter, setStatusFilter] = useState<StatusFilterOption>('ALL');
  const [campaignFilter, setCampaignFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [onlyWindowShoppers, setOnlyWindowShoppers] = useState<boolean>(false);
  const [sortField, setSortField] = useState<SortField>('total_spend');
  const [sortDesc, setSortDesc] = useState<boolean>(true);

  // Optimistic toggle tracking per ad_id
  const [togglingAdIds, setTogglingAdIds] = useState<Record<string, boolean>>({});
  const [toasts, setToasts] = useState<ToastNotification[]>([]);

  const pushToast = useCallback(
    (type: ToastNotification['type'], title: string, message: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev, { id, type, title, message }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 5000);
    },
    []
  );

  /**
   * Fetches attribution data via `/api/marketing/attribution?range=...`
   * with direct Supabase fallback querying `v_mkt_ad_attribution` joined with `mkt_ads_catalog`.
   */
  const fetchAttributionData = useCallback(
    async (selectedRange: DateRangeOption, silent = false) => {
      if (!silent) {
        setLoading(true);
      }

      try {
        const res = await fetch(
          `/api/marketing/attribution?range=${encodeURIComponent(selectedRange)}`,
          { cache: 'no-store' }
        );

        if (res.ok) {
          const payload = (await res.json()) as {
            ads?: MktAdAttributionViewRow[];
            organicSummary?: {
              organicDms: number;
              organicQualified: number;
              organicPendingPhp: number;
              organicWonPhp: number;
              organicWonCount: number;
              commentShieldRepliesCount: number;
            };
            fetchedAt?: string;
          };
          if (payload.organicSummary) {
            setOrganicSummary(payload.organicSummary);
          }
          if (Array.isArray(payload.ads)) {
            setAds(payload.ads);
            setLastSyncedAt(payload.fetchedAt || new Date().toISOString());
            setLoading(false);
            return;
          }
        }

        // Direct Supabase browser client fallback: query `v_mkt_ad_attribution` + `mkt_ads_catalog`
        const supabase = getSupabaseBrowserClient();
        if (supabase) {
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

          setAds(merged);
          setLastSyncedAt(new Date().toISOString());
        }
      } catch (err) {
        pushToast(
          'error',
          'Failed loading attribution data',
          err instanceof Error ? err.message : 'Unable to query Supabase view.'
        );
      } finally {
        setLoading(false);
      }
    },
    [pushToast]
  );

  useEffect(() => {
    fetchAttributionData(dateRange);
  }, [dateRange, fetchAttributionData]);

  /**
   * Triggers `POST /api/cron/sync-meta` to pull fresh catalog & daily insights from Meta API
   */
  const handleSyncMetaNow = async () => {
    if (syncingMeta) return;
    setSyncingMeta(true);

    try {
      const metaPresetMap: Record<DateRangeOption, string> = {
        today: 'today',
        yesterday: 'yesterday',
        last_7d: 'last_7d',
        last_30d: 'last_30d',
        all_time: 'last_30d',
      };

      const response = await fetch('/api/cron/sync-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datePreset: metaPresetMap[dateRange] }),
      });

      const result = (await response.json()) as {
        success?: boolean;
        catalogSynced?: number;
        dailyMetricRowsSynced?: number;
        error?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Meta Insights sync failed.');
      }

      pushToast(
        'success',
        'Meta Sync Complete',
        `Synced ${result.catalogSynced ?? 0} catalog ads & ${result.dailyMetricRowsSynced ?? 0} daily metric rows.`
      );

      await fetchAttributionData(dateRange, true);
    } catch (error) {
      pushToast(
        'error',
        'Meta Sync Failed',
        error instanceof Error ? error.message : 'Could not reach Meta Marketing API.'
      );
    } finally {
      setSyncingMeta(false);
    }
  };

  /**
   * Generates a read-only Executive Report share link in `mkt_share_links`
   */
  const handleGenerateShareLink = async () => {
    if (generatingShareLink) return;
    setGeneratingShareLink(true);
    try {
      const res = await fetch('/api/marketing/attribution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'CREATE_SHARE_LINK',
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        shareUrl?: string;
        error?: string;
      };
      if (!res.ok || !data.shareUrl) {
        throw new Error(data.error || 'Failed generating share link.');
      }

      const fullUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}${data.shareUrl}`
          : data.shareUrl;
      setGeneratedShareUrl(fullUrl);
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(fullUrl).catch(() => {});
      }
      pushToast(
        'success',
        'Executive Share Link Ready!',
        `Copied to clipboard: ${fullUrl}`
      );
    } catch (err) {
      pushToast(
        'error',
        'Share Link Failed',
        err instanceof Error ? err.message : 'Unable to generate share link.'
      );
    } finally {
      setGeneratingShareLink(false);
    }
  };

  /**
   * Optimistically toggles `ACTIVE` / `PAUSED` via `POST /api/marketing/toggle-ad`
   */
  const handleToggleAdStatus = async (ad: MktAdAttributionViewRow) => {
    const currentStatus = ad.status.toUpperCase();
    const nextStatus: MktAdToggleStatus =
      currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';

    if (togglingAdIds[ad.ad_id]) return;

    // Optimistic update
    setTogglingAdIds((prev) => ({ ...prev, [ad.ad_id]: true }));
    setAds((prev) =>
      prev.map((item) =>
        item.ad_id === ad.ad_id ? { ...item, status: nextStatus } : item
      )
    );

    try {
      const response = await fetch('/api/marketing/toggle-ad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adId: ad.ad_id,
          status: nextStatus,
        }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        status?: MktAdToggleStatus;
        error?: string;
      };

      if (!response.ok || !data.success) {
        throw new Error(data.error || `Failed setting status to ${nextStatus}`);
      }

      pushToast(
        'success',
        `Ad ${nextStatus === 'ACTIVE' ? 'Activated' : 'Paused'}`,
        `"${ad.ad_name}" is now ${nextStatus} in Meta Ads Manager.`
      );
    } catch (error) {
      // Revert optimistic update on failure
      setAds((prev) =>
        prev.map((item) =>
          item.ad_id === ad.ad_id ? { ...item, status: currentStatus } : item
        )
      );
      pushToast(
        'error',
        'Ad Status Update Failed',
        error instanceof Error ? error.message : 'Failed updating ad in Meta.'
      );
    } finally {
      setTogglingAdIds((prev) => {
        const next = { ...prev };
        delete next[ad.ad_id];
        return next;
      });
    }
  };

  // Distinct Campaign Names for Campaign Filter
  const campaignOptions = useMemo(() => {
    const set = new Set<string>();
    for (const ad of ads) {
      if (ad.campaign_name?.trim()) {
        set.add(ad.campaign_name.trim());
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [ads]);

  // Filtered and Sorted Ads
  const filteredAds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const list = ads.filter((ad) => {
      const normalizedStatus = ad.status?.toUpperCase() || 'UNKNOWN';
      if (statusFilter === 'ACTIVE' && normalizedStatus !== 'ACTIVE') {
        return false;
      }
      if (statusFilter === 'PAUSED' && normalizedStatus !== 'PAUSED') {
        return false;
      }

      if (campaignFilter !== 'ALL' && ad.campaign_name !== campaignFilter) {
        return false;
      }

      const isWindowShopper =
        ad.total_dms >= 20 && ad.qualified_count === 0 && ad.won_count === 0;
      if (onlyWindowShoppers && !isWindowShopper) {
        return false;
      }

      if (q) {
        const matchesName = ad.ad_name?.toLowerCase().includes(q);
        const matchesId = ad.ad_id?.toLowerCase().includes(q);
        const matchesCampaign = ad.campaign_name?.toLowerCase().includes(q);
        const matchesAdset = ad.adset_name?.toLowerCase().includes(q);
        if (!matchesName && !matchesId && !matchesCampaign && !matchesAdset) {
          return false;
        }
      }

      return true;
    });

    list.sort((a, b) => {
      const valA = a[sortField] ?? -1;
      const valB = b[sortField] ?? -1;
      return sortDesc ? Number(valB) - Number(valA) : Number(valA) - Number(valB);
    });

    return list;
  }, [ads, statusFilter, campaignFilter, onlyWindowShoppers, searchQuery, sortField, sortDesc]);

  // Summary KPI Calculations across filtered ads
  const summaryKpis = useMemo(() => {
    let totalSpend = 0;
    let totalDms = 0;
    let totalImpressions = 0;
    let totalVideo3s = 0;
    let totalThruplays = 0;
    let hookRateSum = 0;
    let holdRateSum = 0;
    let adsWithHookMetrics = 0;
    let qualifiedLeads = 0;
    let pendingPipelinePhp = 0;
    let pendingCount = 0;
    let closedRevenuePhp = 0;
    let wonDealsCount = 0;
    let windowShopperCount = 0;
    let topScalerCount = 0;

    for (const ad of filteredAds) {
      totalSpend += Number(ad.total_spend || 0);
      totalDms += Number(ad.total_dms || 0);
      totalImpressions += Number(ad.total_impressions || 0);
      totalVideo3s += Number(ad.total_video_3s_views || 0);
      totalThruplays += Number(ad.total_thruplays || 0);

      if (ad.hook_rate_pct > 0 || ad.hold_rate_pct > 0) {
        hookRateSum += Number(ad.hook_rate_pct || 0);
        holdRateSum += Number(ad.hold_rate_pct || 0);
        adsWithHookMetrics += 1;
      }

      qualifiedLeads += Number(ad.qualified_count || 0);
      pendingPipelinePhp += Number(ad.pending_pipeline_value || 0);
      pendingCount += Number(ad.pending_count || 0);
      closedRevenuePhp += Number(ad.closed_revenue || 0);
      wonDealsCount += Number(ad.won_count || 0);

      if (ad.total_dms >= 20 && ad.qualified_count === 0 && ad.won_count === 0) {
        windowShopperCount += 1;
      }
      if (ad.true_roas >= 3.5) {
        topScalerCount += 1;
      }
    }

    const avgCostPerDm = totalDms > 0 ? totalSpend / totalDms : 0;

    const avgHookRate =
      totalImpressions > 0
        ? (totalVideo3s / totalImpressions) * 100
        : adsWithHookMetrics > 0
          ? hookRateSum / adsWithHookMetrics
          : 0;

    const avgHoldRate =
      totalVideo3s > 0
        ? (totalThruplays / totalVideo3s) * 100
        : adsWithHookMetrics > 0
          ? holdRateSum / adsWithHookMetrics
          : 0;

    const qualificationRatePct =
      totalDms > 0 ? (qualifiedLeads / totalDms) * 100 : 0;

    const blendedRoas = totalSpend > 0 ? closedRevenuePhp / totalSpend : 0;

    return {
      totalSpend,
      totalDms,
      avgCostPerDm,
      avgHookRate,
      avgHoldRate,
      qualifiedLeads,
      qualificationRatePct,
      pendingPipelinePhp,
      pendingCount,
      closedRevenuePhp,
      wonDealsCount,
      blendedRoas,
      windowShopperCount,
      topScalerCount,
    };
  }, [filteredAds]);

  const handleSortClick = (field: SortField) => {
    if (sortField === field) {
      setSortDesc((prev) => !prev);
    } else {
      setSortField(field);
      setSortDesc(true);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Toast Notifications Overlay */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-md w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-4 shadow-2xl backdrop-blur-md transition-all ${
              toast.type === 'success'
                ? 'border-emerald-500/40 bg-emerald-950/90 text-emerald-100'
                : toast.type === 'error'
                  ? 'border-rose-500/40 bg-rose-950/90 text-rose-100'
                  : 'border-slate-700 bg-slate-900/90 text-slate-100'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">{toast.title}</p>
              <p className="text-xs opacity-90 mt-0.5 break-words">{toast.message}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Main Container */}
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* 1. Top Header & Controls */}
        <header className="flex flex-col gap-4 rounded-2xl border border-slate-800/80 bg-slate-900/60 p-5 shadow-lg backdrop-blur">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-400 ring-1 ring-inset ring-indigo-500/20">
                  <Activity className="h-3.5 w-3.5" />
                  Meta CAPI + CRM Bridge Active
                </span>
                {lastSyncedAt && (
                  <span className="text-xs text-slate-400">
                    Updated{' '}
                    {new Date(lastSyncedAt).toLocaleTimeString('en-PH', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Marketer Attribution Command Center
              </h1>
              <p className="text-sm text-slate-400">
                Full-funnel Click-to-Messenger &amp; Instagram DM ad attribution bridged to real-time CRM revenue and Meta Conversions API.
              </p>
            </div>

            {/* Right Action Buttons */}
            <div className="flex flex-wrap items-center gap-3">
              <PageSwitcherBar
                onPageChanged={() => fetchAttributionData(dateRange)}
              />

              {/* Date Range Segmented Pill Bar */}
              <div className="inline-flex items-center rounded-xl border border-slate-800 bg-slate-950/90 p-1">
                <Calendar className="h-4 w-4 text-slate-400 ml-2.5 mr-1.5 hidden sm:inline" />
                {(Object.keys(DATE_RANGE_LABELS) as DateRangeOption[]).map((key) => {
                  const active = dateRange === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setDateRange(key)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                        active
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                      }`}
                    >
                      {DATE_RANGE_LABELS[key]}
                    </button>
                  );
                })}
              </div>

              {/* Navigate to Omnichannel Inbox */}
              <a
                href="/marketing/inbox"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/90 hover:border-sky-500/60 hover:text-white px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-slate-200 transition-all"
              >
                <MessageSquare className="h-4 w-4 text-sky-400" />
                Omnichannel Inbox
              </a>

              {/* Navigate to Organic Post Studio */}
              <a
                href="/marketing/posts"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/90 hover:border-violet-500/60 hover:text-white px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-slate-200 transition-all"
              >
                <ImageIcon className="h-4 w-4 text-violet-400" />
                Post Studio &amp; Calendar
              </a>

              {/* Navigate to 60-Second Bulk Ad Launcher Studio */}
              <a
                href="/marketing/launcher"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/90 hover:border-emerald-500/60 hover:text-white px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-slate-200 transition-all"
              >
                <PlayCircle className="h-4 w-4 text-emerald-400" />
                Bulk Ad Launcher
              </a>

              {/* Navigate to 24/7 Ad Watchdog & Comment Shield */}
              <a
                href="/marketing/watchdog"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/90 hover:border-indigo-500/60 hover:text-white px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-slate-200 transition-all"
              >
                <ShieldCheck className="h-4 w-4 text-indigo-400" />
                Ad Watchdog &amp; Comment Shield
              </a>

              {/* Generate Shareable Executive Report Link */}
              <button
                type="button"
                onClick={handleGenerateShareLink}
                disabled={generatingShareLink}
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 px-3.5 py-2.5 text-xs sm:text-sm font-semibold text-emerald-300 transition-all cursor-pointer"
              >
                <ExternalLink className="h-4 w-4" />
                {generatingShareLink ? 'Creating Link...' : '🔗 Share Exec Report'}
              </button>

              {/* Manual "Sync Meta Now" Button */}
              <button
                type="button"
                onClick={handleSyncMetaNow}
                disabled={syncingMeta}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 transition-all cursor-pointer"
              >
                <RefreshCw
                  className={`h-4 w-4 ${syncingMeta ? 'animate-spin' : ''}`}
                />
                {syncingMeta ? 'Syncing Meta API...' : 'Sync Meta Now'}
              </button>
            </div>
          </div>

          {/* Secondary Filter Bar: Search, Campaign Filter, Status Filter, Diagnostic Quick Filters */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-3 border-t border-slate-800/80">
            <div className="flex flex-wrap items-center gap-3 flex-1">
              {/* Search Box */}
              <div className="relative min-w-[240px] flex-1 max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type="search"
                  name="attribution_ad_search"
                  autoComplete="off"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search ad name, ID, or campaign..."
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/80 pl-9 pr-4 py-2 text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              {/* Campaign Dropdown */}
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-slate-400 hidden sm:inline" />
                <select
                  value={campaignFilter}
                  onChange={(e) => setCampaignFilter(e.target.value)}
                  className="rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 text-xs sm:text-sm text-slate-200 focus:border-indigo-500 focus:outline-none"
                >
                  <option value="ALL">All Campaigns ({campaignOptions.length})</option>
                  {campaignOptions.map((camp) => (
                    <option key={camp} value={camp}>
                      {camp}
                    </option>
                  ))}
                </select>
              </div>

              {/* Ad Status Filter (All | Active Only | Paused) */}
              <div className="inline-flex rounded-xl border border-slate-800 bg-slate-950/80 p-1">
                {(
                  [
                    { id: 'ALL', label: 'All' },
                    { id: 'ACTIVE', label: 'Active Only' },
                    { id: 'PAUSED', label: 'Paused' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStatusFilter(tab.id)}
                    className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                      statusFilter === tab.id
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Diagnostic Pill Filter */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOnlyWindowShoppers((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                  onlyWindowShoppers
                    ? 'border-rose-500/60 bg-rose-500/20 text-rose-200'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:text-slate-200'
                }`}
              >
                <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
                Window Shopper Traps ({summaryKpis.windowShopperCount})
              </button>
            </div>
          </div>
        </header>

        {/* 2. Summary KPI Strip (6 Cards) */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {/* Card 1: Total Ad Spend (₱) */}
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-4 shadow-md">
            <div className="flex items-center justify-between text-xs font-medium text-slate-400">
              <span>Total Ad Spend (₱)</span>
              <span className="rounded-lg bg-slate-800 p-1.5 text-slate-300">
                <DollarSign className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-2.5 text-2xl font-bold tracking-tight text-white">
              {formatPhp(summaryKpis.totalSpend)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Across <span className="font-semibold text-slate-200">{filteredAds.length}</span> tracked ads
            </p>
          </div>

          {/* Card 2: Total DMs Started (with Avg Cost per DM) */}
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-4 shadow-md">
            <div className="flex items-center justify-between text-xs font-medium text-slate-400">
              <span>Total DMs Started</span>
              <span className="rounded-lg bg-sky-500/10 p-1.5 text-sky-400">
                <MessageSquare className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-2.5 text-2xl font-bold tracking-tight text-white">
              {formatNumber(summaryKpis.totalDms)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Avg Cost/DM:{' '}
              <span className="font-semibold text-sky-300">
                {summaryKpis.totalDms > 0
                  ? formatPhp(summaryKpis.avgCostPerDm)
                  : '—'}
              </span>
            </p>
          </div>

          {/* Card 3: Avg Hook Rate % & Hold Rate % */}
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-4 shadow-md">
            <div className="flex items-center justify-between text-xs font-medium text-slate-400">
              <span>Avg Hook &amp; Hold Rate</span>
              <span className="rounded-lg bg-violet-500/10 p-1.5 text-violet-400">
                <PlayCircle className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2.5 flex items-baseline gap-3">
              <div>
                <span className="text-2xl font-bold text-white">
                  {summaryKpis.avgHookRate.toFixed(1)}%
                </span>
                <span className="ml-1 text-[11px] text-slate-400">Hook</span>
              </div>
              <span className="text-slate-600">/</span>
              <div>
                <span className="text-lg font-semibold text-violet-300">
                  {summaryKpis.avgHoldRate.toFixed(1)}%
                </span>
                <span className="ml-1 text-[11px] text-slate-400">Hold</span>
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              3s Views / Impressions &amp; ThruPlays
            </p>
          </div>

          {/* Card 4: CRM Qualified Leads (with Qualification Rate %) */}
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-4 shadow-md">
            <div className="flex items-center justify-between text-xs font-medium text-slate-400">
              <span>CRM Qualified Leads</span>
              <span className="rounded-lg bg-indigo-500/10 p-1.5 text-indigo-400">
                <ShieldCheck className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-2.5 text-2xl font-bold tracking-tight text-white">
              {formatNumber(summaryKpis.qualifiedLeads)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Qualification Rate:{' '}
              <span className="font-semibold text-indigo-300">
                {summaryKpis.qualificationRatePct.toFixed(1)}%
              </span>
            </p>
          </div>

          {/* Card 5: Active Pipeline (Pending ₱) */}
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-4 shadow-md">
            <div className="flex items-center justify-between text-xs font-medium text-slate-400">
              <span>Active Pipeline (Pending ₱)</span>
              <span className="rounded-lg bg-amber-500/10 p-1.5 text-amber-400">
                <Layers className="h-4 w-4" />
              </span>
            </div>
            <p className="mt-2.5 text-2xl font-bold tracking-tight text-amber-300">
              {formatPhp(summaryKpis.pendingPipelinePhp)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Across{' '}
              <span className="font-semibold text-slate-200">
                {formatNumber(summaryKpis.pendingCount)}
              </span>{' '}
              pending deals
            </p>
          </div>

          {/* Card 6: Closed Won Revenue (₱) & True ROAS (x) */}
          <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/50 via-slate-900/80 to-slate-900/90 p-4 shadow-md">
            <div className="flex items-center justify-between text-xs font-medium text-emerald-300">
              <span>Closed Won &amp; True ROAS</span>
              <span className="rounded-lg bg-emerald-500/20 p-1.5 text-emerald-300">
                <TrendingUp className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2.5 flex items-baseline justify-between gap-2">
              <p className="text-2xl font-bold tracking-tight text-white truncate">
                {formatCompactPhp(summaryKpis.closedRevenuePhp)}
              </p>
              <span className="inline-flex items-center rounded-lg bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
                {summaryKpis.blendedRoas.toFixed(2)}x ROAS
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-300">
              <span className="font-semibold text-emerald-300">
                {formatNumber(summaryKpis.wonDealsCount)}
              </span>{' '}
              won ({formatPhp(summaryKpis.closedRevenuePhp, 0)})
            </p>
          </div>
        </section>

        {/* Shareable Executive Report Link Banner (when generated) */}
        {generatedShareUrl && (
          <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                🔗 Read-Only Executive Report Link Generated &amp; Copied
              </p>
              <p className="text-xs font-mono text-slate-200 break-all">
                {generatedShareUrl}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={generatedShareUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-bold text-white transition"
              >
                Open Executive View <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        )}

        {/* Organic & Comment-to-DM Attribution Summary Card (Zero Ad Spend Leads) */}
        <section className="rounded-2xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/40 via-slate-900/90 to-slate-900/90 p-4 shadow-md">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-indigo-500/20 px-2.5 py-0.5 text-[11px] font-bold text-indigo-300 ring-1 ring-indigo-500/40">
                  🌱 Free Organic &amp; Comment-to-DM Pipeline (₱0 Ad Spend)
                </span>
                <span className="text-xs text-slate-400">
                  Tracked separately so organic sales never skew your Paid Ad ROAS
                </span>
              </div>
              <p className="text-xs text-slate-300">
                Includes organic Messenger/IG threads and leads captured automatically by your AI Comment-to-DM Shield on Page posts.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950/80 px-3.5 py-2">
                <span className="block text-[10px] font-semibold uppercase text-slate-400">
                  Organic / Comment DMs
                </span>
                <span className="text-base font-bold text-sky-300">
                  {formatNumber(organicSummary.organicDms)} DMs
                </span>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/80 px-3.5 py-2">
                <span className="block text-[10px] font-semibold uppercase text-slate-400">
                  AI Shield Auto-Replies
                </span>
                <span className="text-base font-bold text-indigo-300">
                  {formatNumber(organicSummary.commentShieldRepliesCount)} Sent
                </span>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/80 px-3.5 py-2">
                <span className="block text-[10px] font-semibold uppercase text-slate-400">
                  Organic Pending (₱)
                </span>
                <span className="text-base font-bold text-amber-300">
                  {formatPhp(organicSummary.organicPendingPhp, 0)}
                </span>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/80 px-3.5 py-2">
                <span className="block text-[10px] font-semibold uppercase text-slate-400">
                  Organic Closed Won
                </span>
                <span className="text-base font-bold text-emerald-300">
                  {formatPhp(organicSummary.organicWonPhp, 0)} ({organicSummary.organicWonCount})
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* 3. Full Attribution & Diagnostic Table */}
        <section className="rounded-2xl border border-slate-800/90 bg-slate-900/60 shadow-xl overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-4 border-b border-slate-800">
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <Target className="h-4 w-4 text-indigo-400" />
                Ad-Level Full-Funnel Attribution &amp; Diagnostics
              </h2>
              <p className="text-xs text-slate-400">
                Live view joining <code className="text-slate-300">v_mkt_ad_attribution</code> with{' '}
                <code className="text-slate-300">mkt_ads_catalog</code>. Toggle switches update Meta Ads Manager immediately.
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Top Scaler (&ge; 3.5x ROAS):{' '}
                <strong className="text-slate-200">{summaryKpis.topScalerCount}</strong>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-rose-400" />
                Window Shopper Trap (&ge; 20 DMs, 0 Qual/Won):{' '}
                <strong className="text-slate-200">{summaryKpis.windowShopperCount}</strong>
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="py-3.5 pl-5 pr-3 w-28">Status</th>
                  <th className="py-3.5 px-3 min-w-[300px]">Ad Creative &amp; Diagnostics</th>
                  <th className="py-3.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleSortClick('total_spend')}
                      className="inline-flex items-center gap-1 hover:text-white cursor-pointer"
                    >
                      Spend (₱)
                      <ArrowDownUp className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="py-3.5 px-3 text-right">Hook / Hold %</th>
                  <th className="py-3.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleSortClick('total_dms')}
                      className="inline-flex items-center gap-1 hover:text-white cursor-pointer"
                    >
                      DMs (Cost/DM)
                      <ArrowDownUp className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="py-3.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleSortClick('qualified_count')}
                      className="inline-flex items-center gap-1 hover:text-white cursor-pointer"
                    >
                      CRM Qualified
                      <ArrowDownUp className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="py-3.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleSortClick('pending_pipeline_value')}
                      className="inline-flex items-center gap-1 hover:text-white cursor-pointer"
                    >
                      Pending (₱)
                      <ArrowDownUp className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="py-3.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleSortClick('closed_revenue')}
                      className="inline-flex items-center gap-1 hover:text-white cursor-pointer"
                    >
                      Closed Won (Count &amp; ₱)
                      <ArrowDownUp className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="py-3.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleSortClick('true_cpa')}
                      className="inline-flex items-center gap-1 hover:text-white cursor-pointer"
                    >
                      True CPA (₱)
                      <ArrowDownUp className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="py-3.5 pl-3 pr-5 text-right">
                    <button
                      type="button"
                      onClick={() => handleSortClick('true_roas')}
                      className="inline-flex items-center gap-1 hover:text-white cursor-pointer"
                    >
                      True ROAS
                      <ArrowDownUp className="h-3 w-3" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-sm">
                {loading ? (
                  <tr>
                    <td colSpan={10} className="py-16 text-center text-slate-400">
                      <div className="inline-flex items-center gap-2.5 text-sm">
                        <Loader2 className="h-5 w-5 animate-spin text-indigo-400" />
                        Loading Meta Attribution &amp; CRM Pipeline telemetry...
                      </div>
                    </td>
                  </tr>
                ) : filteredAds.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-16 text-center text-slate-400">
                      <p className="text-base font-medium text-slate-300">
                        No matching ads found for this filter view
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Click &ldquo;Sync Meta Now&rdquo; to pull your latest Ad Catalog &amp; Daily Insights from Meta Marketing API.
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredAds.map((ad) => {
                    const isActive = ad.status?.toUpperCase() === 'ACTIVE';
                    const isToggling = Boolean(togglingAdIds[ad.ad_id]);
                    const costPerDm =
                      ad.total_dms > 0 ? ad.total_spend / ad.total_dms : null;
                    const qualRatePct =
                      ad.total_dms > 0
                        ? (ad.qualified_count / ad.total_dms) * 100
                        : 0;

                    // Smart Diagnostics Rules
                    const isWindowShopperTrap =
                      ad.total_dms >= 20 &&
                      ad.qualified_count === 0 &&
                      ad.won_count === 0;
                    const isTopScaler = ad.true_roas >= 3.5;

                    return (
                      <tr
                        key={ad.ad_id}
                        className={`transition-colors hover:bg-slate-800/40 ${
                          isWindowShopperTrap
                            ? 'bg-rose-950/15'
                            : isTopScaler
                              ? 'bg-emerald-950/10'
                              : ''
                        }`}
                      >
                        {/* 1. Status Toggle (Switch) */}
                        <td className="py-3.5 pl-5 pr-3 align-middle">
                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={isActive}
                              disabled={isToggling}
                              onClick={() => handleToggleAdStatus(ad)}
                              title={`Click to ${isActive ? 'PAUSE' : 'ACTIVATE'} ad in Meta`}
                              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                isActive ? 'bg-emerald-500' : 'bg-slate-700'
                              } ${isToggling ? 'opacity-60 cursor-wait' : ''}`}
                            >
                              <span
                                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out flex items-center justify-center ${
                                  isActive ? 'translate-x-5' : 'translate-x-0'
                                }`}
                              >
                                {isToggling && (
                                  <Loader2 className="h-3 w-3 animate-spin text-slate-900" />
                                )}
                              </span>
                            </button>
                            <span
                              className={`text-[11px] font-semibold tracking-wide ${
                                isActive ? 'text-emerald-400' : 'text-slate-400'
                              }`}
                            >
                              {isActive ? 'ACTIVE' : 'PAUSED'}
                            </span>
                          </div>
                        </td>

                        {/* 2. Ad Creative (Thumbnail + Name + Campaign + Smart Badges) */}
                        <td className="py-3.5 px-3 align-middle">
                          <div className="flex items-start gap-3">
                            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-slate-700/80 bg-slate-800 flex items-center justify-center">
                              {ad.thumbnail_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={ad.thumbnail_url}
                                  alt={ad.ad_name}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <ImageIcon className="h-5 w-5 text-slate-500" />
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <p
                                  className="font-semibold text-white truncate max-w-[260px] sm:max-w-[340px]"
                                  title={ad.ad_name}
                                >
                                  {ad.ad_name}
                                </p>

                                {/* Smart Diagnostic Badge: Window Shopper Trap */}
                                {isWindowShopperTrap && (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/20 px-2 py-0.5 text-[11px] font-semibold text-rose-300 ring-1 ring-inset ring-rose-500/40">
                                    ⚠️ Window Shopper Trap
                                  </span>
                                )}

                                {/* Smart Diagnostic Badge: Top Scaler */}
                                {isTopScaler && (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/40">
                                    <Flame className="h-3 w-3 text-emerald-400" />
                                    🔥 Top Scaler
                                  </span>
                                )}
                              </div>

                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
                                <span className="truncate max-w-[220px]">
                                  {ad.campaign_name || 'Unassigned Campaign'}
                                </span>
                                {ad.adset_name && (
                                  <>
                                    <span className="text-slate-600">&bull;</span>
                                    <span className="truncate max-w-[180px] text-slate-500">
                                      {ad.adset_name}
                                    </span>
                                  </>
                                )}
                                <span className="font-mono text-[10px] text-slate-500">
                                  #{ad.ad_id}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* 3. Spend (₱) */}
                        <td className="py-3.5 px-3 text-right align-middle font-mono font-semibold text-white whitespace-nowrap">
                          {formatPhp(ad.total_spend)}
                        </td>

                        {/* 4. Hook / Hold % */}
                        <td className="py-3.5 px-3 text-right align-middle whitespace-nowrap">
                          <div className="inline-flex flex-col items-end">
                            <span
                              className={`text-xs font-semibold ${
                                ad.hook_rate_pct >= 25
                                  ? 'text-emerald-400'
                                  : ad.hook_rate_pct >= 15
                                    ? 'text-amber-300'
                                    : 'text-slate-300'
                              }`}
                            >
                              {ad.hook_rate_pct.toFixed(1)}% Hook
                            </span>
                            <span className="text-[11px] text-slate-400">
                              {ad.hold_rate_pct.toFixed(1)}% Hold
                            </span>
                          </div>
                        </td>

                        {/* 5. DMs (Cost/DM) */}
                        <td className="py-3.5 px-3 text-right align-middle whitespace-nowrap">
                          <div className="inline-flex flex-col items-end">
                            <span className="font-semibold text-sky-300">
                              {formatNumber(ad.total_dms)} DMs
                            </span>
                            <span className="text-[11px] font-mono text-slate-400">
                              {costPerDm !== null ? `${formatPhp(costPerDm)}/DM` : '—'}
                            </span>
                          </div>
                        </td>

                        {/* 6. CRM Qualified */}
                        <td className="py-3.5 px-3 text-right align-middle whitespace-nowrap">
                          <div className="inline-flex flex-col items-end">
                            <span className="font-semibold text-indigo-300">
                              {formatNumber(ad.qualified_count)}
                            </span>
                            <span className="text-[11px] text-slate-400">
                              {qualRatePct.toFixed(1)}% qual
                            </span>
                          </div>
                        </td>

                        {/* 7. Pending (₱) */}
                        <td className="py-3.5 px-3 text-right align-middle whitespace-nowrap">
                          <div className="inline-flex flex-col items-end">
                            <span className="font-mono font-medium text-amber-300">
                              {formatPhp(ad.pending_pipeline_value)}
                            </span>
                            {ad.pending_count > 0 && (
                              <span className="text-[11px] text-slate-400">
                                {ad.pending_count} active
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 8. Closed Won (Count & ₱) */}
                        <td className="py-3.5 px-3 text-right align-middle whitespace-nowrap">
                          <div className="inline-flex flex-col items-end">
                            <span className="font-mono font-bold text-emerald-300">
                              {formatPhp(ad.closed_revenue)}
                            </span>
                            <span className="text-[11px] text-slate-300">
                              {formatNumber(ad.won_count)} won ({ad.chat_close_rate_pct.toFixed(1)}%)
                            </span>
                          </div>
                        </td>

                        {/* 9. True CPA (₱) */}
                        <td className="py-3.5 px-3 text-right align-middle font-mono text-slate-200 whitespace-nowrap">
                          {ad.true_cpa !== null && ad.won_count > 0
                            ? formatPhp(ad.true_cpa)
                            : '—'}
                        </td>

                        {/* 10. True ROAS */}
                        <td className="py-3.5 pl-3 pr-5 text-right align-middle whitespace-nowrap">
                          <span
                            className={`inline-flex items-center rounded-lg px-2.5 py-1 font-mono text-xs font-bold ring-1 ring-inset ${
                              ad.true_roas >= 3.5
                                ? 'bg-emerald-500/20 text-emerald-300 ring-emerald-500/40'
                                : ad.true_roas >= 2.0
                                  ? 'bg-teal-500/15 text-teal-300 ring-teal-500/30'
                                  : ad.true_roas >= 1.0
                                    ? 'bg-amber-500/15 text-amber-300 ring-amber-500/30'
                                    : ad.total_spend > 0
                                      ? 'bg-rose-500/15 text-rose-300 ring-rose-500/30'
                                      : 'bg-slate-800 text-slate-400 ring-slate-700'
                            }`}
                          >
                            {ad.true_roas.toFixed(2)}x
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

