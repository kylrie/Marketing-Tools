'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BadgeDollarSign,
  Bot,
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  MessageSquare,
  RefreshCw,
  Rocket,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Video,
  Wand2,
  X,
  XCircle,
} from 'lucide-react';
import type { InboxConversationThread } from '@/lib/meta-engine/meta-inbox-posts';
import PageSwitcherBar from '@/components/marketing/PageSwitcherBar';
import type {
  MktAdCatalogRow,
  MktBusinessKnowledgeRow,
  MktCrmStage,
  MktToneOfVoice,
} from '@/lib/meta-engine/types';

const CRM_STAGE_OPTIONS: Array<{
  value: MktCrmStage;
  label: string;
  color: string;
}> = [
  {
    value: 'NEW_INQUIRY',
    label: 'New Inquiry',
    color: 'bg-slate-800 text-slate-200 ring-slate-700',
  },
  {
    value: 'QUALIFIED',
    label: 'CRM Qualified (CAPI Lead)',
    color: 'bg-sky-500/20 text-sky-300 ring-sky-500/40',
  },
  {
    value: 'PENDING',
    label: 'Pending Pipeline (₱)',
    color: 'bg-amber-500/20 text-amber-300 ring-amber-500/40',
  },
  {
    value: 'WON',
    label: 'Closed Won (CAPI Purchase)',
    color: 'bg-emerald-500/20 text-emerald-300 ring-emerald-500/40',
  },
  {
    value: 'LOST',
    label: 'Closed Lost',
    color: 'bg-rose-500/20 text-rose-300 ring-rose-500/40',
  },
];

