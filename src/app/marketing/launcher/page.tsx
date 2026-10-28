'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FileVideo,
  FolderKanban,
  Image as ImageIcon,
  Layers,
  Loader2,
  MessageCircle,
  PauseCircle,
  PlayCircle,
  Plus,
  Rocket,
  Save,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Tag,
  Trash2,
  UploadCloud,
  Wand2,
  X,
  XCircle,
} from 'lucide-react';
import type {
  MetaAdSetOption,
  MetaCampaignOption,
  PublishedAdResultItem,
} from '@/lib/meta-engine/meta-launcher';
import type {
  MktAdToggleStatus,
  MktChatIcebreaker,
  MktChatTemplateRow,
  MktGeneratedCopyHook,
  MktLaunchBatchRow,
} from '@/lib/meta-engine/types';

type CreativeFormatType = 'Reel' | 'Static' | 'Carousel' | 'UGC';

interface StagedCreativeAsset {
  localId: string;
  fileName: string;
  type: 'IMAGE' | 'VIDEO';
  formatLabel: CreativeFormatType;
  creatorName: string;
  previewUrl: string;
  fileUrlOrBase64: string;
  mediaHashOrId?: string;
  sizeBytes?: number;
}

interface CopyVariationCard {
  id: string;
  enabled: boolean;
  angleLabel: string;
  primaryText: string;
  headline: string;
}

interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  message: string;
}

function sanitizeSegment(raw: string, fallback: string): string {
  const cleaned = (raw || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^a-zA-Z0-9.\-]/g, '');
  return cleaned || fallback;
}

