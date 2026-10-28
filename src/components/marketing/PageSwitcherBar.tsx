'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  ChevronDown,
  Facebook,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { MktConnectedPageRow } from '@/lib/meta-engine/types';

interface ActivePageInfo {
  pageId: string;
  pageName: string;
  category: string;
  pictureUrl: string | null;
}

interface PageSwitcherBarProps {
  onPageChanged?: (newPageId: string, newPageName: string) => void;
}

export default function PageSwitcherBar({ onPageChanged }: PageSwitcherBarProps) {
  const [pages, setPages] = useState<MktConnectedPageRow[]>([]);
  const [activePage, setActivePage] = useState<ActivePageInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  // Modal State
  const [showModal, setShowModal] = useState<boolean>(false);
  const [newPageId, setNewPageId] = useState<string>('');
  const [newPageName, setNewPageName] = useState<string>('');
  const [newAccessToken, setNewAccessToken] = useState<string>('');
  const [newAdAccountId, setNewAdAccountId] = useState<string>('');
  const [discoverToken, setDiscoverToken] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [discovering, setDiscovering] = useState<boolean>(false);
  const [notice, setNotice] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const loadPages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/marketing/pages', { cache: 'no-store' });
      const data = (await res.json()) as {
        pages?: MktConnectedPageRow[];
        activePage?: ActivePageInfo;
      };
      if (res.ok) {
        setPages(data.pages || []);
        if (data.activePage) {
          setActivePage(data.activePage);
        }
      }
    } catch {
      // ignore initial load error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPages();
  }, [loadPages]);

  const handleSwitchPage = async (targetPageId: string) => {
    if (!targetPageId || targetPageId === activePage?.pageId || switchingId) return;
    setSwitchingId(targetPageId);
    setNotice(null);

    try {
      const res = await fetch('/api/marketing/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'SWITCH_ACTIVE_PAGE',
          pageId: targetPageId,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        pages?: MktConnectedPageRow[];
        activePage?: ActivePageInfo;
        error?: string;
      };
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed switching Facebook Page.');
      }

      setPages(data.pages || []);
      if (data.activePage) {
        setActivePage(data.activePage);
        onPageChanged?.(data.activePage.pageId, data.activePage.pageName);
      }
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to switch Page.',
      });
    } finally {
      setSwitchingId(null);
    }
  };

  const handleAddPage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPageId.trim() || !newAccessToken.trim() || submitting) return;
    setSubmitting(true);
    setNotice(null);

    try {
      const res = await fetch('/api/marketing/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ADD_PAGE',
          pageId: newPageId.trim(),
          accessToken: newAccessToken.trim(),
          pageName: newPageName.trim() || undefined,
          adAccountId: newAdAccountId.trim() || undefined,
        }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        pages?: MktConnectedPageRow[];
        activePage?: ActivePageInfo;
        error?: string;
      };

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed connecting Facebook Page.');
      }

      setPages(data.pages || []);
      if (data.activePage) {
        setActivePage(data.activePage);
        onPageChanged?.(data.activePage.pageId, data.activePage.pageName);
      }

      setNewPageId('');
      setNewPageName('');
      setNewAccessToken('');
      setNewAdAccountId('');
      setNotice({
        type: 'success',
        text: `Connected "${data.activePage?.pageName || newPageId}" and initialized its dedicated AI Knowledge Base!`,
      });
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to connect Page.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAutoDiscoverPages = async () => {
    if (discovering) return;
    setDiscovering(true);
    setNotice(null);

    try {
      const res = await fetch('/api/marketing/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'AUTO_DISCOVER_PAGES',
          userAccessToken: discoverToken.trim() || undefined,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        discoveredCount?: number;
        pages?: MktConnectedPageRow[];
        activePage?: ActivePageInfo;
        error?: string;
      };

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed auto-discovering Pages.');
      }

      setPages(data.pages || []);
      if (data.activePage) {
        setActivePage(data.activePage);
        onPageChanged?.(data.activePage.pageId, data.activePage.pageName);
      }

      setNotice({
        type: 'success',
        text: `Synced ${data.discoveredCount ?? 0} Facebook Page(s) from Meta Graph API!`,
      });
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Auto-discovery failed.',
      });
    } finally {
      setDiscovering(false);
    }
  };

  const handleDeletePage = async (pageIdToDelete: string) => {
    if (pages.length <= 1) {
      setNotice({
        type: 'error',
        text: 'Keep at least 1 connected Facebook Page in your workspace.',
      });
      return;
    }

    try {
      const res = await fetch('/api/marketing/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'DELETE_PAGE',
          pageId: pageIdToDelete,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        pages?: MktConnectedPageRow[];
        activePage?: ActivePageInfo;
      };
      if (res.ok && data.success) {
        setPages(data.pages || []);
        if (data.activePage) {
          setActivePage(data.activePage);
          onPageChanged?.(data.activePage.pageId, data.activePage.pageName);
        }
      }
    } catch {
      // ignore
    }
  };

  return (
    <>
      <div className="inline-flex flex-wrap items-center gap-2 rounded-xl border border-indigo-500/35 bg-slate-950/90 px-3 py-1.5 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-full bg-indigo-600/30 border border-indigo-400/40 overflow-hidden flex items-center justify-center shrink-0">
            {activePage?.pictureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={activePage.pictureUrl}
                alt={activePage.pageName}
                className="h-full w-full object-cover"
              />
            ) : (
              <Facebook className="h-3.5 w-3.5 text-indigo-300" />
            )}
          </div>

          <div className="relative">
            <select
              value={activePage?.pageId || ''}
              disabled={loading || Boolean(switchingId)}
              onChange={(e) => handleSwitchPage(e.target.value)}
              className="appearance-none bg-transparent pr-5 text-xs font-bold text-white focus:outline-none cursor-pointer"
              title="Switch active Facebook Page"
            >
              {pages.map((p) => (
                <option
                  key={p.page_id}
                  value={p.page_id}
                  className="bg-slate-900 text-white"
                >
                  {p.page_name} (#{p.page_id.slice(-6)})
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setNotice(null);
            setNewPageId('');
            setNewPageName('');
            setNewAccessToken('');
            setNewAdAccountId('');
            setDiscoverToken('');
            setShowModal(true);
          }}
          className="inline-flex items-center gap-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 px-2 py-1 text-[11px] font-bold text-indigo-300 ring-1 ring-indigo-500/30 transition cursor-pointer"
        >
          <Plus className="h-3 w-3" />
          Add / Manage Pages ({pages.length})
        </button>
      </div>

      {/* Multi-Page Manager Modal rendered in document.body portal so parent backdrop-blur never clips it */}
      {showModal &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/85 p-4 sm:p-6 backdrop-blur-sm overflow-y-auto"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowModal(false);
            }}
          >
            <div className="my-auto w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-700/80 bg-slate-900 p-6 shadow-2xl space-y-6 text-slate-100">
              <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                  <h2 className="text-lg font-extrabold text-white flex items-center gap-2">
                    <Facebook className="h-5 w-5 text-indigo-400" />
                    Multi-Page Manager &amp; 24/7 AI Knowledge Router
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Connect unlimited Facebook Pages. Each Page gets its own isolated Inbox, Post Feed, and AI Business Knowledge Base—while Webhooks &amp; Comment Shield run on ALL connected Pages simultaneously 24/7.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer shrink-0"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {notice && (
                <div
                  className={`rounded-xl border p-3.5 text-xs font-semibold flex items-center gap-2 ${
                    notice.type === 'success'
                      ? 'border-emerald-500/40 bg-emerald-950/50 text-emerald-200'
                      : 'border-rose-500/40 bg-rose-950/50 text-rose-200'
                  }`}
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{notice.text}</span>
                </div>
              )}

              {/* Connected Pages List */}
              <div className="space-y-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Connected Facebook Pages ({pages.length})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {pages.map((p) => {
                    const isCurrent = p.page_id === activePage?.pageId || p.is_active;
                    return (
                      <div
                        key={p.page_id}
                        className={`flex items-center justify-between gap-3 rounded-xl border p-3.5 transition ${
                          isCurrent
                            ? 'border-indigo-500/60 bg-indigo-950/30'
                            : 'border-slate-800 bg-slate-950/70'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-10 w-10 rounded-full bg-indigo-600/20 border border-indigo-500/30 overflow-hidden flex items-center justify-center shrink-0">
                            {p.picture_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={p.picture_url}
                                alt={p.page_name}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <Facebook className="h-5 w-5 text-indigo-300" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-bold text-white truncate">
                                {p.page_name}
                              </p>
                              {isCurrent && (
                                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-500/30">
                                  ACTIVE
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-400 truncate">
                              {p.category || 'Facebook Page'} • ID: {p.page_id}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {!isCurrent && (
                            <button
                              type="button"
                              onClick={() => handleSwitchPage(p.page_id)}
                              className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-2.5 py-1.5 text-[11px] font-bold text-white transition cursor-pointer"
                            >
                              Switch
                            </button>
                          )}
                          {pages.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleDeletePage(p.page_id)}
                              className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/15 hover:text-rose-300 transition cursor-pointer"
                              title="Remove Page"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Option A: 1-Click Auto-Discover via User / System Token */}
              <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4" />
                    Option 1: Auto-Discover All Pages from Meta Token (GET /v21.0/me/accounts)
                  </h3>
                </div>
                <p className="text-xs text-slate-300">
                  If you have a Meta User or System User Access Token that manages multiple Pages, paste it below (or leave blank to check your default token) to import all Pages and their Page Tokens automatically.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    name="meta_user_discover_token"
                    autoComplete="off"
                    spellCheck={false}
                    value={discoverToken}
                    onChange={(e) => setDiscoverToken(e.target.value)}
                    placeholder="Optional: Paste User / System User Access Token (EAA...)"
                    className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs font-mono text-white placeholder-slate-500"
                  />
                  <button
                    type="button"
                    disabled={discovering}
                    onClick={handleAutoDiscoverPages}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-bold text-white transition cursor-pointer shrink-0"
                  >
                    {discovering ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    Auto-Discover My Pages
                  </button>
                </div>
              </div>

              {/* Option B: Connect a Specific Facebook Page */}
              <form
                onSubmit={handleAddPage}
                autoComplete="off"
                className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-4"
              >
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Plus className="h-4 w-4 text-emerald-400" />
                  Option 2: Connect Another Facebook Page Manually
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-400">
                      Facebook Page ID *
                    </label>
                    <input
                      type="text"
                      name="meta_new_page_id"
                      autoComplete="off"
                      required
                      value={newPageId}
                      onChange={(e) => setNewPageId(e.target.value)}
                      placeholder="e.g. 123456789012345"
                      className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-400">
                      Page Label / Name (Auto-detected if blank)
                    </label>
                    <input
                      type="text"
                      name="meta_new_page_label"
                      autoComplete="off"
                      value={newPageName}
                      onChange={(e) => setNewPageName(e.target.value)}
                      placeholder="e.g. The Fun Roof / Second Page"
                      className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-400">
                      Page Access Token (EAA...) *
                    </label>
                    <input
                      type="text"
                      name="meta_new_page_token"
                      autoComplete="off"
                      spellCheck={false}
                      required
                      value={newAccessToken}
                      onChange={(e) => setNewAccessToken(e.target.value)}
                      placeholder="Paste Page Access Token (EAA...)"
                      className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-mono text-white placeholder-slate-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-400">
                      Linked Ad Account ID (Optional)
                    </label>
                    <input
                      type="text"
                      name="meta_new_ad_account_id"
                      autoComplete="off"
                      value={newAdAccountId}
                      onChange={(e) => setNewAdAccountId(e.target.value)}
                      placeholder="e.g. act_1251636213594805"
                      className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500"
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-600/20 transition cursor-pointer"
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Connect Page &amp; Initialize AI Brain
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

