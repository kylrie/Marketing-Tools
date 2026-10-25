'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock,
  EyeOff,
  Flame,
  Loader2,
  MessageSquarePlus,
  Play,
  Plus,
  RefreshCw,
  Save,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type {
  MktAutomationLogRow,
  MktCommentRuleRow,
  MktWatchdogAction,
  MktWatchdogRuleRow,
} from '@/lib/meta-engine/types';

type ActiveTab = 'WATCHDOG_RULES' | 'COMMENT_SHIELD';

type LogFilterPill = 'ALL' | 'AUTO_PAUSED_ADS' | 'COMMENT_DMS_SENT' | 'SPAM_HIDDEN';

interface ToastItem {
  id: string;
  type: 'success' | 'error';
  title: string;
  message: string;
}

export default function WatchdogAndCommentShieldPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('WATCHDOG_RULES');
  const [loading, setLoading] = useState<boolean>(true);
  const [runningWatchdog, setRunningWatchdog] = useState<boolean>(false);
  const [savingRuleIds, setSavingRuleIds] = useState<Record<string, boolean>>({});
  const [savingPipelineGuard, setSavingPipelineGuard] = useState<boolean>(false);
  const [savingCommentShield, setSavingCommentShield] = useState<boolean>(false);

  // State for Tab 1: Watchdog Rules
  const [watchdogRules, setWatchdogRules] = useState<MktWatchdogRuleRow[]>([]);

  // State for Tab 2: Comment-to-DM Shield
  const [commentRuleId, setCommentRuleId] = useState<string | undefined>(undefined);
  const [triggerKeywords, setTriggerKeywords] = useState<string[]>([]);
  const [newKeywordInput, setNewKeywordInput] = useState<string>('');
  const [publicReplyTemplates, setPublicReplyTemplates] = useState<string[]>([]);
  const [newPublicReplyInput, setNewPublicReplyInput] = useState<string>('');
  const [privateDmTemplate, setPrivateDmTemplate] = useState<string>('');
  const [autoHideInquiryComment, setAutoHideInquiryComment] = useState<boolean>(true);
  const [aiModerationEnabled, setAiModerationEnabled] = useState<boolean>(true);

  // State for Bottom Panel: Live Automation Audit Log
  const [automationLogs, setAutomationLogs] = useState<MktAutomationLogRow[]>([]);
  const [logFilter, setLogFilter] = useState<LogFilterPill>('ALL');
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = useCallback(
    (type: ToastItem['type'], title: string, message: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev, { id, type, title, message }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 5000);
    },
    []
  );

  const applyCommentRuleToState = useCallback((cr: MktCommentRuleRow | null) => {
    if (!cr) return;
    setCommentRuleId(cr.id);
    if (Array.isArray(cr.trigger_keywords) && cr.trigger_keywords.length > 0) {
      setTriggerKeywords(cr.trigger_keywords);
    }
    if (
      Array.isArray(cr.public_reply_templates) &&
      cr.public_reply_templates.length > 0
    ) {
      setPublicReplyTemplates(cr.public_reply_templates);
    }
    if (cr.private_dm_template) {
      setPrivateDmTemplate(cr.private_dm_template);
    }
    setAutoHideInquiryComment(Boolean(cr.auto_hide_inquiry_comment));
    setAiModerationEnabled(Boolean(cr.ai_moderation_enabled));
  }, []);

  /**
   * Loads Watchdog Rules, Comment Shield Config, and Automation Logs from `/api/marketing/watchdog`
   * with direct Supabase fallback.
   */
  const fetchAllAutomationData = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);

      try {
        const res = await fetch('/api/marketing/watchdog', { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as {
            watchdogRules: MktWatchdogRuleRow[];
            commentRule: MktCommentRuleRow | null;
            automationLogs: MktAutomationLogRow[];
          };
          setWatchdogRules(data.watchdogRules || []);
          applyCommentRuleToState(data.commentRule);
          setAutomationLogs(data.automationLogs || []);
          setLoading(false);
          return;
        }

        // Direct Supabase browser fallback
        const supabase = getSupabaseBrowserClient();
        if (supabase) {
          const [
            { data: wdRows },
            { data: cmRow },
            { data: logRows },
          ] = await Promise.all([
            supabase
              .from('mkt_watchdog_rules')
              .select('*')
              .order('created_at', { ascending: true }),
            supabase
              .from('mkt_comment_rules')
              .select('*')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle<MktCommentRuleRow>(),
            supabase
              .from('mkt_automation_logs')
              .select('*')
              .order('created_at', { ascending: false })
              .limit(100),
          ]);

          setWatchdogRules((wdRows || []) as MktWatchdogRuleRow[]);
          applyCommentRuleToState(cmRow || null);
          setAutomationLogs((logRows || []) as MktAutomationLogRow[]);
        }
      } catch (err) {
        pushToast(
          'error',
          'Failed loading automation rules',
          err instanceof Error ? err.message : 'Unable to reach Watchdog API.'
        );
      } finally {
        setLoading(false);
      }
    },
    [applyCommentRuleToState, pushToast]
  );

  useEffect(() => {
    fetchAllAutomationData();
  }, [fetchAllAutomationData]);

  /**
   * Manually triggers `evaluateWatchdogRules()` via `POST /api/marketing/watchdog`
   */
  const handleRunWatchdogNow = async () => {
    if (runningWatchdog) return;
    setRunningWatchdog(true);

    try {
      const res = await fetch('/api/marketing/watchdog', {
        method: 'POST',
      });
      const data = (await res.json()) as {
        success?: boolean;
        evaluation?: {
          evaluatedAdsCount: number;
          activeRulesCount: number;
          decisionsCount: number;
        };
        automationLogs?: MktAutomationLogRow[];
        error?: string;
      };

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Watchdog evaluation failed.');
      }

      if (Array.isArray(data.automationLogs)) {
        setAutomationLogs(data.automationLogs);
      }

      pushToast(
        'success',
        'Watchdog Check Complete',
        `Evaluated ${data.evaluation?.evaluatedAdsCount ?? 0} active ads against ${
          data.evaluation?.activeRulesCount ?? 0
        } rules (${data.evaluation?.decisionsCount ?? 0} actions logged).`
      );
    } catch (error) {
      pushToast(
        'error',
        'Watchdog Check Failed',
        error instanceof Error ? error.message : 'Error running Watchdog check.'
      );
    } finally {
      setRunningWatchdog(false);
    }
  };

  /**
   * Updates a local field on a Watchdog Rule card
   */
  const handleLocalRuleChange = <K extends keyof MktWatchdogRuleRow>(
    ruleId: string,
    field: K,
    value: MktWatchdogRuleRow[K]
  ) => {
    setWatchdogRules((prev) =>
      prev.map((r) => (r.id === ruleId ? { ...r, [field]: value } : r))
    );
  };

  /**
   * Persists a Watchdog Rule to `mkt_watchdog_rules`
   */
  const handleSaveWatchdogRule = async (rule: MktWatchdogRuleRow) => {
    setSavingRuleIds((prev) => ({ ...prev, [rule.id]: true }));

    try {
      const res = await fetch('/api/marketing/watchdog', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: 'WATCHDOG_RULE',
          rule,
        }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        watchdogRule?: MktWatchdogRuleRow;
        error?: string;
      };

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed saving Watchdog rule.');
      }

      if (data.watchdogRule) {
        setWatchdogRules((prev) =>
          prev.map((r) => (r.id === rule.id ? data.watchdogRule! : r))
        );
      }

      pushToast(
        'success',
        'Watchdog Rule Saved',
        `Updated "${rule.rule_name}" thresholds & status.`
      );
    } catch (error) {
      pushToast(
        'error',
        'Failed Saving Rule',
        error instanceof Error ? error.message : 'Unable to save rule.'
      );
    } finally {
      setSavingRuleIds((prev) => {
        const next = { ...prev };
        delete next[rule.id];
        return next;
      });
    }
  };

  /**
   * Toggles the master "Protect Ads with Pending CRM Deals" safeguard across all rules
   */
  const isGlobalPipelineProtected = useMemo(() => {
    if (watchdogRules.length === 0) return true;
    return watchdogRules.every((r) => r.protect_pending_pipeline);
  }, [watchdogRules]);

  const handleToggleGlobalPipelineProtector = async () => {
    if (savingPipelineGuard) return;
    const nextValue = !isGlobalPipelineProtected;
    setSavingPipelineGuard(true);

    // Optimistic update
    setWatchdogRules((prev) =>
      prev.map((r) => ({ ...r, protect_pending_pipeline: nextValue }))
    );

    try {
      const res = await fetch('/api/marketing/watchdog', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: 'PIPELINE_PROTECTOR_ALL',
          protect_pending_pipeline: nextValue,
        }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        watchdogRules?: MktWatchdogRuleRow[];
        error?: string;
      };

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed updating Pending Pipeline Protector.');
      }

      if (Array.isArray(data.watchdogRules)) {
        setWatchdogRules(data.watchdogRules);
      }

      pushToast(
        'success',
        `Pending Pipeline Protector ${nextValue ? 'Enabled' : 'Disabled'}`,
        nextValue
          ? 'Ads with active PENDING deals in CRM (last 48h) are now protected from auto-pausing.'
          : 'Pending CRM deal protection has been turned off.'
      );
    } catch (error) {
      pushToast(
        'error',
        'Update Failed',
        error instanceof Error ? error.message : 'Failed updating safeguard.'
      );
    } finally {
      setSavingPipelineGuard(false);
    }
  };

  /**
   * Tab 2 Handlers: Keyword Tag Editor, Public Reply Templates, Private DM & AI Moderation
   */
  const handleAddKeyword = () => {
    const cleaned = newKeywordInput.trim().toLowerCase();
    if (!cleaned) return;
    if (!triggerKeywords.includes(cleaned)) {
      setTriggerKeywords((prev) => [...prev, cleaned]);
    }
    setNewKeywordInput('');
  };

  const handleRemoveKeyword = (keywordToRemove: string) => {
    setTriggerKeywords((prev) => prev.filter((k) => k !== keywordToRemove));
  };

  const handleAddPublicReplyTemplate = () => {
    const cleaned = newPublicReplyInput.trim();
    if (!cleaned) return;
    setPublicReplyTemplates((prev) => [...prev, cleaned]);
    setNewPublicReplyInput('');
  };

  const handleUpdatePublicReplyTemplate = (index: number, value: string) => {
    setPublicReplyTemplates((prev) =>
      prev.map((item, idx) => (idx === index ? value : item))
    );
  };

  const handleRemovePublicReplyTemplate = (index: number) => {
    if (publicReplyTemplates.length <= 1) {
      pushToast(
        'error',
        'Minimum 1 Reply Required',
        'Keep at least one public reply template for price inquiries.'
      );
      return;
    }
    setPublicReplyTemplates((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSaveCommentShield = async () => {
    if (savingCommentShield) return;
    setSavingCommentShield(true);

    try {
      const res = await fetch('/api/marketing/watchdog', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: 'COMMENT_RULE',
          commentRule: {
            id: commentRuleId,
            trigger_keywords: triggerKeywords,
            public_reply_templates: publicReplyTemplates,
            private_dm_template: privateDmTemplate,
            auto_hide_inquiry_comment: autoHideInquiryComment,
            ai_moderation_enabled: aiModerationEnabled,
          },
        }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        commentRule?: MktCommentRuleRow;
        error?: string;
      };

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed saving Comment Shield settings.');
      }

      if (data.commentRule) {
        applyCommentRuleToState(data.commentRule);
      }

      pushToast(
        'success',
        'Comment-to-DM Shield Saved',
        'Updated trigger keywords, reply templates, and Gemini AI moderation preferences.'
      );
    } catch (error) {
      pushToast(
        'error',
        'Save Failed',
        error instanceof Error ? error.message : 'Unable to save Comment Shield config.'
      );
    } finally {
      setSavingCommentShield(false);
    }
  };

  /**
   * Bottom Panel Filtered Audit Logs
   */
  const filteredLogs = useMemo(() => {
    return automationLogs.filter((log) => {
      if (logFilter === 'ALL') return true;
      if (logFilter === 'AUTO_PAUSED_ADS') {
        return (
          log.module === 'WATCHDOG' ||
          log.action_taken.includes('PAUSE') ||
          log.action_taken.includes('SCALE')
        );
      }
      if (logFilter === 'COMMENT_DMS_SENT') {
        return (
          log.module === 'COMMENT_SHIELD' &&
          (log.action_taken.includes('DM_SENT') ||
            log.action_taken.includes('PUBLIC_REPLY') ||
            log.action_taken.includes('SUPPORT_COMPLAINT'))
        );
      }
      if (logFilter === 'SPAM_HIDDEN') {
        return (
          log.module === 'COMMENT_SHIELD' &&
          (log.action_taken.includes('SPAM') || log.action_taken.includes('HIDDEN'))
        );
      }
      return true;
    });
  }, [automationLogs, logFilter]);

  const protectedPipelineSavesCount = useMemo(
    () =>
      automationLogs.filter((l) =>
        l.action_taken.includes('SKIPPED_PAUSE_PIPELINE_PROTECTED')
      ).length,
    [automationLogs]
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Toast Notifications */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-md w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-4 shadow-2xl backdrop-blur-md transition-all ${
              toast.type === 'success'
                ? 'border-emerald-500/40 bg-emerald-950/90 text-emerald-100'
                : 'border-rose-500/40 bg-rose-950/90 text-rose-100'
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

      <div className="mx-auto max-w-[1500px] px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Top Header & Two-Tab Navigation */}
        <header className="flex flex-col gap-4 rounded-2xl border border-slate-800/90 bg-slate-900/60 p-5 shadow-lg">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <Link
                  href="/marketing/attribution"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/80 px-2.5 py-1 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white transition"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Attribution Center
                </Link>
                <Link
                  href="/marketing/launcher"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/80 px-2.5 py-1 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white transition"
                >
                  <Play className="h-3.5 w-3.5 text-emerald-400" />
                  Bulk Ad Launcher
                </Link>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-300 ring-1 ring-inset ring-indigo-500/25">
                  <Bot className="h-3.5 w-3.5" />
                  24/7 Autonomous Defense &amp; Scaling Engine
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Ad Watchdog &amp; AI Comment-to-DM Shield
              </h1>
              <p className="text-sm text-slate-400">
                Automated stop-loss protection with CRM pipeline awareness, plus instant Comment-to-Messenger lead capture &amp; Gemini 2.5 Flash moderation.
              </p>
            </div>

            {/* Manual Watchdog Trigger Button */}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleRunWatchdogNow}
                disabled={runningWatchdog}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 transition cursor-pointer"
              >
                {runningWatchdog ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 fill-current" />
                )}
                {runningWatchdog ? 'Evaluating Active Ads...' : 'Run Watchdog Check Now'}
              </button>
            </div>
          </div>

          {/* Two-Tab Switcher */}
          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-800/80">
            <button
              type="button"
              onClick={() => setActiveTab('WATCHDOG_RULES')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-semibold transition cursor-pointer ${
                activeTab === 'WATCHDOG_RULES'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                  : 'bg-slate-950/70 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <ShieldAlert className="h-4 w-4" />
              Tab 1: Cross-Funnel Ad Watchdog Rules
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('COMMENT_SHIELD')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-semibold transition cursor-pointer ${
                activeTab === 'COMMENT_SHIELD'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                  : 'bg-slate-950/70 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <MessageSquarePlus className="h-4 w-4" />
              Tab 2: AI Comment-to-DM Shield
            </button>
          </div>
        </header>

        {loading ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 py-20 text-center">
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-indigo-400" />
            <p className="mt-3 text-sm text-slate-400">
              Loading Watchdog Rules, Comment Shield &amp; Audit Logs...
            </p>
          </div>
        ) : (
          <>
            {/* ================================================================
                TAB 1: Cross-Funnel Ad Watchdog Rules
               ================================================================ */}
            {activeTab === 'WATCHDOG_RULES' && (
              <section className="space-y-5">
                {/* Master Safeguard Banner Card: Pending Pipeline Protector */}
                <div className="rounded-2xl border border-amber-500/35 bg-gradient-to-r from-amber-950/40 via-slate-900/90 to-slate-900/90 p-5 shadow-lg">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-start gap-3.5">
                      <div className="rounded-xl bg-amber-500/20 p-2.5 text-amber-300 ring-1 ring-amber-500/40 mt-0.5">
                        <ShieldCheck className="h-6 w-6" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-base sm:text-lg font-bold text-white">
                            Pending Pipeline Protector (48-Hour CRM Deal Safeguard)
                          </h2>
                          <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300 ring-1 ring-amber-500/30">
                            {protectedPipelineSavesCount} Auto-Pauses Prevented
                          </span>
                        </div>
                        <p className="mt-1 text-xs sm:text-sm text-slate-300 max-w-3xl">
                          Prevents the Watchdog from pausing an ad if your sales agents have active{' '}
                          <code className="text-amber-300 font-semibold">PENDING</code> deals (`pending_pipeline_value &gt; ₱0`) in the In-House CRM within the last 48 hours.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 self-end md:self-center">
                      <span className="text-xs font-semibold text-slate-300">
                        Protect Ads with Pending CRM Deals
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isGlobalPipelineProtected}
                        disabled={savingPipelineGuard}
                        onClick={handleToggleGlobalPipelineProtector}
                        className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                          isGlobalPipelineProtected ? 'bg-amber-500' : 'bg-slate-700'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
                            isGlobalPipelineProtected ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Watchdog Rule Cards Grid (`Freebie Seeker Killer`, `Bleeding Spend Stop-Loss`, `Winner Scaler`) */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                  {watchdogRules.map((rule) => {
                    const isSaving = Boolean(savingRuleIds[rule.id]);
                    const isKiller = rule.rule_type === 'FREEBIE_SEEKER_KILLER';
                    const isStoploss = rule.rule_type === 'BLEEDING_SPEND_STOPLOSS';
                    const isScaler = rule.rule_type === 'WINNER_SCALER';

                    const badgeColor = isKiller
                      ? 'bg-rose-500/15 text-rose-300 ring-rose-500/30'
                      : isStoploss
                        ? 'bg-orange-500/15 text-orange-300 ring-orange-500/30'
                        : 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30';

                    return (
                      <div
                        key={rule.id}
                        className="flex flex-col justify-between rounded-2xl border border-slate-800/90 bg-slate-900/70 p-5 shadow-xl"
                      >
                        <div className="space-y-4">
                          {/* Card Header & ON/OFF Switch */}
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <span
                                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${badgeColor}`}
                              >
                                {isScaler ? (
                                  <Flame className="h-3.5 w-3.5" />
                                ) : (
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                )}
                                {rule.rule_type.replace(/_/g, ' ')}
                              </span>
                              <input
                                type="text"
                                value={rule.rule_name}
                                onChange={(e) =>
                                  handleLocalRuleChange(
                                    rule.id,
                                    'rule_name',
                                    e.target.value
                                  )
                                }
                                className="mt-2 w-full bg-transparent text-base font-bold text-white border-b border-transparent focus:border-indigo-500 focus:outline-none"
                              />
                            </div>

                            {/* Rule Active Switch */}
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-[11px] font-bold ${
                                  rule.is_active ? 'text-emerald-400' : 'text-slate-500'
                                }`}
                              >
                                {rule.is_active ? 'ON' : 'OFF'}
                              </span>
                              <button
                                type="button"
                                role="switch"
                                aria-checked={rule.is_active}
                                onClick={() =>
                                  handleLocalRuleChange(
                                    rule.id,
                                    'is_active',
                                    !rule.is_active
                                  )
                                }
                                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                                  rule.is_active ? 'bg-emerald-500' : 'bg-slate-700'
                                }`}
                              >
                                <span
                                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                                    rule.is_active ? 'translate-x-5' : 'translate-x-0'
                                  }`}
                                />
                              </button>
                            </div>
                          </div>

                          {/* Threshold Inputs */}
                          <div className="grid grid-cols-2 gap-3 pt-2">
                            <div>
                              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                Min Spend (₱)
                              </label>
                              <input
                                type="number"
                                min={0}
                                step={100}
                                value={rule.min_spend_php}
                                onChange={(e) =>
                                  handleLocalRuleChange(
                                    rule.id,
                                    'min_spend_php',
                                    Number(e.target.value)
                                  )
                                }
                                className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/90 px-3 py-2 text-sm font-mono text-white focus:border-indigo-500 focus:outline-none"
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                Min DMs Started
                              </label>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={rule.min_dms}
                                onChange={(e) =>
                                  handleLocalRuleChange(
                                    rule.id,
                                    'min_dms',
                                    Number(e.target.value)
                                  )
                                }
                                className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/90 px-3 py-2 text-sm font-mono text-white focus:border-indigo-500 focus:outline-none"
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                Max Qualified Leads
                              </label>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={rule.max_qualified_leads}
                                onChange={(e) =>
                                  handleLocalRuleChange(
                                    rule.id,
                                    'max_qualified_leads',
                                    Number(e.target.value)
                                  )
                                }
                                className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/90 px-3 py-2 text-sm font-mono text-white focus:border-indigo-500 focus:outline-none"
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                Target ROAS (x)
                              </label>
                              <input
                                type="number"
                                min={0}
                                step={0.1}
                                value={rule.min_roas}
                                onChange={(e) =>
                                  handleLocalRuleChange(
                                    rule.id,
                                    'min_roas',
                                    Number(e.target.value)
                                  )
                                }
                                className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/90 px-3 py-2 text-sm font-mono text-white focus:border-indigo-500 focus:outline-none"
                              />
                            </div>
                          </div>

                          {/* Action Selector */}
                          <div>
                            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                              Automated Action
                            </label>
                            <select
                              value={rule.action_to_take}
                              onChange={(e) =>
                                handleLocalRuleChange(
                                  rule.id,
                                  'action_to_take',
                                  e.target.value as MktWatchdogAction
                                )
                              }
                              className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/90 px-3 py-2 text-xs sm:text-sm text-slate-200 focus:border-indigo-500 focus:outline-none"
                            >
                              <option value="PAUSE_AD">Pause Ad in Meta Ads Manager</option>
                              <option value="INCREASE_BUDGET_20_PCT">
                                Increase AdSet Daily Budget +20%
                              </option>
                              <option value="ALERT_ONLY">Log Alert Only (No Mutation)</option>
                            </select>
                          </div>

                          {/* Per-Rule Pending CRM Pipeline Safeguard Toggle */}
                          <div className="flex items-center justify-between rounded-xl border border-slate-800/90 bg-slate-950/60 px-3.5 py-2.5">
                            <span className="text-xs text-slate-300 flex items-center gap-1.5">
                              <Shield className="h-3.5 w-3.5 text-amber-400" />
                              Protect Ads with Pending CRM Deals
                            </span>
                            <input
                              type="checkbox"
                              checked={rule.protect_pending_pipeline}
                              onChange={(e) =>
                                handleLocalRuleChange(
                                  rule.id,
                                  'protect_pending_pipeline',
                                  e.target.checked
                                )
                              }
                              className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                            />
                          </div>
                        </div>

                        {/* Save Rule Button */}
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => handleSaveWatchdogRule(rule)}
                          className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-slate-800 hover:bg-indigo-600 disabled:opacity-60 px-4 py-2.5 text-xs font-semibold text-white transition cursor-pointer"
                        >
                          {isSaving ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="h-4 w-4" />
                          )}
                          {isSaving ? 'Saving Rule...' : 'Save Rule Thresholds'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* ================================================================
                TAB 2: AI Comment-to-DM Shield
               ================================================================ */}
            {activeTab === 'COMMENT_SHIELD' && (
              <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left Column: Trigger Keywords & Moderation Toggles */}
                <div className="lg:col-span-5 space-y-5">
                  {/* Keyword Tag Editor Card */}
                  <div className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-5 shadow-xl space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-base font-bold text-white flex items-center gap-2">
                        <Tag className="h-4 w-4 text-indigo-400" />
                        Price Inquiry Trigger Keywords
                      </h2>
                      <span className="text-xs text-slate-400">
                        {triggerKeywords.length} active triggers
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">
                      Comments containing any of these keywords immediately trigger a randomized Public Reply and a Private Inbox DM.
                    </p>

                    {/* Active Keyword Chips */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {triggerKeywords.map((kw) => (
                        <span
                          key={kw}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500/15 px-3 py-1 text-xs font-semibold text-indigo-300 ring-1 ring-inset ring-indigo-500/30"
                        >
                          {kw}
                          <button
                            type="button"
                            onClick={() => handleRemoveKeyword(kw)}
                            className="text-indigo-400 hover:text-white cursor-pointer"
                            title={`Remove "${kw}"`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>

                    {/* Add Keyword Input */}
                    <div className="flex items-center gap-2 pt-2">
                      <input
                        type="text"
                        value={newKeywordInput}
                        onChange={(e) => setNewKeywordInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddKeyword();
                          }
                        }}
                        placeholder="Add keyword (e.g. hm, how much, loc)..."
                        className="flex-1 rounded-xl border border-slate-800 bg-slate-950/90 px-3 py-2 text-xs sm:text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={handleAddKeyword}
                        className="inline-flex items-center gap-1 rounded-xl bg-slate-800 hover:bg-slate-700 px-3.5 py-2 text-xs font-semibold text-white transition cursor-pointer"
                      >
                        <Plus className="h-4 w-4" />
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Anti-Poaching & Gemini AI Moderation Toggles Card */}
                  <div className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-5 shadow-xl space-y-4">
                    <h2 className="text-base font-bold text-white flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-emerald-400" />
                      Competitor Shield &amp; Gemini AI Moderation
                    </h2>

                    {/* Toggle 1: Auto-Hide Price Inquiries from Competitors */}
                    <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-white flex items-center gap-1.5">
                          <EyeOff className="h-4 w-4 text-sky-400" />
                          Auto-Hide Price Inquiries from Competitors
                        </p>
                        <p className="text-xs text-slate-400">
                          Automatically sets <code className="text-slate-300">is_hidden=true</code> on the comment after sending the Private DM so rival pages cannot poach your leads.
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={autoHideInquiryComment}
                        onClick={() => setAutoHideInquiryComment((prev) => !prev)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                          autoHideInquiryComment ? 'bg-emerald-500' : 'bg-slate-700'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                            autoHideInquiryComment ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Toggle 2: Gemini AI Troll/Spam Auto-Hider */}
                    <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-white flex items-center gap-1.5">
                          <Bot className="h-4 w-4 text-violet-400" />
                          Gemini AI Troll/Spam Auto-Hider
                        </p>
                        <p className="text-xs text-slate-400">
                          Uses <code className="text-slate-300">gemini-2.5-flash</code> to classify non-keyword comments into Price Inquiries, Spam/Trolls (auto-hidden), Support Complaints (hidden + DM escalated), or Praise.
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={aiModerationEnabled}
                        onClick={() => setAiModerationEnabled((prev) => !prev)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                          aiModerationEnabled ? 'bg-emerald-500' : 'bg-slate-700'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                            aiModerationEnabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Right Column: Public Reply Variations & Private DM Template */}
                <div className="lg:col-span-7 space-y-5">
                  <div className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-5 shadow-xl space-y-5">
                    <div>
                      <h2 className="text-base font-bold text-white">
                        Randomized Public Reply Templates
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Rotated randomly on the ad post to avoid spam detection. Use{' '}
                        <code className="text-indigo-300">{'{name}'}</code> to insert the commenter&apos;s name.
                      </p>
                    </div>

                    <div className="space-y-2.5">
                      {publicReplyTemplates.map((tpl, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <span className="mt-2.5 text-xs font-mono text-slate-500 w-6">
                            #{idx + 1}
                          </span>
                          <input
                            type="text"
                            value={tpl}
                            onChange={(e) =>
                              handleUpdatePublicReplyTemplate(idx, e.target.value)
                            }
                            className="flex-1 rounded-xl border border-slate-800 bg-slate-950/90 px-3.5 py-2 text-xs sm:text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleRemovePublicReplyTemplate(idx)}
                            className="mt-1.5 rounded-lg p-2 text-slate-500 hover:bg-rose-500/10 hover:text-rose-400 transition cursor-pointer"
                            title="Delete template variation"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}

                      <div className="flex items-center gap-2 pt-1 pl-8">
                        <input
                          type="text"
                          value={newPublicReplyInput}
                          onChange={(e) => setNewPublicReplyInput(e.target.value)}
                          placeholder="Add another public reply variation..."
                          className="flex-1 rounded-xl border border-slate-800 bg-slate-950/70 px-3.5 py-2 text-xs sm:text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={handleAddPublicReplyTemplate}
                          className="inline-flex items-center gap-1 rounded-xl bg-slate-800 hover:bg-slate-700 px-3.5 py-2 text-xs font-semibold text-white transition cursor-pointer"
                        >
                          <Plus className="h-4 w-4" />
                          Add Reply
                        </button>
                      </div>
                    </div>

                    {/* Private Inbox DM Template */}
                    <div className="pt-4 border-t border-slate-800">
                      <label className="block text-sm font-bold text-white">
                        Private Inbox DM Message Template (Meta Private Replies API)
                      </label>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Sent directly to the customer&apos;s Messenger / Instagram DM inbox via{' '}
                        <code className="text-slate-300">recipient: {'{ comment_id }'}</code>.
                      </p>
                      <textarea
                        rows={4}
                        value={privateDmTemplate}
                        onChange={(e) => setPrivateDmTemplate(e.target.value)}
                        className="mt-2.5 w-full rounded-xl border border-slate-800 bg-slate-950/90 p-3.5 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
                      />
                    </div>

                    <div className="flex justify-end pt-2">
                      <button
                        type="button"
                        disabled={savingCommentShield}
                        onClick={handleSaveCommentShield}
                        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 px-5 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 transition cursor-pointer"
                      >
                        {savingCommentShield ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                        {savingCommentShield
                          ? 'Saving Comment Shield...'
                          : 'Save Comment Shield Settings'}
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* ================================================================
                3. Live Automation Audit Log (Bottom Panel)
               ================================================================ */}
            <section className="rounded-2xl border border-slate-800/90 bg-slate-900/60 shadow-xl overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-slate-800">
                <div className="flex items-center gap-2.5">
                  <Activity className="h-4 w-4 text-indigo-400" />
                  <div>
                    <h2 className="text-base font-bold text-white">
                      Live Automation Audit Log
                    </h2>
                    <p className="text-xs text-slate-400">
                      Real-time feed from <code className="text-slate-300">mkt_automation_logs</code> showing every Watchdog and Comment Shield action
                    </p>
                  </div>
                </div>

                {/* Filter Pills: All | Auto-Paused Ads | Comment DMs Sent | Spam Hidden */}
                <div className="flex flex-wrap items-center gap-2">
                  {(
                    [
                      { id: 'ALL', label: 'All' },
                      { id: 'AUTO_PAUSED_ADS', label: 'Auto-Paused Ads' },
                      { id: 'COMMENT_DMS_SENT', label: 'Comment DMs Sent' },
                      { id: 'SPAM_HIDDEN', label: 'Spam Hidden' },
                    ] as const
                  ).map((pill) => (
                    <button
                      key={pill.id}
                      type="button"
                      onClick={() => setLogFilter(pill.id)}
                      className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                        logFilter === pill.id
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-950/80 text-slate-400 hover:text-slate-200 border border-slate-800'
                      }`}
                    >
                      {pill.label}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => fetchAllAutomationData(true)}
                    className="rounded-xl border border-slate-800 bg-slate-950/80 p-2 text-slate-400 hover:text-white transition cursor-pointer"
                    title="Refresh audit logs"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full border-collapse text-left">
                  <thead className="sticky top-0 bg-slate-950/95 backdrop-blur border-b border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="py-3 pl-5 pr-3 w-44">Timestamp</th>
                      <th className="py-3 px-3 w-36">Module</th>
                      <th className="py-3 px-3 w-56">Action Taken</th>
                      <th className="py-3 px-3 w-64">Target Ad / Comment</th>
                      <th className="py-3 pl-3 pr-5">Reason &amp; Diagnostic Context</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 text-xs sm:text-sm">
                    {filteredLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-slate-400">
                          No automation events recorded for this filter yet.
                        </td>
                      </tr>
                    ) : (
                      filteredLogs.map((log) => {
                        const isWatchdog = log.module === 'WATCHDOG';
                        const isPaused = log.action_taken === 'PAUSED_AD';
                        const isProtectedSkip = log.action_taken.includes('SKIPPED_PAUSE');
                        const isSpamHidden = log.action_taken.includes('SPAM');

                        return (
                          <tr key={log.id} className="hover:bg-slate-800/35 transition-colors">
                            <td className="py-3 pl-5 pr-3 font-mono text-xs text-slate-400 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5">
                                <Clock className="h-3.5 w-3.5 text-slate-500" />
                                {new Date(log.created_at).toLocaleString('en-PH', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                })}
                              </span>
                            </td>

                            <td className="py-3 px-3 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold ${
                                  isWatchdog
                                    ? 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30'
                                    : 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30'
                                }`}
                              >
                                {log.module}
                              </span>
                            </td>

                            <td className="py-3 px-3 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold ${
                                  isPaused
                                    ? 'bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/40'
                                    : isProtectedSkip
                                      ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                                      : isSpamHidden
                                        ? 'bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/40'
                                        : 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
                                }`}
                              >
                                {log.action_taken}
                              </span>
                            </td>

                            <td className="py-3 px-3">
                              <div className="font-semibold text-white truncate max-w-[240px]">
                                {log.target_name || log.target_id}
                              </div>
                              <div className="font-mono text-[11px] text-slate-500 truncate max-w-[240px]">
                                ID: {log.target_id}
                              </div>
                            </td>

                            <td className="py-3 pl-3 pr-5 text-slate-300 leading-relaxed">
                              {log.reason || 'Automated rule execution'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

