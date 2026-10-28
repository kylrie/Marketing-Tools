'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  MessageSquare,
  Palette,
  RefreshCw,
  Rocket,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  Video,
  Wand2,
  X,
  XCircle,
} from 'lucide-react';
import type { SocialPostItem } from '@/lib/meta-engine/meta-inbox-posts';
import PageSwitcherBar from '@/components/marketing/PageSwitcherBar';
import type {
  MktGeneratedCopyHook,
  MktWeeklyCalendarPostPlan,
} from '@/lib/meta-engine/types';

export default function SocialPostStudioPage() {
  const router = useRouter();
  const [posts, setPosts] = useState<SocialPostItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [publishing, setPublishing] = useState<boolean>(false);

  // Expanded comments per post & reply inputs per comment
  const [expandedPostIds, setExpandedPostIds] = useState<Record<string, boolean>>({});
  const [commentReplyDrafts, setCommentReplyDrafts] = useState<Record<string, string>>({});
  const [commentActionBusy, setCommentActionBusy] = useState<Record<string, boolean>>({});

  // Composer State
  const [platform, setPlatform] = useState<'FACEBOOK' | 'INSTAGRAM'>('FACEBOOK');
  const [mediaType, setMediaType] = useState<'TEXT' | 'IMAGE' | 'VIDEO'>('TEXT');
  const [message, setMessage] = useState<string>('');
  const [mediaUrl, setMediaUrl] = useState<string>('');
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [scheduledFor, setScheduledFor] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // AI Caption Generator State
  const [aiTopic, setAiTopic] = useState<string>('');
  const [generatingAi, setGeneratingAi] = useState<boolean>(false);
  const [aiSuggestions, setAiSuggestions] = useState<MktGeneratedCopyHook[]>([]);

  // 7-Day AI Content Calendar State
  const [showCalendarPanel, setShowCalendarPanel] = useState<boolean>(false);
  const [calendarFocusInput, setCalendarFocusInput] = useState<string>('');
  const [generatingCalendar, setGeneratingCalendar] = useState<boolean>(false);
  const [weeklyCalendar, setWeeklyCalendar] = useState<MktWeeklyCalendarPostPlan[]>([]);

  // 1080x1080 Promo Poster / Graphic Card Maker State
  const [showGraphicMaker, setShowGraphicMaker] = useState<boolean>(false);
  const [posterHeadline, setPosterHeadline] = useState<string>('WEEKEND VIP PROMO');
  const [posterPriceBadge, setPosterPriceBadge] = useState<string>('LIMITED SLOTS AVAILABLE');
  const [posterSubtext, setPosterSubtext] = useState<string>(
    'Comment "HOW" or "PRICE" below for instant DM package rates!'
  );
  const [posterTheme, setPosterTheme] = useState<'INDIGO' | 'EMERALD' | 'ROSE'>('INDIGO');

  const [toast, setToast] = useState<{
    type: 'success' | 'error';
    title: string;
    message: string;
  } | null>(null);

  const showToast = useCallback(
    (type: 'success' | 'error', title: string, msg: string) => {
      setToast({ type, title, message: msg });
      setTimeout(() => setToast(null), 5000);
    },
    []
  );

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/marketing/posts', { cache: 'no-store' });
      const data = (await res.json()) as {
        posts?: SocialPostItem[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Failed loading posts.');
      }
      const loadedPosts = data.posts || [];
      setPosts(loadedPosts);

      // Automatically expand the first post that has comments
      setExpandedPostIds((prev) => {
        const next = { ...prev };
        for (const p of loadedPosts) {
          if ((p.commentsCount || 0) > 0 && next[p.postId] === undefined) {
            next[p.postId] = true;
          }
        }
        return next;
      });
    } catch (err) {
      showToast(
        'error',
        'Failed Loading Page Feed',
        err instanceof Error ? err.message : 'Unable to fetch posts.'
      );
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  const handleLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) {
      showToast('error', 'Unsupported File', 'Please select a valid photo or video file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      setMediaType(isVideo ? 'VIDEO' : 'IMAGE');
      setMediaUrl(dataUrl);
      setUploadedFileName(file.name);
      showToast(
        'success',
        `${isVideo ? 'Video' : 'Photo'} Attached`,
        `"${file.name}" is ready to publish to your Page.`
      );
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleGeneratePromoGraphic = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Background Gradient
    const grad = ctx.createLinearGradient(0, 0, 1080, 1080);
    if (posterTheme === 'INDIGO') {
      grad.addColorStop(0, '#0f172a');
      grad.addColorStop(0.5, '#1e1b4b');
      grad.addColorStop(1, '#312e81');
    } else if (posterTheme === 'EMERALD') {
      grad.addColorStop(0, '#022c22');
      grad.addColorStop(0.5, '#064e3b');
      grad.addColorStop(1, '#0f172a');
    } else {
      grad.addColorStop(0, '#4c0519');
      grad.addColorStop(0.5, '#881337');
      grad.addColorStop(1, '#0f172a');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1080, 1080);

    // Decorative Accent Glow Border
    ctx.strokeStyle =
      posterTheme === 'INDIGO'
        ? '#6366f1'
        : posterTheme === 'EMERALD'
          ? '#10b981'
          : '#f43f5e';
    ctx.lineWidth = 8;
    ctx.strokeRect(48, 48, 984, 984);

    // Top Brand Header
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('KYLRIE • OFFICIAL PAGE PROMO', 540, 140);

    // Promo Badge Pill
    ctx.fillStyle =
      posterTheme === 'INDIGO'
        ? '#4f46e5'
        : posterTheme === 'EMERALD'
          ? '#059669'
          : '#e11d48';
    ctx.fillRect(190, 210, 700, 84);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText((posterPriceBadge || 'SPECIAL PROMO').toUpperCase(), 540, 265);

    // Main Headline (Word Wrapped)
    ctx.fillStyle = '#ffffff';
    ctx.font = 'extrabold 72px sans-serif';
    const words = (posterHeadline || 'SPECIAL OFFER').toUpperCase().split(' ');
    const lines: string[] = [];
    let currentLine = '';
    for (const w of words) {
      const test = currentLine ? `${currentLine} ${w}` : w;
      if (ctx.measureText(test).width > 860) {
        if (currentLine) lines.push(currentLine);
        currentLine = w;
      } else {
        currentLine = test;
      }
    }
    if (currentLine) lines.push(currentLine);

    let y = 450;
    for (const line of lines.slice(0, 4)) {
      ctx.fillText(line, 540, y);
      y += 92;
    }

    // Footer CTA Box
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(100, 840, 880, 120);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText(
      posterSubtext || 'Comment "HOW" below for instant DM details!',
      540,
      912
    );

    const pngDataUrl = canvas.toDataURL('image/png');
    setMediaType('IMAGE');
    setMediaUrl(pngDataUrl);
    setUploadedFileName('promo-card-1080x1080.png');
    setShowGraphicMaker(false);
    showToast(
      'success',
      '1080×1080 Promo Poster Attached!',
      'Branded graphic generated and attached to your post composer.'
    );
  };

  const handleGenerateWeeklyCalendar = async () => {
    if (generatingCalendar) return;
    setGeneratingCalendar(true);
    try {
      const res = await fetch('/api/marketing/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'GENERATE_WEEKLY_CALENDAR',
          promoFocus: calendarFocusInput.trim() || undefined,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        posts?: MktWeeklyCalendarPostPlan[];
        error?: string;
      };
      if (!res.ok || !data.posts) {
        throw new Error(data.error || 'Failed generating 7-day calendar.');
      }
      setWeeklyCalendar(data.posts);
      showToast(
        'success',
        '7-Day Content Calendar Ready!',
        'Click "Use in Composer" on any day to load its caption & schedule.'
      );
    } catch (err) {
      showToast(
        'error',
        'Calendar Generation Failed',
        err instanceof Error ? err.message : 'Unable to generate weekly calendar.'
      );
    } finally {
      setGeneratingCalendar(false);
    }
  };

  const handlePromotePostInLauncher = (post: SocialPostItem) => {
    try {
      localStorage.setItem(
        'mkt_promote_post_draft',
        JSON.stringify({
          postId: post.postId,
          message: post.message,
          mediaUrl: post.mediaUrl || null,
          mediaType: post.mediaType,
        })
      );
    } catch {
      // ignore storage errors
    }
    router.push('/marketing/launcher');
  };

  const handleCommentAction = async (
    commentId: string,
    action: 'REPLY_PUBLIC' | 'SEND_PRIVATE_DM' | 'TOGGLE_HIDE',
    options?: { isHidden?: boolean }
  ) => {
    const draftText = (commentReplyDrafts[commentId] || '').trim();
    if (
      (action === 'REPLY_PUBLIC' || action === 'SEND_PRIVATE_DM') &&
      !draftText
    ) {
      showToast(
        'error',
        'Message Required',
        'Type a reply or DM message in the input box first.'
      );
      return;
    }

    setCommentActionBusy((prev) => ({ ...prev, [commentId]: true }));
    try {
      const res = await fetch('/api/marketing/posts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commentId,
          action,
          replyText: draftText,
          isHidden: options?.isHidden,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Comment action failed.');
      }

      if (action === 'REPLY_PUBLIC' || action === 'SEND_PRIVATE_DM') {
        setCommentReplyDrafts((prev) => ({ ...prev, [commentId]: '' }));
      }

      showToast('success', 'Comment Action Complete', data.message || 'Done.');
      await loadPosts();
    } catch (err) {
      showToast(
        'error',
        'Comment Action Failed',
        err instanceof Error ? err.message : 'Unable to complete comment action.'
      );
    } finally {
      setCommentActionBusy((prev) => ({ ...prev, [commentId]: false }));
    }
  };

  const handleGenerateCaptions = async () => {
    if (generatingAi) return;
    const offerText = aiTopic.trim() || message.trim() || 'Special Page Promo & Inquiry Offer';
    setGeneratingAi(true);

    try {
      const res = await fetch('/api/marketing/generate-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offerDescription: offerText,
        }),
      });
      const data = (await res.json()) as {
        hooks?: MktGeneratedCopyHook[];
        error?: string;
      };
      if (!res.ok || !data.hooks) {
        throw new Error(data.error || 'Failed generating captions.');
      }
      setAiSuggestions(data.hooks);
      if (data.hooks[0]?.primaryText && !message.trim()) {
        setMessage(data.hooks[0].primaryText);
      }
      showToast(
        'success',
        '3 Post Captions Ready',
        'Click any suggestion pill to apply it to your post.'
      );
    } catch (err) {
      showToast(
        'error',
        'AI Generator Failed',
        err instanceof Error ? err.message : 'Unable to generate captions.'
      );
    } finally {
      setGeneratingAi(false);
    }
  };

  const handlePublishPost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || publishing) return;
    setPublishing(true);

    try {
      const res = await fetch('/api/marketing/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          mediaType,
          message: message.trim(),
          mediaUrl: mediaUrl.trim() || null,
          scheduledFor: scheduledFor
            ? new Date(scheduledFor).toISOString()
            : null,
        }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        post?: SocialPostItem;
        publishedLiveToMeta?: boolean;
        metaNotice?: string;
        error?: string;
      };

      if (!res.ok || !data.post) {
        throw new Error(data.error || 'Failed publishing post.');
      }

      setMessage('');
      setMediaUrl('');
      setUploadedFileName('');
      setScheduledFor('');
      await loadPosts();

      if (data.publishedLiveToMeta) {
        showToast(
          'success',
          data.metaNotice || 'Published Live to Facebook Page!',
          `Post ${data.post.postId} has been processed.`
        );
      } else {
        showToast(
          'success',
          'Saved to Social Post Studio',
          data.metaNotice || 'Saved to post feed.'
        );
      }
    } catch (err) {
      showToast(
        'error',
        'Publish Failed',
        err instanceof Error ? err.message : 'Unable to publish post.'
      );
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-8 px-4 sm:px-6 lg:px-8">
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

      <div className="mx-auto max-w-7xl space-y-8">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <Link
                href="/marketing/attribution"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white transition"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Command Center
              </Link>
              <Link
                href="/marketing/inbox"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-indigo-300 hover:text-white transition"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                Omnichannel Inbox
              </Link>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white pt-1">
              Organic Social Post Studio &amp; 7-Day AI Content Calendar
            </h1>
            <p className="text-xs sm:text-sm text-slate-400">
              Publish or schedule photos, videos, and 1080×1080 promo graphics to Facebook Page{' '}
              <strong className="text-slate-200">Kylrie</strong> (#842220459241420) &amp; Instagram.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <PageSwitcherBar onPageChanged={() => loadPosts()} />
            <button
              type="button"
              onClick={() => setShowCalendarPanel((prev) => !prev)}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 hover:bg-emerald-500/25 px-3.5 py-2.5 text-xs font-bold text-emerald-300 transition cursor-pointer"
            >
              <Calendar className="h-4 w-4" />
              {showCalendarPanel ? 'Hide 7-Day AI Calendar' : '📅 7-Day AI Content Calendar'}
            </button>

            <button
              type="button"
              onClick={() => setShowGraphicMaker((prev) => !prev)}
              className="inline-flex items-center gap-2 rounded-xl bg-violet-500/15 border border-violet-500/40 hover:bg-violet-500/25 px-3.5 py-2.5 text-xs font-bold text-violet-300 transition cursor-pointer"
            >
              <Palette className="h-4 w-4" />
              🎨 1080×1080 Promo Graphic Maker
            </button>

            <button
              type="button"
              onClick={loadPosts}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-indigo-500/50 px-4 py-2.5 text-xs font-bold text-white transition cursor-pointer"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh Feed
            </button>
          </div>
        </header>

        {/* Optional Drawer 1: 7-Day AI Content Calendar Generator */}
        {showCalendarPanel && (
          <section className="rounded-2xl border border-emerald-500/30 bg-slate-900/90 p-6 shadow-2xl space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-emerald-400" />
                  📅 7-Day AI Social Media Content Calendar (Grounded on Your Business Knowledge Base)
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Generates a complete Monday–Sunday post schedule with Comment-to-DM hooks so you can batch-create a week of content in 2 minutes.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={calendarFocusInput}
                  onChange={(e) => setCalendarFocusInput(e.target.value)}
                  placeholder="Optional focus (e.g. Weekend VIP Promo)..."
                  className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 w-64"
                />
                <button
                  type="button"
                  disabled={generatingCalendar}
                  onClick={handleGenerateWeeklyCalendar}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-xs font-bold text-white transition cursor-pointer shrink-0"
                >
                  {generatingCalendar ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Generate 7-Day Plan
                </button>
              </div>
            </div>

            {weeklyCalendar.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5 pt-2">
                {weeklyCalendar.map((plan, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border border-slate-800 bg-slate-950/90 p-4 flex flex-col justify-between space-y-3"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
                          {plan.dayName} ({plan.recommendedTime})
                        </span>
                        <span className="text-[10px] font-semibold text-indigo-300">
                          {plan.theme}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-white">{plan.headline}</p>
                      <p className="text-[11px] text-slate-300 line-clamp-4 whitespace-pre-wrap">
                        {plan.caption}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-800/80">
                      <button
                        type="button"
                        onClick={() => {
                          setMessage(plan.caption);
                          setPosterHeadline(plan.headline);
                          setPosterPriceBadge(plan.promoBadge);
                          showToast(
                            'success',
                            `Loaded ${plan.dayName} Post`,
                            'Caption loaded into composer!'
                          );
                        }}
                        className="flex-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-2.5 py-1.5 text-[11px] font-bold text-white transition cursor-pointer"
                      >
                        Use in Composer
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMessage(plan.caption);
                          setPosterHeadline(plan.headline);
                          setPosterPriceBadge(plan.promoBadge);
                          setShowGraphicMaker(true);
                        }}
                        className="rounded-lg border border-violet-500/40 bg-violet-500/15 hover:bg-violet-500/25 px-2.5 py-1.5 text-[11px] font-bold text-violet-300 transition cursor-pointer"
                      >
                        🎨 Poster
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Optional Drawer 2: 1080x1080 Promo Poster / Graphic Card Maker */}
        {showGraphicMaker && (
          <section className="rounded-2xl border border-violet-500/35 bg-slate-900/90 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Palette className="h-5 w-5 text-violet-400" />
                  🎨 Instant 1080×1080 Promo Graphic Card Maker
                </h2>
                <p className="text-xs text-slate-400">
                  Generates a clean, high-converting 1080×1080 PNG social graphic right in your browser—no Canva required.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGraphicMaker(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-400">
                  Main Headline
                </label>
                <input
                  type="text"
                  value={posterHeadline}
                  onChange={(e) => setPosterHeadline(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-400">
                  Top Promo / Price Badge
                </label>
                <input
                  type="text"
                  value={posterPriceBadge}
                  onChange={(e) => setPosterPriceBadge(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-400">
                  Footer Call-To-Action
                </label>
                <input
                  type="text"
                  value={posterSubtext}
                  onChange={(e) => setPosterSubtext(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-400">
                  Color Theme &amp; Render
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <select
                    value={posterTheme}
                    onChange={(e) =>
                      setPosterTheme(e.target.value as 'INDIGO' | 'EMERALD' | 'ROSE')
                    }
                    className="rounded-xl border border-slate-800 bg-slate-950 px-2.5 py-2 text-xs text-white"
                  >
                    <option value="INDIGO">Midnight Indigo</option>
                    <option value="EMERALD">Emerald Revenue</option>
                    <option value="ROSE">Crimson Urgency</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleGeneratePromoGraphic}
                    className="flex-1 rounded-xl bg-violet-600 hover:bg-violet-500 px-3 py-2 text-xs font-bold text-white transition cursor-pointer"
                  >
                    Attach 1080×1080 PNG
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column (5 cols): Post Composer */}
          <section className="lg:col-span-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-xl space-y-5 h-fit">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-indigo-400" />
              Create or Schedule Page / IG Post
            </h2>

            {/* AI Caption Helper */}
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-4 space-y-3">
              <label className="block text-xs font-bold text-indigo-300">
                ✨ AI Caption &amp; Hook Generator
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={aiTopic}
                  onChange={(e) => setAiTopic(e.target.value)}
                  placeholder="Enter topic or promo offer..."
                  className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={generatingAi}
                  onClick={handleGenerateCaptions}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-2 text-xs font-bold text-white transition cursor-pointer shrink-0"
                >
                  {generatingAi ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="h-3.5 w-3.5" />
                  )}
                  Write
                </button>
              </div>

              {aiSuggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {aiSuggestions.map((hook, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setMessage(hook.primaryText)}
                      className="rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1 text-[11px] font-semibold text-indigo-300 hover:border-indigo-400 cursor-pointer"
                    >
                      Use {hook.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <form onSubmit={handlePublishPost} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Platform
                  </label>
                  <select
                    value={platform}
                    onChange={(e) =>
                      setPlatform(e.target.value as 'FACEBOOK' | 'INSTAGRAM')
                    }
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-bold text-white"
                  >
                    <option value="FACEBOOK">Facebook Page (Kylrie)</option>
                    <option value="INSTAGRAM">Instagram Business</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Post Format
                  </label>
                  <select
                    value={mediaType}
                    onChange={(e) =>
                      setMediaType(e.target.value as 'TEXT' | 'IMAGE' | 'VIDEO')
                    }
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-bold text-white"
                  >
                    <option value="TEXT">Text / Status Post</option>
                    <option value="IMAGE">Photo Post</option>
                    <option value="VIDEO">Video / Reel</option>
                  </select>
                </div>
              </div>

              {/* Local Photo / Video Upload + URL Fallback */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Attach Photo or Video (Upload or URL)
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*"
                    onChange={handleLocalFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-[11px] font-bold text-indigo-300 transition cursor-pointer"
                  >
                    <Upload className="h-3 w-3" />
                    Upload Photo / Video File
                  </button>
                </div>

                {uploadedFileName ? (
                  <div className="flex items-center justify-between rounded-xl border border-indigo-500/40 bg-indigo-950/30 px-3 py-2 text-xs">
                    <span className="truncate font-semibold text-indigo-200">
                      📎 {uploadedFileName} ({mediaType})
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setMediaUrl('');
                        setUploadedFileName('');
                        setMediaType('TEXT');
                      }}
                      className="text-slate-400 hover:text-rose-400 ml-2 cursor-pointer"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  mediaType !== 'TEXT' && (
                    <input
                      type="url"
                      value={mediaUrl}
                      onChange={(e) => setMediaUrl(e.target.value)}
                      placeholder="Or paste direct https:// image or video URL..."
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs text-white placeholder-slate-500"
                    />
                  )
                )}

                {mediaUrl && mediaType === 'IMAGE' && (
                  <div className="rounded-xl overflow-hidden border border-slate-800 max-h-48 bg-slate-950">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={mediaUrl}
                      alt="Preview"
                      className="w-full h-full object-contain max-h-48"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Post Caption / Message
                </label>
                <textarea
                  rows={5}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Write your post caption here (Include keywords like 'Comment HOW or PRICE below and our AI Comment Shield will DM you immediately!')..."
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 p-3.5 text-sm text-white placeholder-slate-500 leading-relaxed focus:border-indigo-500 focus:outline-none"
                />
              </div>

              {/* Optional Schedule Date/Time Picker */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-indigo-400" />
                  Schedule For Later (Optional — Leave Blank to Publish Now)
                </label>
                <input
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-xs text-white focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={publishing || !message.trim()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition cursor-pointer"
              >
                {publishing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : scheduledFor ? (
                  <Clock className="h-4 w-4" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {scheduledFor
                  ? `Schedule Post on ${platform === 'FACEBOOK' ? 'Facebook Page' : 'Instagram'}`
                  : `Publish Now to ${platform === 'FACEBOOK' ? 'Facebook Page' : 'Instagram'}`}
              </button>
            </form>
          </section>

          {/* Right Column (7 cols): Live Page Feed */}
          <section className="lg:col-span-7 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">
                Published &amp; Scheduled Page Feed ({posts.length} Posts)
              </h2>
              <span className="text-xs text-slate-400">
                Synced from <code className="text-slate-300">GET /v21.0/842220459241420/feed</code>
              </span>
            </div>

            {loading ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/50 py-16 text-center">
                <Loader2 className="h-6 w-6 animate-spin text-indigo-400 mx-auto" />
                <p className="mt-2 text-xs text-slate-400">
                  Loading published posts from Facebook Page Kylrie...
                </p>
              </div>
            ) : posts.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-10 text-center text-sm text-slate-400">
                No posts found yet. Use the composer on the left to publish your first post!
              </div>
            ) : (
              <div className="space-y-4">
                {posts.map((post) => (
                  <div
                    key={post.id}
                    className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-500/15 px-2.5 py-1 text-[11px] font-bold text-indigo-300 ring-1 ring-indigo-500/30">
                          {post.mediaType === 'IMAGE' ? (
                            <ImageIcon className="h-3 w-3" />
                          ) : post.mediaType === 'VIDEO' ? (
                            <Video className="h-3 w-3" />
                          ) : (
                            <FileText className="h-3 w-3" />
                          )}
                          {post.platform} • {post.mediaType}
                        </span>
                        {post.status === 'SCHEDULED' && (
                          <span className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-300 ring-1 ring-amber-500/30">
                            <Clock className="h-3 w-3" />
                            SCHEDULED
                          </span>
                        )}
                        <span className="text-xs text-slate-400 font-mono">
                          ID: {post.postId}
                        </span>
                      </div>

                      <span className="text-xs text-slate-400">
                        {new Date(post.scheduledFor || post.createdTime).toLocaleString('en-PH', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
                      {post.message}
                    </p>

                    {post.mediaUrl && (
                      <div className="rounded-xl overflow-hidden border border-slate-800 max-h-72 bg-slate-950">
                        {post.mediaType === 'VIDEO' || post.mediaUrl.startsWith('data:video/') ? (
                          <video
                            src={post.mediaUrl}
                            controls
                            className="w-full max-h-72 object-contain"
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={post.mediaUrl}
                            alt="Post media"
                            className="w-full h-full object-cover max-h-72"
                          />
                        )}
                      </div>
                    )}

                    <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedPostIds((prev) => ({
                              ...prev,
                              [post.postId]: !prev[post.postId],
                            }))
                          }
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                            (post.commentsCount || 0) > 0
                              ? 'bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-500/40 hover:bg-indigo-500/30'
                              : 'bg-slate-800/70 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <MessageSquare className="h-3.5 w-3.5" />
                          {post.commentsCount || 0}{' '}
                          {post.commentsCount === 1 ? 'Comment' : 'Comments'}
                        </button>

                        {post.permalinkUrl && (
                          <a
                            href={post.permalinkUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-400 hover:text-indigo-300"
                          >
                            View on Facebook <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => handlePromotePostInLauncher(post)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 transition cursor-pointer"
                      >
                        <Rocket className="h-3.5 w-3.5" />
                        Promote in Ad Launcher (Pre-Fill)
                      </button>
                    </div>

                    {/* Expandable Post Comments Drawer */}
                    {expandedPostIds[post.postId] && (
                      <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                            <MessageSquare className="h-3.5 w-3.5 text-indigo-400" />
                            Post Comments &amp; AI Comment-to-DM Shield Status
                          </h3>
                          <Link
                            href="/marketing/watchdog"
                            className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300"
                          >
                            Configure Shield Rules →
                          </Link>
                        </div>

                        {!post.comments || post.comments.length === 0 ? (
                          <p className="text-xs text-slate-500 py-2">
                            No comments on this post yet. When someone comments &ldquo;how?&rdquo; or &ldquo;how much&rdquo;, the AI Comment Shield will automatically reply, send a Private DM grounded on your Business Knowledge Base, and hide the comment here.
                          </p>
                        ) : (
                          <div className="space-y-3">
                            {post.comments.map((comment) => {
                              const isBusy = Boolean(commentActionBusy[comment.id]);
                              return (
                                <div
                                  key={comment.id}
                                  className="rounded-xl border border-slate-800/90 bg-slate-900/80 p-3.5 space-y-2.5"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-xs font-bold text-white">
                                        {comment.senderName}
                                      </span>
                                      <span className="text-[11px] text-slate-400">
                                        {new Date(comment.createdTime).toLocaleString('en-PH', {
                                          month: 'short',
                                          day: 'numeric',
                                          hour: 'numeric',
                                          minute: '2-digit',
                                        })}
                                      </span>

                                      {comment.shieldClassification && (
                                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-500/30">
                                          <ShieldCheck className="h-3 w-3" />
                                          AI Shield: {comment.shieldClassification}
                                        </span>
                                      )}

                                      {comment.privateDmSent && (
                                        <span className="inline-flex items-center gap-1 rounded-md bg-indigo-500/15 px-2 py-0.5 text-[10px] font-bold text-indigo-300 ring-1 ring-indigo-500/30">
                                          📩 Private DM Sent
                                        </span>
                                      )}

                                      {comment.isHidden && (
                                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300 ring-1 ring-amber-500/30">
                                          <EyeOff className="h-3 w-3" />
                                          Hidden from Competitors
                                        </span>
                                      )}
                                    </div>

                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() =>
                                        handleCommentAction(comment.id, 'TOGGLE_HIDE', {
                                          isHidden: !comment.isHidden,
                                        })
                                      }
                                      className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 hover:border-slate-600 px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:text-white transition cursor-pointer"
                                    >
                                      {comment.isHidden ? (
                                        <>
                                          <Eye className="h-3 w-3" />
                                          Unhide
                                        </>
                                      ) : (
                                        <>
                                          <EyeOff className="h-3 w-3" />
                                          Hide Comment
                                        </>
                                      )}
                                    </button>
                                  </div>

                                  <p className="text-sm text-slate-100">
                                    {comment.message}
                                  </p>

                                  {/* Nested Replies */}
                                  {comment.replies && comment.replies.length > 0 && (
                                    <div className="pl-3 border-l-2 border-indigo-500/40 space-y-2 pt-1">
                                      {comment.replies.map((reply) => (
                                        <div
                                          key={reply.id}
                                          className="rounded-lg bg-slate-950/90 border border-slate-800/80 p-2.5 text-xs space-y-1"
                                        >
                                          <div className="flex items-center justify-between text-[11px]">
                                            <span className="font-bold text-indigo-300">
                                              {reply.senderName}{' '}
                                              {reply.isFromPage && (
                                                <span className="ml-1 rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] text-indigo-300">
                                                  Page Auto-Reply
                                                </span>
                                              )}
                                            </span>
                                            <span className="text-slate-500">
                                              {new Date(reply.createdTime).toLocaleString('en-PH', {
                                                month: 'short',
                                                day: 'numeric',
                                                hour: 'numeric',
                                                minute: '2-digit',
                                              })}
                                            </span>
                                          </div>
                                          <p className="text-slate-200">{reply.message}</p>
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {/* Manual Public Reply / Private DM Input */}
                                  <div className="flex flex-col sm:flex-row gap-2 pt-1">
                                    <input
                                      type="text"
                                      value={commentReplyDrafts[comment.id] || ''}
                                      onChange={(e) =>
                                        setCommentReplyDrafts((prev) => ({
                                          ...prev,
                                          [comment.id]: e.target.value,
                                        }))
                                      }
                                      placeholder={`Reply to ${comment.senderName}...`}
                                      className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                                    />
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() =>
                                          handleCommentAction(comment.id, 'REPLY_PUBLIC')
                                        }
                                        className="inline-flex items-center gap-1 rounded-lg bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 text-[11px] font-bold text-white transition cursor-pointer"
                                      >
                                        {isBusy ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                          <Send className="h-3 w-3" />
                                        )}
                                        Public Reply
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() =>
                                          handleCommentAction(comment.id, 'SEND_PRIVATE_DM')
                                        }
                                        className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-2.5 py-1.5 text-[11px] font-bold text-white transition cursor-pointer"
                                      >
                                        <MessageCircle className="h-3 w-3" />
                                        Send DM
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