function getFallbackAvatar(name: string): string {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(
    name || 'User'
  )}&background=312e81&color=e0e7ff&bold=true&size=128`;
}

export default function OmnichannelInboxPage() {
  const [loading, setLoading] = useState<boolean>(true);
  const [threads, setThreads] = useState<InboxConversationThread[]>([]);
  const [catalogAds, setCatalogAds] = useState<MktAdCatalogRow[]>([]);
  const [selectedPsid, setSelectedPsid] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [platformTab, setPlatformTab] = useState<'ALL' | 'MESSENGER' | 'INSTAGRAM'>('ALL');
  const [stageFilter, setStageFilter] = useState<string>('ALL');

  // Track which threads the user has opened/read in this browser session (keyed by psid -> updatedTime)
  const [readThreadsMap, setReadThreadsMap] = useState<Record<string, string>>({});

  // Composer State (Text + Photo / Video Upload)
  const [replyText, setReplyText] = useState<string>('');
  const [attachedMediaType, setAttachedMediaType] = useState<'IMAGE' | 'VIDEO' | null>(null);
  const [attachedMediaDataUrl, setAttachedMediaDataUrl] = useState<string | null>(null);
  const [attachedMediaName, setAttachedMediaName] = useState<string>('');
  const [attachedMediaMime, setAttachedMediaMime] = useState<string>('');
  const [sendingMessage, setSendingMessage] = useState<boolean>(false);

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  // Right-Hand CRM Sidebar State
  const [editStage, setEditStage] = useState<MktCrmStage>('NEW_INQUIRY');
  const [editDealValue, setEditDealValue] = useState<string>('0');
  const [editSourceAdId, setEditSourceAdId] = useState<string>('');
  const [savingCrm, setSavingCrm] = useState<boolean>(false);

  // Business Profile & AI Knowledge Bot State
  const [showKnowledgeModal, setShowKnowledgeModal] = useState<boolean>(false);
  const [knowledge, setKnowledge] = useState<MktBusinessKnowledgeRow | null>(null);
  const [savingKnowledge, setSavingKnowledge] = useState<boolean>(false);
  const [syncingPageProfile, setSyncingPageProfile] = useState<boolean>(false);
  const [generatingAiReply, setGeneratingAiReply] = useState<boolean>(false);

  // Toast Notification
  const [toast, setToast] = useState<{
    type: 'success' | 'error';
    title: string;
    message: string;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('mkt_inbox_read_threads');
      if (saved) {
        setReadThreadsMap(JSON.parse(saved) as Record<string, string>);
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  const markThreadAsRead = useCallback((psid: string, updatedTime: string) => {
    setReadThreadsMap((prev) => {
      if (prev[psid] === updatedTime) return prev;
      const next = { ...prev, [psid]: updatedTime };
      try {
        localStorage.setItem('mkt_inbox_read_threads', JSON.stringify(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }, []);

  const showToast = useCallback(
    (type: 'success' | 'error', title: string, message: string) => {
      setToast({ type, title, message });
      setTimeout(() => setToast(null), 5000);
    },
    []
  );

  const loadInboxData = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await fetch('/api/marketing/inbox', { cache: 'no-store' });
        const data = (await res.json()) as {
          threads?: InboxConversationThread[];
          catalogAds?: MktAdCatalogRow[];
          error?: string;
        };

        if (!res.ok) {
          throw new Error(data.error || 'Failed loading inbox.');
        }

        const loadedThreads = data.threads || [];
        setThreads(loadedThreads);
        setCatalogAds(data.catalogAds || []);

        if (loadedThreads.length > 0) {
          setSelectedPsid((prev) => {
            const target =
              prev && loadedThreads.some((t) => t.customerPsid === prev)
                ? prev
                : loadedThreads[0].customerPsid;
            const found = loadedThreads.find((t) => t.customerPsid === target);
            if (found) {
              setEditStage(found.crmStage);
              setEditDealValue(String(found.dealValuePhp || 0));
              setEditSourceAdId(found.sourceAdId || '');
            }
            return target;
          });
        }
      } catch (err) {
        showToast(
          'error',
          'Inbox Sync Error',
          err instanceof Error ? err.message : 'Unable to fetch conversations.'
        );
      } finally {
        setLoading(false);
      }
    },
    [showToast]
  );

  const loadKnowledge = useCallback(async () => {
    try {
      const r = await fetch('/api/marketing/knowledge', { cache: 'no-store' });
      const d = (await r.json()) as { knowledge?: MktBusinessKnowledgeRow };
      if (d.knowledge) setKnowledge(d.knowledge);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadInboxData();
    loadKnowledge();
  }, [loadInboxData, loadKnowledge]);

  // Helper to check if a thread needs a "Ghost Buster" follow-up
  const needsFollowUp = useCallback((thread: InboxConversationThread): boolean => {
    if (thread.crmStage === 'WON' || thread.crmStage === 'LOST') return false;
    const lastMsg = thread.messages[thread.messages.length - 1];
    if (!lastMsg) return false;
    return lastMsg.isFromPage;
  }, []);

  // Helper to compute effective unread count for a thread
  const getEffectiveUnreadCount = useCallback(
    (thread: InboxConversationThread): number => {
      if (!thread.unreadCount || thread.unreadCount <= 0) return 0;
      const lastReadTimestamp = readThreadsMap[thread.customerPsid];
      if (
        lastReadTimestamp &&
        new Date(lastReadTimestamp).getTime() >= new Date(thread.updatedTime).getTime()
      ) {
        return 0;
      }
      return thread.unreadCount;
    },
    [readThreadsMap]
  );

  // Platform counts & unread badge totals
  const platformSummary = useMemo(() => {
    let messengerThreads = 0;
    let messengerUnread = 0;
    let instagramThreads = 0;
    let instagramUnread = 0;

    for (const t of threads) {
      const unread = getEffectiveUnreadCount(t);
      if (t.platform === 'INSTAGRAM') {
        instagramThreads += 1;
        instagramUnread += unread;
      } else {
        messengerThreads += 1;
        messengerUnread += unread;
      }
    }

    return {
      allThreads: threads.length,
      allUnread: messengerUnread + instagramUnread,
      messengerThreads,
      messengerUnread,
      instagramThreads,
      instagramUnread,
    };
  }, [threads, getEffectiveUnreadCount]);

  const activeThread = useMemo(
    () => threads.find((t) => t.customerPsid === selectedPsid) || null,
    [threads, selectedPsid]
  );

  useEffect(() => {
    if (activeThread) {
      setEditStage(activeThread.crmStage);
      setEditDealValue(String(activeThread.dealValuePhp || 0));
      setEditSourceAdId(activeThread.sourceAdId || '');
    }
  }, [activeThread]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeThread?.messages.length]);

  const filteredThreads = useMemo(() => {
    return threads.filter((t) => {
      if (platformTab !== 'ALL' && t.platform !== platformTab) {
        return false;
      }
      if (stageFilter === 'FOLLOW_UP') {
        if (!needsFollowUp(t)) return false;
      } else if (stageFilter !== 'ALL' && t.crmStage !== stageFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          t.customerName.toLowerCase().includes(q) ||
          t.customerPsid.toLowerCase().includes(q) ||
          t.snippet.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [threads, platformTab, stageFilter, searchQuery, needsFollowUp]);

  const handleGenerateKnowledgeDraft = async () => {
    if (!activeThread || generatingAiReply) return;
    setGeneratingAiReply(true);

    try {
      const lastCustomerMsg =
        [...activeThread.messages].reverse().find((m) => !m.isFromPage)?.message ||
        activeThread.snippet ||
        'how much?';

      const recentHistory = activeThread.messages.slice(-6).map((m) => ({
        sender: m.isFromPage ? 'Page' : activeThread.customerName,
        text: m.message,
      }));

      const res = await fetch('/api/marketing/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'GENERATE_BOT_REPLY',
          customerName: activeThread.customerName,
          customerMessage: lastCustomerMsg,
          channel: 'DM',
          recentMessages: recentHistory,
        }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        replyText?: string;
        matchedTopic?: string;
        error?: string;
      };

      if (!res.ok || !data.replyText) {
        throw new Error(data.error || 'Failed generating AI Knowledge reply.');
      }

      setReplyText(data.replyText);
      showToast(
        'success',
        'AI Knowledge Reply Drafted',
        `Matched Business Profile (${data.matchedTopic || 'Knowledge Base'}). Review and click Send!`
      );
    } catch (err) {
      showToast(
        'error',
        'AI Reply Error',
        err instanceof Error ? err.message : 'Unable to generate reply.'
      );
    } finally {
      setGeneratingAiReply(false);
    }
  };

  const handleSyncFromMetaPage = async () => {
    if (syncingPageProfile) return;
    setSyncingPageProfile(true);
    try {
      const res = await fetch('/api/marketing/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'SYNC_FROM_META_PAGE' }),
      });
      const data = (await res.json()) as {
        knowledge?: MktBusinessKnowledgeRow;
        error?: string;
      };
      if (!res.ok || !data.knowledge) {
        throw new Error(data.error || 'Failed syncing from Facebook Page.');
      }
      setKnowledge(data.knowledge);
      showToast(
        'success',
        'Synced from Facebook Page!',
        `Imported live Page profile for "${data.knowledge.business_name}".`
      );
    } catch (err) {
      showToast(
        'error',
        'Page Sync Failed',
        err instanceof Error ? err.message : 'Unable to sync Page profile.'
      );
    } finally {
      setSyncingPageProfile(false);
    }
  };

  const handleSaveKnowledge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!knowledge || savingKnowledge) return;
    setSavingKnowledge(true);
    try {
      const res = await fetch('/api/marketing/knowledge', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(knowledge),
      });
      const data = (await res.json()) as {
        knowledge?: MktBusinessKnowledgeRow;
        error?: string;
      };
      if (!res.ok || !data.knowledge) {
        throw new Error(data.error || 'Failed saving Business Knowledge.');
      }
      setKnowledge(data.knowledge);
      setShowKnowledgeModal(false);
      showToast(
        'success',
        'Business Knowledge Saved!',
        'Your AI Bot will now answer DMs & comments using this profile.'
      );
    } catch (err) {
      showToast(
        'error',
        'Save Failed',
        err instanceof Error ? err.message : 'Unable to save Knowledge Base.'
      );
    } finally {
      setSavingKnowledge(false);
    }
  };

  const handleSelectThread = (thread: InboxConversationThread) => {
    setSelectedPsid(thread.customerPsid);
    markThreadAsRead(thread.customerPsid, thread.updatedTime);
  };

  const handleFileAttachmentSelect = (
    e: React.ChangeEvent<HTMLInputElement>,
    mediaType: 'IMAGE' | 'VIDEO'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxBytes = mediaType === 'VIDEO' ? 25 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      showToast(
        'error',
        'File Too Large',
        mediaType === 'VIDEO'
          ? 'Please select a video under 25 MB.'
          : 'Please select an image under 10 MB.'
      );
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setAttachedMediaType(mediaType);
        setAttachedMediaDataUrl(reader.result);
        setAttachedMediaName(file.name);
        setAttachedMediaMime(file.type || (mediaType === 'VIDEO' ? 'video/mp4' : 'image/jpeg'));
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const clearAttachedMedia = () => {
    setAttachedMediaType(null);
    setAttachedMediaDataUrl(null);
    setAttachedMediaName('');
    setAttachedMediaMime('');
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !activeThread ||
      (!replyText.trim() && !attachedMediaDataUrl) ||
      sendingMessage
    ) {
      return;
    }

    setSendingMessage(true);
    const textToSend = replyText.trim();

    try {
      const res = await fetch('/api/marketing/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'SEND_MESSAGE',
          customerPsid: activeThread.customerPsid,
          customerName: activeThread.customerName,
          platform: activeThread.platform,
          messageText: textToSend,
          threadId: activeThread.threadId,
          mediaType: attachedMediaType,
          mediaUrlOrBase64: attachedMediaDataUrl,
          mediaFileName: attachedMediaName,
          mediaMimeType: attachedMediaMime,
        }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        messageId?: string;
        sentAt?: string;
        deliveryMode?: 'LIVE_GRAPH_API' | 'SANDBOX_STORED';
        metaNotice?: string;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error || 'Failed sending message.');
      }

      setReplyText('');
      clearAttachedMedia();
      markThreadAsRead(activeThread.customerPsid, new Date().toISOString());
      await loadInboxData(true);

      if (data.deliveryMode === 'LIVE_GRAPH_API') {
        showToast(
          'success',
          'Sent to Meta Inbox',
          `Delivered live to ${activeThread.customerName} via Meta Graph API.`
        );
      } else {
        showToast(
          'success',
          'Recorded in Thread (Sandbox / 24h Window)',
          data.metaNotice || 'Stored in thread history.'
        );
      }
    } catch (err) {
      showToast(
        'error',
        'Message Failed',
        err instanceof Error ? err.message : 'Unable to send reply.'
      );
    } finally {
      setSendingMessage(false);
    }
  };

  const handleSaveCrmAttribution = async () => {
    if (!activeThread || savingCrm) return;
    setSavingCrm(true);

    try {
      const res = await fetch('/api/marketing/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'UPDATE_CRM_STAGE',
          customerPsid: activeThread.customerPsid,
          customerName: activeThread.customerName,
          platform: activeThread.platform,
          crmStage: editStage,
          dealValuePhp: Number(editDealValue || 0),
          sourceAdId: editSourceAdId || null,
        }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        capiDispatched?: string | null;
        capiError?: string | null;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error || 'Failed updating CRM stage.');
      }

      await loadInboxData(true);

      showToast(
        'success',
        data.capiDispatched
          ? `CRM Stage Saved + Meta CAPI "${data.capiDispatched}" Fired!`
          : 'CRM Attribution Updated',
        `Updated ${activeThread.customerName} to ${editStage} (₱${Number(
          editDealValue || 0
        ).toLocaleString()}). Attribution dashboard updated.`
      );
    } catch (err) {
      showToast(
        'error',
        'CRM Update Failed',
        err instanceof Error ? err.message : 'Could not update CRM stage.'
      );
    } finally {
      setSavingCrm(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-5 right-5 z-50 max-w-md rounded-2xl border border-slate-700 bg-slate-900/95 p-4 shadow-2xl backdrop-blur">
          <div className="flex items-start gap-3">
            {toast.type === 'success' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="h-5 w-5 text-rose-400 shrink-0 mt-0.5" />
            )}
            <div>
              <p className="text-sm font-bold text-white">{toast.title}</p>
              <p className="mt-0.5 text-xs text-slate-300">{toast.message}</p>
            </div>
          </div>
        </div>
      )}

      {/* Top Navigation Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/70 px-6 py-4">
        <div className="mx-auto max-w-[1600px] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/marketing/attribution"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-indigo-500/50 hover:text-white transition"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Command Center
            </Link>
            <div>
              <h1 className="text-lg sm:text-xl font-extrabold text-white flex items-center gap-2">
                <MessageCircle className="h-5 w-5 text-indigo-400" />
                Omnichannel Messenger &amp; IG Inbox + CRM Deal Closer
              </h1>
              <p className="text-xs text-slate-400">
                Active Page: <strong className="text-slate-200">{knowledge?.business_name || 'Connected Page'}</strong> ({knowledge?.page_id || 'Multi-Page Ready'}) • Reply with text, photos &amp; videos, assign Source Ads, and log Closed Won sales
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <PageSwitcherBar
              onPageChanged={() => {
                loadInboxData();
                loadKnowledge();
              }}
            />
            <button
              type="button"
              onClick={() => setShowKnowledgeModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-500/15 hover:bg-indigo-500/25 px-3.5 py-2 text-xs font-bold text-indigo-200 transition cursor-pointer"
            >
              <Bot className="h-3.5 w-3.5 text-indigo-300" />
              🧠 AI Business Knowledge Bot
              {knowledge?.auto_reply_dms && (
                <span className="ml-1 rounded-full bg-emerald-500/30 px-1.5 py-0.2 text-[10px] text-emerald-300">
                  ON
                </span>
              )}
            </button>
            <Link
              href="/marketing/posts"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:border-indigo-500/50 hover:text-white transition"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              Post Publisher
            </Link>
            <Link
              href="/marketing/launcher"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:border-indigo-500/50 hover:text-white transition"
            >
              <Rocket className="h-3.5 w-3.5 text-emerald-400" />
              Ad Launcher
            </Link>
            <button
              type="button"
              onClick={() => loadInboxData()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-600/20 transition cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Sync Meta Inbox
            </button>
          </div>
        </div>
      </header>

      {/* Main 3-Column Workspace */}
      <div className="mx-auto max-w-[1600px] w-full flex-1 grid grid-cols-1 lg:grid-cols-12 gap-0 border-x border-slate-800/60">
        {/* ====================================================================
            LEFT COLUMN (3 cols): Channel Tabs + Conversation Threads List
           ==================================================================== */}
        <aside className="lg:col-span-3 border-r border-slate-800/80 bg-slate-900/40 flex flex-col h-[calc(100vh-76px)]">
          <div className="p-4 border-b border-slate-800/80 space-y-3">
            {/* Separate Platform Tabs: All / FB Messenger / Instagram with Unread Badges */}
            <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-slate-950 p-1 border border-slate-800">
              <button
                type="button"
                onClick={() => setPlatformTab('ALL')}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 px-2 text-xs font-bold transition cursor-pointer ${
                  platformTab === 'ALL'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>All ({platformSummary.allThreads})</span>
                {platformSummary.allUnread > 0 && (
                  <span className="inline-flex items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.2 text-[10px] font-extrabold text-white">
                    {platformSummary.allUnread}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setPlatformTab('MESSENGER')}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 px-2 text-xs font-bold transition cursor-pointer ${
                  platformTab === 'MESSENGER'
                    ? 'bg-sky-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>FB ({platformSummary.messengerThreads})</span>
                {platformSummary.messengerUnread > 0 && (
                  <span className="inline-flex items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.2 text-[10px] font-extrabold text-white">
                    {platformSummary.messengerUnread}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setPlatformTab('INSTAGRAM')}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-2 px-2 text-xs font-bold transition cursor-pointer ${
                  platformTab === 'INSTAGRAM'
                    ? 'bg-pink-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>IG ({platformSummary.instagramThreads})</span>
                {platformSummary.instagramUnread > 0 && (
                  <span className="inline-flex items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.2 text-[10px] font-extrabold text-white">
                    {platformSummary.instagramUnread}
                  </span>
                )}
              </button>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="h-4 w-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                name="inbox_thread_search"
                autoComplete="off"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search customer name or message..."
                className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {/* CRM Stage + Ghost Buster Filter Pills */}
            <div className="flex flex-wrap gap-1.5">
              {(
                ['ALL', 'FOLLOW_UP', 'NEW_INQUIRY', 'QUALIFIED', 'PENDING', 'WON'] as const
              ).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStageFilter(st)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
                    stageFilter === st
                      ? st === 'FOLLOW_UP'
                        ? 'bg-amber-500 text-slate-950'
                        : 'bg-indigo-600 text-white'
                      : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  {st === 'ALL'
                    ? 'All Stages'
                    : st === 'FOLLOW_UP'
                    ? `👻 Follow-Up (${threads.filter((t) => needsFollowUp(t)).length})`
                    : st.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
            {loading ? (
              <div className="py-16 text-center">
                <Loader2 className="h-6 w-6 animate-spin text-indigo-400 mx-auto" />
                <p className="mt-2 text-xs text-slate-400">
                  Pulling live Messenger &amp; IG threads from Meta...
                </p>
              </div>
            ) : filteredThreads.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No conversations match the selected channel or stage filter.
              </div>
            ) : (
              filteredThreads.map((thread) => {
                const isSelected = thread.customerPsid === selectedPsid;
                const unread = getEffectiveUnreadCount(thread);
                const stageMeta =
                  CRM_STAGE_OPTIONS.find((s) => s.value === thread.crmStage) ||
                  CRM_STAGE_OPTIONS[0];

                return (
                  <button
                    key={thread.customerPsid}
                    type="button"
                    onClick={() => handleSelectThread(thread)}
                    className={`w-full text-left p-4 transition flex flex-col gap-2 cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-600/15 border-l-4 border-l-indigo-500'
                        : unread > 0
                        ? 'bg-slate-900/90 hover:bg-slate-900'
                        : 'hover:bg-slate-900/80'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="relative shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={
                              thread.customerAvatarUrl ||
                              getFallbackAvatar(thread.customerName)
                            }
                            alt={thread.customerName}
                            onError={(e) => {
                              e.currentTarget.src = getFallbackAvatar(thread.customerName);
                            }}
                            className="h-9 w-9 rounded-full object-cover border border-slate-700 bg-slate-800"
                          />
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full flex items-center justify-center text-[8px] font-extrabold text-white ring-2 ring-slate-950 ${
                              thread.platform === 'INSTAGRAM'
                                ? 'bg-pink-600'
                                : 'bg-sky-500'
                            }`}
                            title={thread.platform}
                          >
                            {thread.platform === 'INSTAGRAM' ? 'IG' : 'FB'}
                          </span>
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p
                              className={`text-sm truncate ${
                                unread > 0
                                  ? 'font-extrabold text-white'
                                  : 'font-bold text-slate-100'
                              }`}
                            >
                              {thread.customerName}
                            </p>
                            {unread > 0 && (
                              <span className="inline-flex items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.2 text-[10px] font-extrabold text-white shrink-0">
                                {unread}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-400 font-mono truncate">
                            {thread.platform} • PSID #{thread.customerPsid.slice(-6)}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset shrink-0 ${stageMeta.color}`}
                      >
                        {thread.crmStage}
                      </span>
                    </div>

                    <p
                      className={`text-xs line-clamp-2 leading-relaxed ${
                        unread > 0
                          ? 'font-semibold text-white'
                          : 'text-slate-300'
                      }`}
                    >
                      {thread.snippet}
                    </p>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                      <span className="truncate max-w-[170px] text-indigo-300 font-medium">
                        {thread.sourceAdName
                          ? `🎯 ${thread.sourceAdName}`
                          : 'Organic / Unattributed'}
                      </span>
                      {thread.dealValuePhp > 0 && (
                        <span className="font-bold text-emerald-400">
                          ₱{thread.dealValuePhp.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ====================================================================
            CENTER COLUMN (5 cols): Live Chat Thread & Reply Composer
           ==================================================================== */}
        <section className="lg:col-span-5 border-r border-slate-800/80 bg-slate-950 flex flex-col h-[calc(100vh-76px)]">
          {activeThread ? (
            <>
              {/* Active Chat Header */}
              <div className="p-4 border-b border-slate-800/80 bg-slate-900/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={
                        activeThread.customerAvatarUrl ||
                        getFallbackAvatar(activeThread.customerName)
                      }
                      alt={activeThread.customerName}
                      onError={(e) => {
                        e.currentTarget.src = getFallbackAvatar(activeThread.customerName);
                      }}
                      className="h-10 w-10 rounded-full object-cover border border-indigo-500/40 bg-slate-800"
                    />
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full flex items-center justify-center text-[9px] font-extrabold text-white ring-2 ring-slate-900 ${
                        activeThread.platform === 'INSTAGRAM'
                          ? 'bg-pink-600'
                          : 'bg-sky-500'
                      }`}
                    >
                      {activeThread.platform === 'INSTAGRAM' ? 'IG' : 'FB'}
                    </span>
                  </div>
                  <div>
                    <h2 className="text-sm sm:text-base font-bold text-white">
                      {activeThread.customerName}
                    </h2>
                    <p className="text-xs text-slate-400 font-mono">
                      {activeThread.platform} • PSID: {activeThread.customerPsid}
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                  <MessageSquare className="h-3.5 w-3.5" />
                  {activeThread.messages.length} Messages
                </span>
              </div>

              {/* Message History Scroll Area */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {activeThread.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      msg.isFromPage ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div
                      className={`max-w-[82%] rounded-2xl px-4 py-3 text-xs sm:text-sm leading-relaxed shadow space-y-2 ${
                        msg.isFromPage
                          ? 'bg-indigo-600 text-white rounded-br-none'
                          : 'bg-slate-900 border border-slate-800 text-slate-100 rounded-bl-none'
                      }`}
                    >
                      {msg.message && (
                        <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                      )}

                      {msg.attachmentUrl && (
                        <div className="pt-1">
                          {msg.attachmentType === 'VIDEO' ? (
                            <video
                              src={msg.attachmentUrl}
                              controls
                              className="max-h-60 w-full rounded-xl border border-slate-700/60 bg-black"
                            />
                          ) : (
                            <a
                              href={msg.attachmentUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="block overflow-hidden rounded-xl border border-slate-700/60"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={msg.attachmentUrl}
                                alt="Chat attachment"
                                className="max-h-60 w-full object-cover"
                              />
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                    <span className="mt-1 text-[10px] text-slate-500 px-1">
                      {msg.senderName} •{' '}
                      {new Date(msg.createdTime).toLocaleString('en-PH', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Quick Canned Replies + Media Preview + Reply Input Box */}
              <div className="p-4 border-t border-slate-800/80 bg-slate-900/50 space-y-3">
                {/* Attached Photo / Video Preview Chip */}
                {attachedMediaDataUrl && attachedMediaType && (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-indigo-500/40 bg-indigo-950/30 p-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      {attachedMediaType === 'VIDEO' ? (
                        <video
                          src={attachedMediaDataUrl}
                          className="h-12 w-16 rounded-lg object-cover bg-black border border-slate-700 shrink-0"
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={attachedMediaDataUrl}
                          alt="Upload preview"
                          className="h-12 w-12 rounded-lg object-cover border border-slate-700 shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-indigo-200 truncate">
                          {attachedMediaName || `Attached ${attachedMediaType}`}
                        </p>
                        <p className="text-[11px] text-indigo-300/80">
                          Ready to send via Meta {activeThread.platform}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={clearAttachedMedia}
                      className="rounded-lg bg-slate-900 p-1.5 text-slate-400 hover:text-white transition cursor-pointer"
                      title="Remove attachment"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={generatingAiReply}
                    onClick={handleGenerateKnowledgeDraft}
                    className="inline-flex items-center gap-1 rounded-lg border border-indigo-500/50 bg-indigo-500/20 hover:bg-indigo-500/30 px-2.5 py-1 text-[11px] font-bold text-indigo-200 transition cursor-pointer"
                  >
                    {generatingAiReply ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Wand2 className="h-3 w-3 text-indigo-300" />
                    )}
                    ✨ AI Knowledge Reply
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setReplyText(
                        `Hi ${activeThread.customerName}! 👋 Quick follow-up lang po—gusto niyo po bang i-reserve na namin ang promo slot niyo today bago ma-full? 😊`
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/15 hover:bg-amber-500/25 px-2.5 py-1 text-[11px] font-bold text-amber-200 transition cursor-pointer"
                  >
                    👻 Follow-Up Nudge
                  </button>

                  {[
                    'Hi! Here is our promo rate & package breakdown 💬',
                    'Are you ready to lock in your slot today? ✅',
                    'Thank you! Your order is confirmed & logged! 🎉',
                  ].map((quick, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setReplyText(quick)}
                      className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-[11px] text-slate-300 hover:border-indigo-500/50 hover:text-white transition cursor-pointer"
                    >
                      {quick}
                    </button>
                  ))}
                </div>

                {/* Hidden File Inputs for Photo & Video Upload */}
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleFileAttachmentSelect(e, 'IMAGE')}
                />
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => handleFileAttachmentSelect(e, 'VIDEO')}
                />

                <form onSubmit={handleSendMessage} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={sendingMessage}
                    title="Attach Photo"
                    className="inline-flex items-center justify-center rounded-xl border border-slate-800 bg-slate-950 hover:border-indigo-500/50 p-2.5 text-slate-300 hover:text-indigo-300 transition cursor-pointer shrink-0"
                  >
                    <ImageIcon className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => videoInputRef.current?.click()}
                    disabled={sendingMessage}
                    title="Attach Video"
                    className="inline-flex items-center justify-center rounded-xl border border-slate-800 bg-slate-950 hover:border-indigo-500/50 p-2.5 text-slate-300 hover:text-indigo-300 transition cursor-pointer shrink-0"
                  >
                    <Video className="h-4 w-4" />
                  </button>

                  <input
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder={`Message ${activeThread.customerName} on ${activeThread.platform}...`}
                    className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                  />

                  <button
                    type="submit"
                    disabled={
                      sendingMessage || (!replyText.trim() && !attachedMediaDataUrl)
                    }
                    className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition cursor-pointer shrink-0"
                  >
                    {sendingMessage ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Send
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <MessageCircle className="h-10 w-10 text-slate-600" />
              <p className="mt-3 text-sm font-semibold text-slate-300">
                Select a conversation on the left to view messages
              </p>
            </div>
          )}
        </section>

        {/* ====================================================================
            RIGHT COLUMN (4 cols): Ad Attribution & CRM Deal Closing Sidebar
           ==================================================================== */}
        <aside className="lg:col-span-4 bg-slate-900/40 p-6 overflow-y-auto h-[calc(100vh-76px)] space-y-6">
          {activeThread ? (
            <>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-5 space-y-4">
                <div className="flex items-center gap-2.5">
                  <Target className="h-5 w-5 text-indigo-400" />
                  <div>
                    <h3 className="text-base font-bold text-white">
                      1. Source Ad Attribution
                    </h3>
                    <p className="text-xs text-slate-400">
                      Attribute this conversation to an Ad in <code className="text-slate-300">mkt_ads_catalog</code>
                    </p>
                  </div>
                </div>

                <select
                  value={editSourceAdId}
                  onChange={(e) => setEditSourceAdId(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-2.5 text-xs sm:text-sm text-white focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">— Organic / Unattributed Lead —</option>
                  {catalogAds.map((ad) => (
                    <option key={ad.ad_id} value={ad.ad_id}>
                      {ad.ad_name} ({ad.status})
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-5 space-y-4">
                <div className="flex items-center gap-2.5">
                  <BadgeDollarSign className="h-5 w-5 text-emerald-400" />
                  <div>
                    <h3 className="text-base font-bold text-white">
                      2. CRM Pipeline Stage &amp; Deal Value (₱)
                    </h3>
                    <p className="text-xs text-slate-400">
                      Updates True ROAS &amp; fires Meta CAPI <code className="text-slate-300">Lead</code> / <code className="text-slate-300">Purchase</code>
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  {CRM_STAGE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setEditStage(opt.value)}
                      className={`w-full flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-xs font-bold transition cursor-pointer ${
                        editStage === opt.value
                          ? 'border-indigo-500 bg-indigo-500/15 text-white'
                          : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <span>{opt.label}</span>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] ring-1 ring-inset ${opt.color}`}
                      >
                        {opt.value}
                      </span>
                    </button>
                  ))}
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Deal Value (PHP ₱)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={editDealValue}
                    onChange={(e) => setEditDealValue(e.target.value)}
                    placeholder="e.g. 2500"
                    className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-2.5 text-sm font-bold text-emerald-400 focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <button
                  type="button"
                  disabled={savingCrm}
                  onClick={handleSaveCrmAttribution}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-600/20 transition cursor-pointer"
                >
                  {savingCrm ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  Save CRM Stage &amp; Sync Meta CAPI
                </button>
              </div>
            </>
          ) : null}
        </aside>
      </div>

      {/* ====================================================================
          MODAL: Business Profile & AI Knowledge Bot Configuration
         ==================================================================== */}
      {showKnowledgeModal && knowledge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-3xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-5 my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-lg font-extrabold text-white flex items-center gap-2">
                  <Bot className="h-5 w-5 text-indigo-400" />
                  Business Profile &amp; AI Knowledge Bot Settings
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Your bot uses this knowledge base to answer Facebook &amp; Instagram DMs, reply to post comments, and generate weekly content.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={syncingPageProfile}
                  onClick={handleSyncFromMetaPage}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-500/20 border border-indigo-500/40 hover:bg-indigo-500/30 px-3 py-1.5 text-xs font-bold text-indigo-200 transition cursor-pointer"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${syncingPageProfile ? 'animate-spin' : ''}`}
                  />
                  Sync from FB Page ({knowledge.business_name || 'Kylrie'})
                </button>
                <button
                  type="button"
                  onClick={() => setShowKnowledgeModal(false)}
                  className="rounded-lg p-1.5 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <form onSubmit={handleSaveKnowledge} className="space-y-4">
              {/* Auto-Pilot Toggles */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-3.5">
                <label className="flex items-center gap-2.5 text-xs font-bold text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={knowledge.auto_reply_dms}
                    onChange={(e) =>
                      setKnowledge({ ...knowledge, auto_reply_dms: e.target.checked })
                    }
                    className="h-4 w-4 rounded accent-indigo-500"
                  />
                  <span>🤖 Auto-Answer Incoming DMs</span>
                </label>

                <label className="flex items-center gap-2.5 text-xs font-bold text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={knowledge.auto_reply_comments}
                    onChange={(e) =>
                      setKnowledge({
                        ...knowledge,
                        auto_reply_comments: e.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded accent-indigo-500"
                  />
                  <span>💬 Use Knowledge in Comment DMs</span>
                </label>

                <label className="flex items-center gap-2.5 text-xs font-bold text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={knowledge.auto_qualify_leads}
                    onChange={(e) =>
                      setKnowledge({
                        ...knowledge,
                        auto_qualify_leads: e.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded accent-indigo-500"
                  />
                  <span>🎯 Auto-Qualify High-Intent Leads</span>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400">
                    Business / Page Name
                  </label>
                  <input
                    type="text"
                    value={knowledge.business_name}
                    onChange={(e) =>
                      setKnowledge({ ...knowledge, business_name: e.target.value })
                    }
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400">
                    Category / Niche
                  </label>
                  <input
                    type="text"
                    value={knowledge.category}
                    onChange={(e) =>
                      setKnowledge({ ...knowledge, category: e.target.value })
                    }
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400">
                    Bot Tone of Voice
                  </label>
                  <select
                    value={knowledge.tone_of_voice}
                    onChange={(e) =>
                      setKnowledge({
                        ...knowledge,
                        tone_of_voice: e.target.value as MktToneOfVoice,
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-bold text-white"
                  >
                    <option value="TAGLISH">Taglish (Warm &amp; Conversational)</option>
                    <option value="ENGLISH">English (Friendly &amp; Direct)</option>
                    <option value="PROFESSIONAL">Professional / Corporate</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400">
                  About the Business (Auto-imported from FB Page About/Description)
                </label>
                <textarea
                  rows={2}
                  value={knowledge.about_description}
                  onChange={(e) =>
                    setKnowledge({ ...knowledge, about_description: e.target.value })
                  }
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400">
                  Pricing, Packages &amp; Current Promo Offers (₱)
                </label>
                <textarea
                  rows={3}
                  value={knowledge.pricing_and_packages}
                  onChange={(e) =>
                    setKnowledge({
                      ...knowledge,
                      pricing_and_packages: e.target.value,
                    })
                  }
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400">
                    How to Book / Order &amp; Payment Methods (GCash, Maya, Bank)
                  </label>
                  <textarea
                    rows={3}
                    value={knowledge.booking_and_payment_info}
                    onChange={(e) =>
                      setKnowledge({
                        ...knowledge,
                        booking_and_payment_info: e.target.value,
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400">
                    FAQs &amp; Policies
                  </label>
                  <textarea
                    rows={3}
                    value={knowledge.faqs_and_policies}
                    onChange={(e) =>
                      setKnowledge({
                        ...knowledge,
                        faqs_and_policies: e.target.value,
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400">
                    Location &amp; Operating Hours
                  </label>
                  <input
                    type="text"
                    value={knowledge.location_and_hours}
                    onChange={(e) =>
                      setKnowledge({
                        ...knowledge,
                        location_and_hours: e.target.value,
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400">
                    Website / Email / Phone Contact Info
                  </label>
                  <input
                    type="text"
                    value={knowledge.contact_info}
                    onChange={(e) =>
                      setKnowledge({ ...knowledge, contact_info: e.target.value })
                    }
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowKnowledgeModal(false)}
                  className="rounded-xl border border-slate-700 px-4 py-2 text-xs font-bold text-slate-300 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingKnowledge}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2 text-xs font-bold text-white shadow-lg cursor-pointer"
                >
                  {savingKnowledge ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  Save Business Knowledge Base
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