export default function BulkAdLauncherStudioPage() {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);
  const [loadingInit, setLoadingInit] = useState<boolean>(true);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // Step 1 State: Destination & Taxonomy Naming Enforcer
  const [campaigns, setCampaigns] = useState<MetaCampaignOption[]>([]);
  const [adSets, setAdSets] = useState<MetaAdSetOption[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('');
  const [selectedAdSetId, setSelectedAdSetId] = useState<string>('');
  const [promoName, setPromoName] = useState<string>('');
  const [creativeFormat, setCreativeFormat] = useState<CreativeFormatType>('Reel');
  const [creatorName, setCreatorName] = useState<string>('');

  // Step 2 State: Creative Asset Batch Uploader
  const [creatives, setCreatives] = useState<StagedCreativeAsset[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const [externalMediaUrlInput, setExternalMediaUrlInput] = useState<string>('');
  const [externalMediaType, setExternalMediaType] = useState<'IMAGE' | 'VIDEO'>('VIDEO');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Step 3 State: AI Copy Matrix & Saved Chat Greeting Template
  const [offerDescription, setOfferDescription] = useState<string>('');
  const [pricePointInput, setPricePointInput] = useState<string>('');
  const [generatingAiCopy, setGeneratingAiCopy] = useState<boolean>(false);
  const [copyVariations, setCopyVariations] = useState<CopyVariationCard[]>([
    {
      id: 'hook-1',
      enabled: true,
      angleLabel: 'Direct Promo Offer',
      primaryText: '',
      headline: '',
    },
    {
      id: 'hook-2',
      enabled: true,
      angleLabel: 'Problem / Agitate / Solve',
      primaryText: '',
      headline: '',
    },
    {
      id: 'hook-3',
      enabled: true,
      angleLabel: 'Taglish Conversational Hook',
      primaryText: '',
      headline: '',
    },
  ]);

  const [chatTemplates, setChatTemplates] = useState<MktChatTemplateRow[]>([]);
  const [selectedChatTemplateId, setSelectedChatTemplateId] = useState<string>('');

  // Chat Template Modal State (Create / Edit with Live Mobile Messenger Preview)
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState<boolean>(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | undefined>(undefined);
  const [modalTemplateName, setModalTemplateName] = useState<string>('');
  const [modalGreetingText, setModalGreetingText] = useState<string>('');
  const [modalIcebreakers, setModalIcebreakers] = useState<MktChatIcebreaker[]>([]);
  const [previewTappedIcebreaker, setPreviewTappedIcebreaker] = useState<string | null>(
    null
  );
  const [savingTemplateModal, setSavingTemplateModal] = useState<boolean>(false);

  // Step 4 State: Review Matrix & 1-Click Push to Meta
  const [launchStatus, setLaunchStatus] = useState<MktAdToggleStatus>('PAUSED');
  const [isPublishingBatch, setIsPublishingBatch] = useState<boolean>(false);
  const [publishProgressStep, setPublishProgressStep] = useState<number>(0);
  const [publishTotalSteps, setPublishTotalSteps] = useState<number>(0);
  const [publishStatusLabel, setPublishStatusLabel] = useState<string>('');
  const [publishedResults, setPublishedResults] = useState<PublishedAdResultItem[]>([]);
  const [launchBatches, setLaunchBatches] = useState<MktLaunchBatchRow[]>([]);

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

  /**
   * Load Campaigns, Ad Sets, Saved Chat Templates, and Recent Launch Batches
   */
  const loadLauncherData = useCallback(async () => {
    setLoadingInit(true);
    try {
      const res = await fetch('/api/marketing/launcher', { cache: 'no-store' });
      const data = (await res.json()) as {
        campaigns?: MetaCampaignOption[];
        adSets?: MetaAdSetOption[];
        chatTemplates?: MktChatTemplateRow[];
        launchBatches?: MktLaunchBatchRow[];
      };

      const loadedCampaigns = data.campaigns || [];
      const loadedAdSets = data.adSets || [];
      const loadedTemplates = data.chatTemplates || [];

      setCampaigns(loadedCampaigns);
      setAdSets(loadedAdSets);
      setChatTemplates(loadedTemplates);
      setLaunchBatches(data.launchBatches || []);

      if (loadedCampaigns.length > 0) {
        const firstCampId = loadedCampaigns[0].id;
        setSelectedCampaignId((prev) => prev || firstCampId);
        const matchingAdSet = loadedAdSets.find((a) => a.campaign_id === firstCampId);
        if (matchingAdSet) {
          setSelectedAdSetId((prev) => prev || matchingAdSet.id);
        } else if (loadedAdSets.length > 0) {
          setSelectedAdSetId((prev) => prev || loadedAdSets[0].id);
        }
      }

      if (loadedTemplates.length > 0) {
        setSelectedChatTemplateId((prev) => prev || loadedTemplates[0].id);
      }
    } catch (error) {
      pushToast(
        'error',
        'Failed loading launcher metadata',
        error instanceof Error ? error.message : 'Unable to load launcher config.'
      );
    } finally {
      setLoadingInit(false);
    }
  }, [pushToast]);

  useEffect(() => {
    loadLauncherData();
  }, [loadLauncherData]);

  // Pre-fill from Social Post Studio ("Promote in Ad Launcher") if present in localStorage
  useEffect(() => {
    try {
      const rawDraft = localStorage.getItem('mkt_promote_post_draft');
      if (!rawDraft) return;
      localStorage.removeItem('mkt_promote_post_draft');
      const parsed = JSON.parse(rawDraft) as {
        postId?: string;
        message?: string;
        mediaUrl?: string | null;
        mediaType?: 'TEXT' | 'IMAGE' | 'VIDEO';
      };

      if (parsed.message) {
        setOfferDescription(parsed.message);
        setPromoName('BoostedPagePost');
        setCopyVariations((prev) =>
          prev.map((item, idx) =>
            idx === 0
              ? {
                  ...item,
                  enabled: true,
                  primaryText: parsed.message || '',
                  headline:
                    item.headline || 'Send Message for Instant Package Quote 💬',
                }
              : item
          )
        );
      }

      if (parsed.mediaUrl) {
        const isVid =
          parsed.mediaType === 'VIDEO' || parsed.mediaUrl.startsWith('data:video/');
        setCreatives([
          {
            localId: `promoted-post-${Date.now()}`,
            fileName: `post_${parsed.postId || 'creative'}`,
            type: isVid ? 'VIDEO' : 'IMAGE',
            formatLabel: isVid ? 'Reel' : 'Static',
            creatorName: 'PagePost',
            previewUrl: parsed.mediaUrl,
            fileUrlOrBase64: parsed.mediaUrl,
          },
        ]);
      }

      pushToast(
        'success',
        'Pre-Filled from Social Post Studio!',
        'Loaded your post caption and media into the Ad Launcher.'
      );
    } catch {
      // ignore malformed storage
    }
  }, [pushToast]);

  // Current Year-Month prefix (`YYYY-MM`)
  const currentYearMonth = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  // Live Standardized Ad Name Preview (`2026-10_BundlePromo_Reel_EditorJuan_V1`)
  const liveAdNamePreview = useMemo(() => {
    const cleanPromo = sanitizeSegment(promoName, 'Promo');
    const cleanFormat = sanitizeSegment(creativeFormat, 'Reel');
    const cleanCreator = sanitizeSegment(creatorName, 'Creator');
    return `${currentYearMonth}_${cleanPromo}_${cleanFormat}_${cleanCreator}_V1`;
  }, [currentYearMonth, promoName, creativeFormat, creatorName]);

  // Ad Sets filtered by selected Campaign
  const filteredAdSets = useMemo(() => {
    if (!selectedCampaignId) return adSets;
    const matches = adSets.filter((a) => a.campaign_id === selectedCampaignId);
    return matches.length > 0 ? matches : adSets;
  }, [adSets, selectedCampaignId]);

  const selectedChatTemplate = useMemo(
    () => chatTemplates.find((t) => t.id === selectedChatTemplateId) || null,
    [chatTemplates, selectedChatTemplateId]
  );

  const enabledCopyVariations = useMemo(
    () => copyVariations.filter((c) => c.enabled && c.primaryText.trim()),
    [copyVariations]
  );

  // Full Matrix of Combinations (`Creatives × Copy Hooks = Total Ads`)
  const adMatrixCombinations = useMemo(() => {
    const cleanPromo = sanitizeSegment(promoName, 'Promo');
    const combinations: Array<{
      versionNumber: number;
      adName: string;
      creative: StagedCreativeAsset;
      copy: CopyVariationCard;
    }> = [];

    let counter = 0;
    for (const creative of creatives) {
      const fmt = sanitizeSegment(creative.formatLabel || creativeFormat, 'Reel');
      const creator = sanitizeSegment(
        creative.creatorName || creatorName,
        'Editor'
      );

      for (const copy of enabledCopyVariations) {
        counter += 1;
        combinations.push({
          versionNumber: counter,
          adName: `${currentYearMonth}_${cleanPromo}_${fmt}_${creator}_V${counter}`,
          creative,
          copy,
        });
      }
    }

    return combinations;
  }, [creatives, enabledCopyVariations, currentYearMonth, promoName, creativeFormat, creatorName]);

  /**
   * Step 2 File Upload Handlers (Drag & Drop + Multi-File Picker)
   */
  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    const filesArray = Array.from(fileList);
    const newStaged: StagedCreativeAsset[] = [];

    for (const file of filesArray) {
      const isVideo = file.type.startsWith('video/');
      const isImage = file.type.startsWith('image/');
      if (!isVideo && !isImage) continue;

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed reading file'));
        reader.readAsDataURL(file);
      });

      newStaged.push({
        localId: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        fileName: file.name,
        type: isVideo ? 'VIDEO' : 'IMAGE',
        formatLabel: isVideo ? 'Reel' : creativeFormat === 'Reel' ? 'Static' : creativeFormat,
        creatorName: creatorName || 'EditorJuan',
        previewUrl: dataUrl,
        fileUrlOrBase64: dataUrl,
        sizeBytes: file.size,
      });
    }

    if (newStaged.length > 0) {
      setCreatives((prev) => [...prev, ...newStaged]);
      pushToast(
        'success',
        'Creatives Staged',
        `Added ${newStaged.length} creative file(s) to the batch.`
      );
    }
  };

  const handleAddExternalUrlCreative = () => {
    const cleanUrl = externalMediaUrlInput.trim();
    if (!cleanUrl) return;

    const fileNameFromUrl =
      cleanUrl.split('/').pop()?.split('?')[0] ||
      `${externalMediaType.toLowerCase()}_asset`;

    setCreatives((prev) => [
      ...prev,
      {
        localId: `url-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        fileName: fileNameFromUrl,
        type: externalMediaType,
        formatLabel: externalMediaType === 'VIDEO' ? 'Reel' : 'Static',
        creatorName: creatorName || 'EditorJuan',
        previewUrl: cleanUrl,
        fileUrlOrBase64: cleanUrl,
      },
    ]);
    setExternalMediaUrlInput('');
  };

  const handleRemoveCreative = (localId: string) => {
    setCreatives((prev) => prev.filter((c) => c.localId !== localId));
  };

  /**
   * Step 3 Handler: Generate 3 Copy Hooks + 3 Headlines with Gemini (`POST /api/marketing/generate-copy`)
   */
  const handleGenerateCopyWithAi = async () => {
    if (generatingAiCopy) return;
    const effectiveOffer =
      offerDescription.trim() || promoName.trim() || 'Click-to-Message Promo Offer';
    setGeneratingAiCopy(true);

    try {
      const res = await fetch('/api/marketing/generate-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offerDescription: effectiveOffer,
          pricePoint: pricePointInput,
        }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        hooks?: MktGeneratedCopyHook[];
        headlines?: string[];
        error?: string;
      };

      if (!res.ok || !data.hooks) {
        throw new Error(data.error || 'Failed generating AI ad copy.');
      }

      const headlines = data.headlines || [];
      const updatedCards: CopyVariationCard[] = data.hooks.map((hook, idx) => ({
        id: `ai-hook-${idx + 1}-${Date.now()}`,
        enabled: true,
        angleLabel: hook.label || hook.angle,
        primaryText: hook.primaryText,
        headline:
          headlines[idx] ||
          headlines[0] ||
          'Tap Send Message for Instant Price Quote 💬',
      }));

      setCopyVariations(updatedCards);
      pushToast(
        'success',
        '3 AI Copy Hooks Generated',
        'Populated Direct Promo, Problem/Agitate/Solve, and Taglish Conversational hooks.'
      );
    } catch (error) {
      pushToast(
        'error',
        'AI Copy Generation Failed',
        error instanceof Error ? error.message : 'Unable to generate copy.'
      );
    } finally {
      setGeneratingAiCopy(false);
    }
  };

  /**
   * Step 3 Modal Handlers: Open Create / Edit Chat Greeting & Icebreaker Modal
   */
  const handleOpenCreateTemplateModal = () => {
    setEditingTemplateId(undefined);
    setModalTemplateName('');
    setModalGreetingText('');
    setModalIcebreakers([{ question: '', payload: '' }]);
    setPreviewTappedIcebreaker(null);
    setIsTemplateModalOpen(true);
  };

  const handleOpenEditTemplateModal = () => {
    if (!selectedChatTemplate) {
      handleOpenCreateTemplateModal();
      return;
    }
    setEditingTemplateId(selectedChatTemplate.id);
    setModalTemplateName(selectedChatTemplate.template_name);
    setModalGreetingText(selectedChatTemplate.greeting_text);
    setModalIcebreakers(
      selectedChatTemplate.icebreakers?.length > 0
        ? selectedChatTemplate.icebreakers
        : [{ question: '', payload: '' }]
    );
    setPreviewTappedIcebreaker(null);
    setIsTemplateModalOpen(true);
  };

  const handleSaveChatTemplateModal = async () => {
    if (savingTemplateModal) return;
    setSavingTemplateModal(true);

    try {
      const res = await fetch('/api/marketing/launcher', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingTemplateId,
          template_name: modalTemplateName,
          greeting_text: modalGreetingText,
          icebreakers: modalIcebreakers,
        }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        chatTemplate?: MktChatTemplateRow;
        error?: string;
      };

      if (!res.ok || !data.chatTemplate) {
        throw new Error(data.error || 'Failed saving chat template.');
      }

      const saved = data.chatTemplate;
      setChatTemplates((prev) => {
        const exists = prev.some((t) => t.id === saved.id);
        if (exists) {
          return prev.map((t) => (t.id === saved.id ? saved : t));
        }
        return [saved, ...prev];
      });
      setSelectedChatTemplateId(saved.id);
      setIsTemplateModalOpen(false);

      pushToast(
        'success',
        'Chat Greeting Template Saved',
        `"${saved.template_name}" is ready for Click-to-Messenger/IG ads.`
      );
    } catch (error) {
      pushToast(
        'error',
        'Template Save Failed',
        error instanceof Error ? error.message : 'Could not save template.'
      );
    } finally {
      setSavingTemplateModal(false);
    }
  };

  /**
   * Step 4 Handler: Push Batch to Meta Ads Manager with Step-by-Step Progress Bar
   */
  const handlePushBatchToMeta = async () => {
    if (isPublishingBatch) return;

    const resolvedCampaignId =
      selectedCampaignId.trim() || campaigns[0]?.id || '';
    const resolvedAdSetId =
      selectedAdSetId.trim() || filteredAdSets[0]?.id || adSets[0]?.id || '';

    if (!resolvedCampaignId || !resolvedAdSetId) {
      pushToast(
        'error',
        'Missing Target Campaign or Ad Set',
        'Please select a target Campaign and Ad Set in Step 1.'
      );
      setCurrentStep(1);
      return;
    }

    if (creatives.length === 0) {
      pushToast(
        'error',
        'No Creatives Uploaded',
        'Please upload at least one image or video in Step 2.'
      );
      setCurrentStep(2);
      return;
    }

    if (enabledCopyVariations.length === 0) {
      pushToast(
        'error',
        'No Copy Hooks Enabled',
        'Please enable at least one Primary Text & Headline variation in Step 3.'
      );
      setCurrentStep(3);
      return;
    }

    setIsPublishingBatch(true);
    setPublishedResults([]);

    const totalSteps = creatives.length + adMatrixCombinations.length + 1;
    setPublishTotalSteps(totalSteps);
    setPublishProgressStep(1);

    try {
      // Phase A: Upload each creative to `/adimages` or `/advideos` with step-by-step progress
      const uploadedCreatives = [...creatives];
      for (let i = 0; i < uploadedCreatives.length; i++) {
        const item = uploadedCreatives[i];
        setPublishProgressStep(i + 1);
        setPublishStatusLabel(
          `Uploading creative ${i + 1} of ${uploadedCreatives.length} (${item.fileName}) to Meta Graph API...`
        );

        if (!item.mediaHashOrId) {
          const uploadRes = await fetch('/api/marketing/launcher', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'UPLOAD_MEDIA',
              fileUrlOrBase64: item.fileUrlOrBase64,
              type: item.type,
            }),
          });

          const uploadData = (await uploadRes.json()) as {
            success?: boolean;
            uploaded?: { mediaHashOrId: string; thumbnailUrl?: string | null };
            error?: string;
          };

          if (!uploadRes.ok || !uploadData.uploaded?.mediaHashOrId) {
            throw new Error(
              uploadData.error || `Failed uploading creative "${item.fileName}".`
            );
          }

          uploadedCreatives[i] = {
            ...item,
            mediaHashOrId: uploadData.uploaded.mediaHashOrId,
          };
        }
      }

      // Phase B: Publish Ad Creatives + Ads Batch & Sync to `mkt_ads_catalog`
      setPublishProgressStep(uploadedCreatives.length + Math.ceil(adMatrixCombinations.length / 2));
      setPublishStatusLabel(
        `Creating ${adMatrixCombinations.length} Click-to-Message Ad Creatives & Ads in Meta Ads Manager...`
      );

      const selectedCampaignObj = campaigns.find((c) => c.id === resolvedCampaignId);
      const selectedAdSetObj = adSets.find((a) => a.id === resolvedAdSetId);

      const publishRes = await fetch('/api/marketing/launcher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'PUBLISH_BATCH',
          campaignId: resolvedCampaignId,
          campaignName: selectedCampaignObj?.name || undefined,
          adsetId: resolvedAdSetId,
          adsetName: selectedAdSetObj?.name || undefined,
          promoName,
          defaultCreatorName: creatorName,
          yearMonthOverride: currentYearMonth,
          launchStatus,
          chatTemplateId: selectedChatTemplateId || undefined,
          creatives: uploadedCreatives.map((c) => ({
            mediaHashOrId: c.mediaHashOrId,
            fileUrlOrBase64: c.fileUrlOrBase64,
            type: c.type,
            formatLabel: c.formatLabel,
            creatorName: c.creatorName,
            thumbnailUrl: c.previewUrl.startsWith('http') ? c.previewUrl : null,
          })),
          copyVariations: enabledCopyVariations.map((v) => ({
            primaryText: v.primaryText,
            headline: v.headline,
            angleLabel: v.angleLabel,
          })),
        }),
      });

      const publishData = (await publishRes.json()) as {
        success?: boolean;
        batch?: MktLaunchBatchRow;
        publishedAds?: PublishedAdResultItem[];
        error?: string;
      };

      if (!publishRes.ok || !publishData.success) {
        throw new Error(
          publishData.error || 'Failed publishing batch to Meta Ads Manager.'
        );
      }

      const isDevSandbox = (publishData.publishedAds || []).some((a) =>
        a.adId.startsWith('dev_ad_')
      );

      setPublishProgressStep(totalSteps);
      setPublishStatusLabel(
        isDevSandbox
          ? `Image uploaded to Meta Media Library! Saved ${publishData.publishedAds?.length ?? 0} ad(s) in Dev Sandbox Mode (switch Meta App #2230747944153516 to "Live" at developers.facebook.com so Meta allows creating live Ad Creatives).`
          : `Successfully published ${publishData.publishedAds?.length ?? 0} ads live to Meta Ads Manager and synced to mkt_ads_catalog!`
      );
      setPublishedResults(publishData.publishedAds || []);
      if (publishData.batch) {
        setLaunchBatches((prev) => [publishData.batch!, ...prev]);
      }

      pushToast(
        isDevSandbox ? 'info' : 'success',
        isDevSandbox
          ? 'Saved in Dev Mode (Meta App is in Development Mode)'
          : 'Batch Pushed Live to Meta Ads Manager!',
        isDevSandbox
          ? 'Your photo was uploaded to Meta Ad Account act_4493210337587688, but Meta blocked the final Ad Creative because App #2230747944153516 is still in "Development Mode". Toggle App Mode to "Live" at developers.facebook.com!'
          : `Created ${publishData.publishedAds?.length ?? 0} ads in ${launchStatus} status and synced to mkt_ads_catalog.`
      );
    } catch (error) {
      pushToast(
        'error',
        'Bulk Launch Failed',
        error instanceof Error ? error.message : 'Error pushing batch to Meta API.'
      );
    } finally {
      setIsPublishingBatch(false);
    }
  };

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

      {/* Main Container */}
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Top Header */}
        <header className="flex flex-col gap-4 rounded-2xl border border-slate-800/90 bg-slate-900/60 p-5 shadow-lg">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <Link
                  href="/marketing/attribution"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/80 px-2.5 py-1 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white transition"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Attribution Command Center
                </Link>
                <Link
                  href="/marketing/watchdog"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/80 px-2.5 py-1 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white transition"
                >
                  <ShieldCheck className="h-3.5 w-3.5 text-indigo-400" />
                  24/7 Watchdog &amp; Comment Shield
                </Link>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-300 ring-1 ring-inset ring-indigo-500/25">
                  <Rocket className="h-3.5 w-3.5" />
                  60-Second Click-to-Message Bulk Publisher
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Bulk Ad Launcher Studio
              </h1>
              <p className="text-sm text-slate-400">
                Standardized taxonomy naming, multi-creative batch upload, Gemini 2.5 Flash copy matrix, and Messenger Icebreaker templates.
              </p>
            </div>

            {/* Live Ad Name Preview Badge */}
            <div className="rounded-xl border border-indigo-500/30 bg-slate-950/90 px-4 py-2.5">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-indigo-400">
                Standardized Ad Name Preview
              </span>
              <code className="mt-0.5 block font-mono text-xs sm:text-sm font-bold text-emerald-300">
                {liveAdNamePreview}
              </code>
            </div>
          </div>

          {/* 4-Step Wizard Stepper Navigation */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 pt-3 border-t border-slate-800/80">
            {[
              {
                step: 1 as const,
                title: '1. Destination & Taxonomy',
                subtitle: 'Campaign, Ad Set & Naming',
              },
              {
                step: 2 as const,
                title: '2. Creative Batch Upload',
                subtitle: `${creatives.length} asset(s) staged`,
              },
              {
                step: 3 as const,
                title: '3. AI Copy & Chat Template',
                subtitle: `${enabledCopyVariations.length} hooks • Icebreakers`,
              },
              {
                step: 4 as const,
                title: '4. Review & Push to Meta',
                subtitle: `${adMatrixCombinations.length} total ads ready`,
              },
            ].map((item) => {
              const isCurrent = currentStep === item.step;
              const isCompleted = currentStep > item.step;

              return (
                <button
                  key={item.step}
                  type="button"
                  onClick={() => setCurrentStep(item.step)}
                  className={`flex items-center gap-3 rounded-xl border p-3 text-left transition cursor-pointer ${
                    isCurrent
                      ? 'border-indigo-500 bg-indigo-600/15 text-white shadow-md'
                      : isCompleted
                        ? 'border-emerald-500/30 bg-emerald-950/20 text-slate-200'
                        : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                      isCurrent
                        ? 'bg-indigo-600 text-white'
                        : isCompleted
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {isCompleted ? <Check className="h-4 w-4" /> : item.step}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-bold truncate">{item.title}</p>
                    <p className="text-[11px] text-slate-400 truncate">{item.subtitle}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </header>

        {loadingInit ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 py-20 text-center">
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-indigo-400" />
            <p className="mt-3 text-sm text-slate-400">
              Loading Meta Campaigns, Ad Sets &amp; Saved Messenger Templates...
            </p>
          </div>
        ) : (
          <>
            {/* ================================================================
                STEP 1: Destination & Taxonomy Naming Enforcer
               ================================================================ */}
            {currentStep === 1 && (
              <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Target Campaign & Ad Set Selection */}
                <div className="lg:col-span-6 rounded-2xl border border-slate-800/90 bg-slate-900/70 p-6 shadow-xl space-y-5">
                  <div className="flex items-center gap-2.5">
                    <FolderKanban className="h-5 w-5 text-indigo-400" />
                    <div>
                      <h2 className="text-base font-bold text-white">
                        Target Meta Campaign &amp; Ad Set
                      </h2>
                      <p className="text-xs text-slate-400">
                        Select where new Click-to-Messenger / IG DM ads will be published
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Target Campaign
                      </label>
                      {campaigns.length > 0 ? (
                        <select
                          value={selectedCampaignId}
                          onChange={(e) => {
                            const nextCampId = e.target.value;
                            setSelectedCampaignId(nextCampId);
                            const firstAdSet = adSets.find(
                              (a) => a.campaign_id === nextCampId
                            );
                            if (firstAdSet) setSelectedAdSetId(firstAdSet.id);
                          }}
                          className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950/90 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                        >
                          {campaigns.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} ({c.status}) — #{c.id}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={selectedCampaignId}
                          onChange={(e) => setSelectedCampaignId(e.target.value)}
                          placeholder="Enter Meta Campaign ID (e.g. 12021000000000)"
                          className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950/90 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                        />
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Target Ad Set (Conversations / Leads Optimization)
                      </label>
                      {filteredAdSets.length > 0 ? (
                        <select
                          value={selectedAdSetId}
                          onChange={(e) => setSelectedAdSetId(e.target.value)}
                          className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950/90 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                        >
                          {filteredAdSets.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.is_messaging_optimized ? '💬 ' : ''}
                              {a.name} [{a.optimization_goal}] — #{a.id}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={selectedAdSetId}
                          onChange={(e) => setSelectedAdSetId(e.target.value)}
                          placeholder="Enter Meta Ad Set ID (e.g. 12021000000001)"
                          className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950/90 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                        />
                      )}
                    </div>
                  </div>
                </div>

                {/* Structured Naming Taxonomy Builder */}
                <div className="lg:col-span-6 rounded-2xl border border-slate-800/90 bg-slate-900/70 p-6 shadow-xl space-y-5">
                  <div className="flex items-center gap-2.5">
                    <Tag className="h-5 w-5 text-emerald-400" />
                    <div>
                      <h2 className="text-base font-bold text-white">
                        Taxonomy Naming Enforcer
                      </h2>
                      <p className="text-xs text-slate-400">
                        Enforces <code className="text-slate-300">YYYY-MM_[PromoName]_[Format]_[Creator]_V#</code> across every ad
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Promo / Offer Name
                      </label>
                      <input
                        type="text"
                        value={promoName}
                        onChange={(e) => setPromoName(e.target.value)}
                        placeholder="BundlePromo"
                        className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950/90 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Creative Format
                      </label>
                      <select
                        value={creativeFormat}
                        onChange={(e) =>
                          setCreativeFormat(e.target.value as CreativeFormatType)
                        }
                        className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950/90 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                      >
                        <option value="Reel">Reel</option>
                        <option value="Static">Static</option>
                        <option value="Carousel">Carousel</option>
                        <option value="UGC">UGC</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Creator / Editor Name
                      </label>
                      <input
                        type="text"
                        value={creatorName}
                        onChange={(e) => setCreatorName(e.target.value)}
                        placeholder="EditorJuan"
                        className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950/90 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Live Generated Name Preview Box */}
                  <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-4">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                      Auto-Generated Standardized Ad Name (V1 Preview)
                    </span>
                    <p className="mt-1 font-mono text-base sm:text-lg font-bold text-white break-all">
                      {liveAdNamePreview}
                    </p>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      onClick={() => setCurrentStep(2)}
                      className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 transition cursor-pointer"
                    >
                      Continue to Step 2: Upload Creatives
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* ================================================================
                STEP 2: Creative Asset Batch Uploader
               ================================================================ */}
            {currentStep === 2 && (
              <section className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-6 shadow-xl space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                      <UploadCloud className="h-5 w-5 text-indigo-400" />
                      Step 2: Creative Asset Batch Uploader
                    </h2>
                    <p className="text-xs sm:text-sm text-slate-400">
                      Drag and drop multiple images or videos. Each asset will be paired with your enabled AI copy hooks.
                    </p>
                  </div>
                  <span className="inline-flex items-center rounded-xl bg-indigo-500/15 px-3 py-1.5 text-xs font-bold text-indigo-300">
                    {creatives.length} Creative Asset(s) Staged
                  </span>
                </div>

                {/* Drag-and-Drop Multi-File Zone */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingOver(true);
                  }}
                  onDragLeave={() => setIsDraggingOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDraggingOver(false);
                    handleFilesSelected(e.dataTransfer.files);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition cursor-pointer ${
                    isDraggingOver
                      ? 'border-indigo-400 bg-indigo-500/10'
                      : 'border-slate-700/80 bg-slate-950/60 hover:border-indigo-500/60 hover:bg-slate-900/60'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,video/*"
                    onChange={(e) => handleFilesSelected(e.target.files)}
                    className="hidden"
                  />
                  <div className="rounded-2xl bg-indigo-500/15 p-4 text-indigo-400 ring-1 ring-indigo-500/30">
                    <UploadCloud className="h-8 w-8" />
                  </div>
                  <p className="mt-4 text-base font-bold text-white">
                    Drag &amp; drop images or videos here, or click to browse
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Supports JPG, PNG, WebP (`POST /adimages`) and MP4, MOV (`POST /advideos`)
                  </p>
                </div>

                {/* Optional Direct URL / Hosted Asset Adder */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                  <select
                    value={externalMediaType}
                    onChange={(e) =>
                      setExternalMediaType(e.target.value as 'IMAGE' | 'VIDEO')
                    }
                    className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200"
                  >
                    <option value="VIDEO">Video URL</option>
                    <option value="IMAGE">Image URL</option>
                  </select>
                  <input
                    type="url"
                    value={externalMediaUrlInput}
                    onChange={(e) => setExternalMediaUrlInput(e.target.value)}
                    placeholder="Or paste a direct CDN Image / Video URL (https://...)..."
                    className="flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs sm:text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddExternalUrlCreative}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 px-4 py-2 text-xs font-semibold text-white transition cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                    Add URL Asset
                  </button>
                </div>

                {/* Staged Creatives Thumbnail Grid */}
                {creatives.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {creatives.map((item, idx) => (
                      <div
                        key={item.localId}
                        className="group relative flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-950/90 overflow-hidden shadow-md"
                      >
                        <div className="relative h-44 w-full bg-slate-900 flex items-center justify-center overflow-hidden">
                          {item.type === 'IMAGE' ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.previewUrl}
                              alt={item.fileName}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <video
                              src={item.previewUrl}
                              className="h-full w-full object-cover"
                              muted
                              playsInline
                              controls
                            />
                          )}
                          <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 rounded-md bg-slate-950/85 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-300 ring-1 ring-slate-700">
                            {item.type === 'VIDEO' ? (
                              <FileVideo className="h-3 w-3" />
                            ) : (
                              <ImageIcon className="h-3 w-3" />
                            )}
                            #{idx + 1} {item.type}
                          </span>

                          <button
                            type="button"
                            onClick={() => handleRemoveCreative(item.localId)}
                            className="absolute top-2.5 right-2.5 rounded-lg bg-rose-950/90 p-1.5 text-rose-300 hover:bg-rose-600 hover:text-white transition cursor-pointer"
                            title="Remove creative"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="p-3.5 space-y-2">
                          <p
                            className="text-xs font-semibold text-white truncate"
                            title={item.fileName}
                          >
                            {item.fileName}
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              value={item.formatLabel}
                              onChange={(e) => {
                                const val = e.target.value as CreativeFormatType;
                                setCreatives((prev) =>
                                  prev.map((c) =>
                                    c.localId === item.localId
                                      ? { ...c, formatLabel: val }
                                      : c
                                  )
                                );
                              }}
                              className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] text-slate-200"
                            >
                              <option value="Reel">Reel</option>
                              <option value="Static">Static</option>
                              <option value="Carousel">Carousel</option>
                              <option value="UGC">UGC</option>
                            </select>

                            <input
                              type="text"
                              value={item.creatorName}
                              onChange={(e) => {
                                const val = e.target.value;
                                setCreatives((prev) =>
                                  prev.map((c) =>
                                    c.localId === item.localId
                                      ? { ...c, creatorName: val }
                                      : c
                                  )
                                );
                              }}
                              placeholder="Creator"
                              className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] text-slate-200"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setCurrentStep(1)}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-300 hover:text-white cursor-pointer"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back to Step 1
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentStep(3)}
                    className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 transition cursor-pointer"
                  >
                    Continue to Step 3: AI Copy &amp; Chat Template
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </section>
            )}

            {/* ================================================================
                STEP 3: AI Copy Matrix & Saved Chat Greeting Template
               ================================================================ */}
            {currentStep === 3 && (
              <section className="space-y-6">
                {/* Top AI Promo Offer Generator Bar */}
                <div className="rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-indigo-950/40 via-slate-900/90 to-slate-900 p-6 shadow-xl space-y-4">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        <Wand2 className="h-5 w-5 text-indigo-400" />
                        Step 3: AI Copy Matrix &amp; Saved Messenger Greeting
                      </h2>
                      <p className="text-xs sm:text-sm text-slate-300">
                        Describe your promo offer and let Gemini 2.5 Flash write 3 high-converting Click-to-Message hooks &amp; headlines.
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={generatingAiCopy}
                      onClick={handleGenerateCopyWithAi}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 px-5 py-3 text-xs sm:text-sm font-bold text-white shadow-lg shadow-indigo-600/30 transition cursor-pointer shrink-0"
                    >
                      {generatingAiCopy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      {generatingAiCopy
                        ? 'Generating 3 Hooks with Gemini...'
                        : '✨ Generate 3 Copy Hooks with AI'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                    <div className="md:col-span-9">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Promo Offer Description
                      </label>
                      <input
                        type="text"
                        value={offerDescription}
                        onChange={(e) => setOfferDescription(e.target.value)}
                        placeholder="Describe your promo offer, bundle inclusions, and urgency hook..."
                        className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950/90 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div className="md:col-span-3">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Price / Offer Callout
                      </label>
                      <input
                        type="text"
                        value={pricePointInput}
                        onChange={(e) => setPricePointInput(e.target.value)}
                        placeholder="₱1,499 Promo Bundle"
                        className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950/90 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* 3 Editable Copy Hook Cards */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                  {copyVariations.map((card, index) => (
                    <div
                      key={card.id}
                      className={`flex flex-col justify-between rounded-2xl border p-5 shadow-xl transition ${
                        card.enabled
                          ? 'border-slate-800 bg-slate-900/75'
                          : 'border-slate-800/50 bg-slate-950/40 opacity-60'
                      }`}
                    >
                      <div className="space-y-4">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500/15 px-2.5 py-1 text-xs font-bold text-indigo-300 ring-1 ring-indigo-500/30">
                            Hook #{index + 1}: {card.angleLabel}
                          </span>
                          <label className="inline-flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={card.enabled}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setCopyVariations((prev) =>
                                  prev.map((item) =>
                                    item.id === card.id
                                      ? { ...item, enabled: checked }
                                      : item
                                  )
                                );
                              }}
                              className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-indigo-600"
                            />
                            Include
                          </label>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                            Primary Text
                          </label>
                          <textarea
                            rows={6}
                            value={card.primaryText}
                            onChange={(e) => {
                              const val = e.target.value;
                              setCopyVariations((prev) =>
                                prev.map((item) =>
                                  item.id === card.id
                                    ? { ...item, primaryText: val }
                                    : item
                                )
                              );
                            }}
                            className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950/90 p-3 text-xs sm:text-sm text-slate-100 leading-relaxed focus:border-indigo-500 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                            Messenger CTA Headline
                          </label>
                          <input
                            type="text"
                            value={card.headline}
                            onChange={(e) => {
                              const val = e.target.value;
                              setCopyVariations((prev) =>
                                prev.map((item) =>
                                  item.id === card.id
                                    ? { ...item, headline: val }
                                    : item
                                )
                              );
                            }}
                            className="mt-1.5 w-full rounded-xl border border-slate-800 bg-slate-950/90 px-3 py-2 text-xs sm:text-sm font-semibold text-white focus:border-indigo-500 focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Saved Messenger / IG Welcome Greeting & Icebreaker Selector */}
                <div className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-6 shadow-xl">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <h3 className="text-base font-bold text-white flex items-center gap-2">
                        <MessageCircle className="h-5 w-5 text-sky-400" />
                        Messenger &amp; Instagram Welcome Greeting &amp; Icebreakers
                      </h3>
                      <p className="text-xs text-slate-400">
                        Attached to <code className="text-slate-300">object_story_spec.page_welcome_message</code> when the user clicks &ldquo;Send Message&rdquo;.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        onClick={handleOpenEditTemplateModal}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:border-indigo-500 hover:text-white transition cursor-pointer"
                      >
                        <Smartphone className="h-3.5 w-3.5 text-sky-400" />
                        Preview / Edit Selected Template
                      </button>

                      <button
                        type="button"
                        onClick={handleOpenCreateTemplateModal}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 px-3.5 py-2 text-xs font-semibold text-white transition cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        New Chat Template
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
                    <div className="lg:col-span-6 space-y-3">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Select Saved Chat Template (`mkt_chat_templates`)
                      </label>
                      <select
                        value={selectedChatTemplateId}
                        onChange={(e) => setSelectedChatTemplateId(e.target.value)}
                        className="w-full rounded-xl border border-slate-800 bg-slate-950/90 px-3.5 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                      >
                        {chatTemplates.map((tpl) => (
                          <option key={tpl.id} value={tpl.id}>
                            {tpl.template_name} ({tpl.icebreakers?.length || 0} icebreakers)
                          </option>
                        ))}
                      </select>

                      {selectedChatTemplate && (
                        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2">
                          <p className="text-xs text-slate-300 leading-relaxed">
                            <strong className="text-slate-400">Greeting:</strong>{' '}
                            {selectedChatTemplate.greeting_text}
                          </p>
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {(selectedChatTemplate.icebreakers || []).map((ib, idx) => (
                              <span
                                key={idx}
                                className="rounded-lg bg-sky-500/15 px-2.5 py-1 text-xs font-medium text-sky-300 ring-1 ring-sky-500/30"
                              >
                                {ib.question}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Compact Mobile Preview Summary */}
                    <div className="lg:col-span-6 rounded-2xl border border-slate-800 bg-slate-950/90 p-4">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 mb-3">
                        <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                          <Smartphone className="h-4 w-4 text-sky-400" />
                          Messenger Icebreaker Preview
                        </span>
                        <span className="text-[11px] text-emerald-400 font-medium">
                          CTA: MESSAGE_PAGE
                        </span>
                      </div>
                      {selectedChatTemplate && (
                        <div className="space-y-2.5">
                          <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-slate-800 px-3.5 py-2.5 text-xs text-slate-100">
                            {selectedChatTemplate.greeting_text.replace(
                              /\{\{user_first_name\}\}/g,
                              'Maria'
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1.5 pt-1">
                            {(selectedChatTemplate.icebreakers || []).map((ib, idx) => (
                              <div
                                key={idx}
                                className="rounded-full border border-sky-500/40 bg-sky-500/10 px-3.5 py-1.5 text-xs font-medium text-sky-300"
                              >
                                {ib.question}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => setCurrentStep(2)}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-300 hover:text-white cursor-pointer"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back to Step 2
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentStep(4)}
                    className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2.5 text-xs sm:text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 transition cursor-pointer"
                  >
                    Continue to Step 4: Review Matrix &amp; Push
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </section>
            )}

            {/* ================================================================
                STEP 4: Review Matrix & 1-Click Push to Meta
               ================================================================ */}
            {currentStep === 4 && (
              <section className="space-y-6">
                <div className="rounded-2xl border border-slate-800/90 bg-slate-900/70 p-6 shadow-xl space-y-6">
                  {/* Top Summary Banner: X Creatives × Y Copy Hooks = Z Ads */}
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 rounded-2xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/50 via-slate-900 to-slate-900 p-5">
                    <div className="space-y-1">
                      <span className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
                        Step 4: Final Combination Matrix
                      </span>
                      <h2 className="text-2xl sm:text-3xl font-extrabold text-white">
                        {creatives.length} Creatives &times; {enabledCopyVariations.length}{' '}
                        Copy Hooks ={' '}
                        <span className="text-emerald-400">
                          {adMatrixCombinations.length} Ads
                        </span>
                      </h2>
                      <p className="text-xs sm:text-sm text-slate-300">
                        All created ads will be automatically synced into{' '}
                        <code className="text-indigo-300">mkt_ads_catalog</code> for immediate attribution tracking.
                      </p>
                    </div>

                    {/* Radio Selector: Launch as PAUSED (Recommended) or ACTIVE */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                      <label
                        onClick={() => setLaunchStatus('PAUSED')}
                        className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 text-xs sm:text-sm font-semibold cursor-pointer transition ${
                          launchStatus === 'PAUSED'
                            ? 'border-amber-500/60 bg-amber-500/15 text-amber-200'
                            : 'border-slate-800 bg-slate-950/80 text-slate-400'
                        }`}
                      >
                        <input
                          type="radio"
                          name="launchStatus"
                          checked={launchStatus === 'PAUSED'}
                          onChange={() => setLaunchStatus('PAUSED')}
                          className="text-amber-500"
                        />
                        <PauseCircle className="h-4 w-4 text-amber-400" />
                        <div>
                          <div>Launch as PAUSED</div>
                          <div className="text-[10px] font-normal text-amber-300/80">
                            Recommended for Final Review
                          </div>
                        </div>
                      </label>

                      <label
                        onClick={() => setLaunchStatus('ACTIVE')}
                        className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 text-xs sm:text-sm font-semibold cursor-pointer transition ${
                          launchStatus === 'ACTIVE'
                            ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200'
                            : 'border-slate-800 bg-slate-950/80 text-slate-400'
                        }`}
                      >
                        <input
                          type="radio"
                          name="launchStatus"
                          checked={launchStatus === 'ACTIVE'}
                          onChange={() => setLaunchStatus('ACTIVE')}
                          className="text-emerald-500"
                        />
                        <PlayCircle className="h-4 w-4 text-emerald-400" />
                        <div>
                          <div>Launch as ACTIVE</div>
                          <div className="text-[10px] font-normal text-emerald-300/80">
                            Immediate Delivery
                          </div>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Step-by-Step Progress Bar during Publishing */}
                  {(isPublishingBatch || publishedResults.length > 0) && (
                    <div className="rounded-2xl border border-indigo-500/30 bg-slate-950/90 p-5 space-y-3">
                      <div className="flex items-center justify-between text-xs sm:text-sm">
                        <span className="font-semibold text-white flex items-center gap-2">
                          {isPublishingBatch ? (
                            <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                          )}
                          {publishStatusLabel}
                        </span>
                        <span className="font-mono text-xs text-indigo-300">
                          {publishTotalSteps > 0
                            ? `${Math.min(
                                Math.round(
                                  (publishProgressStep / publishTotalSteps) * 100
                                ),
                                100
                              )}%`
                            : '0%'}
                        </span>
                      </div>

                      <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-sky-400 to-emerald-400 transition-all duration-300"
                          style={{
                            width: `${
                              publishTotalSteps > 0
                                ? Math.min(
                                    (publishProgressStep / publishTotalSteps) * 100,
                                    100
                                  )
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Matrix Preview Table */}
                  <div className="overflow-x-auto rounded-xl border border-slate-800">
                    <table className="w-full border-collapse text-left text-xs sm:text-sm">
                      <thead className="bg-slate-950/90 border-b border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        <tr>
                          <th className="py-3 pl-4 pr-3 w-16">Ver</th>
                          <th className="py-3 px-3">Standardized Ad Name</th>
                          <th className="py-3 px-3">Creative</th>
                          <th className="py-3 px-3">Copy Angle &amp; Headline</th>
                          <th className="py-3 pl-3 pr-4 text-right">Initial Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {adMatrixCombinations.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-10 text-center text-slate-400">
                              Upload at least 1 creative in Step 2 and enable at least 1 copy hook in Step 3 to preview your batch matrix.
                            </td>
                          </tr>
                        ) : (
                          adMatrixCombinations.map((combo) => (
                            <tr key={combo.versionNumber} className="hover:bg-slate-800/30">
                              <td className="py-3 pl-4 pr-3 font-mono font-bold text-indigo-400">
                                V{combo.versionNumber}
                              </td>
                              <td className="py-3 px-3 font-mono text-xs font-semibold text-white">
                                {combo.adName}
                              </td>
                              <td className="py-3 px-3 text-slate-300">
                                {combo.creative.fileName} ({combo.creative.type})
                              </td>
                              <td className="py-3 px-3">
                                <div className="font-semibold text-indigo-300">
                                  {combo.copy.angleLabel}
                                </div>
                                <div className="text-xs text-slate-400 truncate max-w-md">
                                  {combo.copy.headline}
                                </div>
                              </td>
                              <td className="py-3 pl-3 pr-4 text-right">
                                <span
                                  className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-bold ${
                                    launchStatus === 'ACTIVE'
                                      ? 'bg-emerald-500/20 text-emerald-300'
                                      : 'bg-amber-500/20 text-amber-300'
                                  }`}
                                >
                                  {launchStatus}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Push Batch Action Bar */}
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
                    <button
                      type="button"
                      onClick={() => setCurrentStep(3)}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-300 hover:text-white cursor-pointer"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Back to Step 3
                    </button>

                    <button
                      type="button"
                      disabled={isPublishingBatch || adMatrixCombinations.length === 0}
                      onClick={handlePushBatchToMeta}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 disabled:opacity-50 px-7 py-3.5 text-sm sm:text-base font-extrabold text-white shadow-xl shadow-indigo-600/25 transition cursor-pointer"
                    >
                      {isPublishingBatch ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Rocket className="h-5 w-5" />
                      )}
                      {isPublishingBatch
                        ? 'Pushing Batch to Meta Ads Manager...'
                        : `🚀 Push Batch to Meta Ads Manager (${adMatrixCombinations.length} Ads)`}
                    </button>
                  </div>
                </div>

                {/* Recent Bulk Launch History (`mkt_launch_batches`) */}
                {launchBatches.length > 0 && (
                  <div className="rounded-2xl border border-slate-800/90 bg-slate-900/60 p-5 shadow-lg space-y-3">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Layers className="h-4 w-4 text-indigo-400" />
                      Recent Bulk Launch History (<code className="text-slate-300">mkt_launch_batches</code>)
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-slate-800 text-slate-400 uppercase">
                          <tr>
                            <th className="py-2 pr-3">Launched At</th>
                            <th className="py-2 px-3">Taxonomy Prefix</th>
                            <th className="py-2 px-3">Campaign / Ad Set</th>
                            <th className="py-2 px-3">Ads Created</th>
                            <th className="py-2 pl-3 text-right">Launch Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                          {launchBatches.map((b) => (
                            <tr key={b.id}>
                              <td className="py-2.5 pr-3 font-mono text-slate-400">
                                {new Date(b.created_at).toLocaleString('en-PH', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </td>
                              <td className="py-2.5 px-3 font-mono font-semibold text-white">
                                {b.taxonomy_prefix}
                              </td>
                              <td className="py-2.5 px-3 text-slate-300">
                                {b.campaign_name || b.campaign_id} &bull;{' '}
                                {b.adset_name || b.adset_id}
                              </td>
                              <td className="py-2.5 px-3 font-bold text-indigo-300">
                                {b.total_ads_created} ads
                              </td>
                              <td className="py-2.5 pl-3 text-right">
                                <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-slate-200">
                                  {b.launch_status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>

      {/* ====================================================================
          MODAL: Create / Edit Messenger Welcome Greeting & Icebreaker Template
          with Interactive Mobile Messenger Preview on the Right
         ==================================================================== */}
      {isTemplateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-4xl rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-lg font-bold text-white">
                  {editingTemplateId
                    ? 'Edit Messenger / IG Greeting & Icebreaker Template'
                    : 'Create Messenger / IG Greeting & Icebreaker Template'}
                </h2>
                <p className="text-xs text-slate-400">
                  Saved to <code className="text-slate-300">mkt_chat_templates</code> and compiled into Meta&apos;s <code className="text-slate-300">page_welcome_message</code> JSON.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsTemplateModalOpen(false)}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Form Editor */}
              <div className="lg:col-span-7 space-y-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Template Name
                  </label>
                  <input
                    type="text"
                    value={modalTemplateName}
                    onChange={(e) => setModalTemplateName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 px-3.5 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Welcome Greeting Bubble Text (Use {'{{user_first_name}}'})
                  </label>
                  <textarea
                    rows={3}
                    value={modalGreetingText}
                    onChange={(e) => setModalGreetingText(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Icebreaker Tap Questions (Max 4)
                    </label>
                    {modalIcebreakers.length < 4 && (
                      <button
                        type="button"
                        onClick={() =>
                          setModalIcebreakers((prev) => [
                            ...prev,
                            {
                              question: '✨ Do you have an ongoing promo?',
                              payload: `ICEBREAKER_CUSTOM_${prev.length + 1}`,
                            },
                          ])
                        }
                        className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-400 hover:text-indigo-300 cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add Icebreaker
                      </button>
                    )}
                  </div>

                  {modalIcebreakers.map((ib, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={ib.question}
                        onChange={(e) => {
                          const val = e.target.value;
                          setModalIcebreakers((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, question: val } : item
                            )
                          );
                        }}
                        placeholder="Question shown in Messenger..."
                        className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs sm:text-sm text-white"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setModalIcebreakers((prev) =>
                            prev.filter((_, i) => i !== idx)
                          )
                        }
                        className="rounded-lg p-2 text-slate-500 hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Column: Interactive Mobile Messenger Chat Preview */}
              <div className="lg:col-span-5">
                <div className="mx-auto max-w-[320px] rounded-[28px] border-4 border-slate-800 bg-slate-950 p-4 shadow-2xl flex flex-col justify-between min-h-[400px]">
                  {/* Phone Top Header */}
                  <div>
                    <div className="flex items-center gap-2.5 border-b border-slate-800 pb-3">
                      <div className="h-8 w-8 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold text-white">
                        M
                      </div>
                      <div>
                        <p className="text-xs font-bold text-white">
                          Official Brand Page
                        </p>
                        <p className="text-[10px] text-emerald-400">
                          Typically replies instantly
                        </p>
                      </div>
                    </div>

                    {/* Greeting Bubble */}
                    <div className="mt-4 space-y-3">
                      <div className="rounded-2xl rounded-tl-sm bg-slate-800 p-3 text-xs text-slate-100 leading-relaxed">
                        {modalGreetingText.replace(
                          /\{\{user_first_name\}\}/g,
                          'Juan'
                        )}
                      </div>

                      {/* Simulated Customer Tap Reply */}
                      {previewTappedIcebreaker && (
                        <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-indigo-600 p-3 text-xs text-white">
                          {previewTappedIcebreaker}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Interactive Icebreaker Buttons */}
                  <div className="mt-6 space-y-2">
                    <p className="text-[10px] text-center text-slate-500">
                      Tap an icebreaker below to test customer view:
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {modalIcebreakers
                        .filter((ib) => ib.question.trim())
                        .map((ib, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setPreviewTappedIcebreaker(ib.question)}
                            className="w-full rounded-2xl border border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20 px-3 py-2 text-left text-xs font-medium text-sky-300 flex items-center justify-between transition cursor-pointer"
                          >
                            <span className="truncate">{ib.question}</span>
                            <Send className="h-3 w-3 shrink-0 ml-2" />
                          </button>
                        ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={() => setIsTemplateModalOpen(false)}
                className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingTemplateModal}
                onClick={handleSaveChatTemplateModal}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2 text-xs font-semibold text-white cursor-pointer"
              >
                {savingTemplateModal ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Chat Template
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

