import { getSupabaseAdmin } from '@/lib/supabase/admin';
import type {
  MktAdCatalogRow,
  MktAdToggleStatus,
  MktChatIcebreaker,
  MktChatTemplateRow,
  MktLaunchBatchRow,
} from './types';

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface MetaCampaignOption {
  id: string;
  name: string;
  status: string;
  objective: string;
}

export interface MetaAdSetOption {
  id: string;
  name: string;
  status: string;
  campaign_id: string;
  campaign_name?: string;
  optimization_goal: string;
  destination_type?: string;
  daily_budget?: string;
  is_messaging_optimized: boolean;
}

export interface UploadedAdMediaResult {
  type: 'IMAGE' | 'VIDEO';
  mediaHashOrId: string;
  imageHash?: string;
  videoId?: string;
  thumbnailUrl?: string | null;
}

export interface CreateClickToMessageCreativeParams {
  name: string;
  pageId?: string;
  instagramActorId?: string | null;
  mediaHashOrId: string;
  mediaType?: 'IMAGE' | 'VIDEO';
  thumbnailUrl?: string | null;
  primaryText: string;
  headline: string;
  chatTemplate?: {
    greeting_text: string;
    icebreakers: MktChatIcebreaker[];
  } | null;
}

export interface BulkCreativeInputItem {
  id?: string;
  fileUrlOrBase64?: string;
  mediaHashOrId?: string;
  type: 'IMAGE' | 'VIDEO';
  formatLabel?: string; // e.g. 'VIDEO' | 'IMAGE' | 'REEL' | 'CAROUSEL'
  creatorName?: string; // e.g. 'CreatorMia'
  thumbnailUrl?: string | null;
}

export interface BulkCopyVariationInput {
  primaryText: string;
  headline: string;
  angleLabel?: string;
}

export interface PublishBulkAdsBatchConfig {
  campaignId: string;
  campaignName?: string;
  adsetId: string;
  adsetName?: string;
  promoName: string;
  defaultCreatorName?: string;
  yearMonthOverride?: string; // Optional 'YYYY-MM' override
  launchStatus: MktAdToggleStatus;
  chatTemplateId?: string;
  chatTemplateOverride?: {
    greeting_text: string;
    icebreakers: MktChatIcebreaker[];
  };
  creatives: BulkCreativeInputItem[];
  copyVariations: BulkCopyVariationInput[];
}

export interface PublishedAdResultItem {
  adId: string;
  creativeId: string;
  adName: string;
  status: MktAdToggleStatus;
  mediaType: 'IMAGE' | 'VIDEO';
  thumbnailUrl: string | null;
  primaryText: string;
  headline: string;
}

function getMarketingAccessToken(): string {
  const token =
    process.env.META_ACCESS_TOKEN ||
    process.env.META_SYSTEM_USER_ACCESS_TOKEN;

  if (!token) {
    throw new Error(
      '[MetaLauncher] Missing META_ACCESS_TOKEN or META_SYSTEM_USER_ACCESS_TOKEN.'
    );
  }
  return token;
}

function getNormalizedAdAccountId(): string {
  const raw = process.env.META_AD_ACCOUNT_ID;
  if (!raw) {
    throw new Error('[MetaLauncher] Missing META_AD_ACCOUNT_ID environment variable.');
  }
  return raw.startsWith('act_') ? raw : `act_${raw}`;
}

/**
 * Sanitizes a taxonomy token (e.g. PromoName, Format, Creator) by removing spaces
 * and special characters while preserving alphanumeric, hyphens, and dots.
 */
export function sanitizeTaxonomySegment(raw: string, fallback: string): string {
  const cleaned = (raw || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^a-zA-Z0-9.\-]/g, '');
  return cleaned || fallback;
}

/**
 * Formats the standardized ad naming convention:
 * `YYYY-MM_[PromoName]_[Format]_[Creator]_V#`
 */
export function formatStandardizedAdName(params: {
  yearMonth?: string;
  promoName: string;
  format: string;
  creator: string;
  versionNumber: number;
}): string {
  const now = new Date();
  const ym =
    params.yearMonth?.trim() ||
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const promo = sanitizeTaxonomySegment(params.promoName, 'Promo');
  const format = sanitizeTaxonomySegment(params.format.toUpperCase(), 'CREATIVE');
  const creator = sanitizeTaxonomySegment(params.creator, 'InHouse');
  return `${ym}_${promo}_${format}_${creator}_V${params.versionNumber}`;
}

/**
 * Builds Meta's `page_welcome_message` JSON structure for Click-to-Messenger & IG DM ads,
 * embedding the greeting text and icebreaker quick-reply buttons.
 */
export function buildPageWelcomeMessageJson(chatTemplate: {
  greeting_text: string;
  icebreakers: MktChatIcebreaker[];
}): string {
  const validIcebreakers = (chatTemplate.icebreakers || [])
    .filter((ib) => ib.question?.trim())
    .slice(0, 4)
    .map((ib) => ({
      type: 'postback',
      title: ib.question.trim().slice(0, 80),
      payload:
        ib.payload?.trim() ||
        `ICEBREAKER_${ib.question
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, '_')
          .slice(0, 32)}`,
    }));

  const payload = {
    type: 'VISUAL_EDITOR',
    version: 2,
    landing_screen_type: 'welcome_message',
    media_type: 'text',
    text_format: {
      customer_action_type:
        validIcebreakers.length > 0 ? 'ice_breakers' : 'quick_replies',
      message: {
        text:
          chatTemplate.greeting_text?.trim() ||
          'Hi {{user_first_name}}! How can we help you today?',
        ice_breakers: validIcebreakers.map((ib) => ({
          title: ib.title,
          payload: ib.payload,
        })),
      },
    },
  };

  return JSON.stringify(payload);
}

/**
 * 1. `fetchActiveCampaignsAndAdSets()`
 * Fetches Campaigns and Ad Sets from Meta Marketing API, flagging ad sets
 * with `optimization_goal` or `destination_type` configured for conversations/leads.
 */
export async function fetchActiveCampaignsAndAdSets(): Promise<{
  campaigns: MetaCampaignOption[];
  adSets: MetaAdSetOption[];
}> {
  const accessToken = getMarketingAccessToken();
  const adAccountId = getNormalizedAdAccountId();

  const campaignsUrl = new URL(`${GRAPH_BASE_URL}/${adAccountId}/campaigns`);
  campaignsUrl.searchParams.set('fields', 'id,name,status,objective');
  campaignsUrl.searchParams.set('limit', '200');
  campaignsUrl.searchParams.set('access_token', accessToken);

  const adSetsUrl = new URL(`${GRAPH_BASE_URL}/${adAccountId}/adsets`);
  adSetsUrl.searchParams.set(
    'fields',
    'id,name,status,campaign_id,optimization_goal,destination_type,daily_budget'
  );
  adSetsUrl.searchParams.set('limit', '300');
  adSetsUrl.searchParams.set('access_token', accessToken);

  const [campRes, adSetRes] = await Promise.all([
    fetch(campaignsUrl.toString(), { cache: 'no-store' }),
    fetch(adSetsUrl.toString(), { cache: 'no-store' }),
  ]);

  const campPayload = (await campRes.json()) as {
    data?: MetaCampaignOption[];
    error?: { message: string };
  };
  const adSetPayload = (await adSetRes.json()) as {
    data?: Array<{
      id: string;
      name: string;
      status: string;
      campaign_id: string;
      optimization_goal?: string;
      destination_type?: string;
      daily_budget?: string;
    }>;
    error?: { message: string };
  };

  if (!campRes.ok || campPayload.error) {
    throw new Error(
      `[MetaLauncher] Failed fetching campaigns: ${
        campPayload.error?.message || campRes.statusText
      }`
    );
  }

  if (!adSetRes.ok || adSetPayload.error) {
    throw new Error(
      `[MetaLauncher] Failed fetching ad sets: ${
        adSetPayload.error?.message || adSetRes.statusText
      }`
    );
  }

  const campaigns = (campPayload.data || []).filter(
    (c) => c.status === 'ACTIVE' || c.status === 'PAUSED'
  );
  const campaignNameMap = new Map<string, string>();
  for (const c of campaigns) {
    campaignNameMap.set(c.id, c.name);
  }

  const messagingGoals = new Set([
    'CONVERSATIONS',
    'REPLIES',
    'LEAD_GENERATION',
    'QUALITY_LEAD',
    'LINK_CLICKS',
  ]);
  const messagingDestinations = new Set([
    'MESSENGER',
    'INSTAGRAM_DIRECT',
    'APPLINKS_AUTOMATIC',
  ]);

  const allAdSets: MetaAdSetOption[] = (adSetPayload.data || [])
    .filter((a) => a.status === 'ACTIVE' || a.status === 'PAUSED')
    .map((a) => {
      const goal = (a.optimization_goal || '').toUpperCase();
      const dest = (a.destination_type || '').toUpperCase();
      const isMessaging =
        messagingGoals.has(goal) || messagingDestinations.has(dest);

      return {
        id: a.id,
        name: a.name,
        status: a.status,
        campaign_id: a.campaign_id,
        campaign_name: campaignNameMap.get(a.campaign_id) || undefined,
        optimization_goal: goal || 'CONVERSATIONS',
        destination_type: dest || undefined,
        daily_budget: a.daily_budget,
        is_messaging_optimized: isMessaging,
      };
    });

  // Sort messaging/conversation-optimized ad sets first
  allAdSets.sort((a, b) => {
    if (a.is_messaging_optimized !== b.is_messaging_optimized) {
      return a.is_messaging_optimized ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    campaigns,
    adSets: allAdSets,
  };
}

/**
 * 2. `uploadAdMedia(fileUrlOrBuffer, type: 'IMAGE' | 'VIDEO')`
 * Uploads creatives to `/adimages` (returning `image_hash`) or `/advideos` (returning `video_id`).
 */
export async function uploadAdMedia(
  fileUrlOrBuffer: string | Buffer | Uint8Array,
  type: 'IMAGE' | 'VIDEO'
): Promise<UploadedAdMediaResult> {
  const accessToken = getMarketingAccessToken();
  const adAccountId = getNormalizedAdAccountId();

  if (type === 'IMAGE') {
    let base64Bytes: string;

    if (typeof fileUrlOrBuffer === 'string') {
      if (fileUrlOrBuffer.startsWith('data:')) {
        const commaIdx = fileUrlOrBuffer.indexOf(',');
        base64Bytes =
          commaIdx >= 0 ? fileUrlOrBuffer.slice(commaIdx + 1) : fileUrlOrBuffer;
      } else if (
        fileUrlOrBuffer.startsWith('http://') ||
        fileUrlOrBuffer.startsWith('https://')
      ) {
        const imgRes = await fetch(fileUrlOrBuffer, { cache: 'no-store' });
        if (!imgRes.ok) {
          throw new Error(
            `[MetaLauncher] Failed fetching image from URL: ${fileUrlOrBuffer}`
          );
        }
        const arrayBuf = await imgRes.arrayBuffer();
        base64Bytes = Buffer.from(arrayBuf).toString('base64');
      } else {
        base64Bytes = fileUrlOrBuffer;
      }
    } else {
      base64Bytes = Buffer.from(fileUrlOrBuffer).toString('base64');
    }

    const endpoint = `${GRAPH_BASE_URL}/${adAccountId}/adimages`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bytes: base64Bytes,
        access_token: accessToken,
      }),
      cache: 'no-store',
    });

    const data = (await response.json()) as {
      images?: Record<string, { hash: string; url?: string }>;
      error?: { message: string };
    };

    if (!response.ok || data.error || !data.images) {
      throw new Error(
        `[MetaLauncher] Failed uploading ad image: ${
          data.error?.message || response.statusText
        }`
      );
    }

    const firstKey = Object.keys(data.images)[0];
    const imageInfo = firstKey ? data.images[firstKey] : undefined;

    if (!imageInfo?.hash) {
      throw new Error('[MetaLauncher] Meta /adimages did not return an image_hash.');
    }

    return {
      type: 'IMAGE',
      mediaHashOrId: imageInfo.hash,
      imageHash: imageInfo.hash,
      thumbnailUrl: imageInfo.url || null,
    };
  }

  // VIDEO upload to `/advideos`
  const endpoint = `${GRAPH_BASE_URL}/${adAccountId}/advideos`;

  if (
    typeof fileUrlOrBuffer === 'string' &&
    (fileUrlOrBuffer.startsWith('http://') || fileUrlOrBuffer.startsWith('https://'))
  ) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_url: fileUrlOrBuffer,
        access_token: accessToken,
      }),
      cache: 'no-store',
    });

    const data = (await response.json()) as {
      id?: string;
      error?: { message: string };
    };

    if (!response.ok || data.error || !data.id) {
      throw new Error(
        `[MetaLauncher] Failed uploading ad video from URL: ${
          data.error?.message || response.statusText
        }`
      );
    }

    return {
      type: 'VIDEO',
      mediaHashOrId: data.id,
      videoId: data.id,
      thumbnailUrl: null,
    };
  }

  // Upload binary / base64 video buffer via multipart FormData
  let videoBuffer: Buffer;
  if (typeof fileUrlOrBuffer === 'string') {
    const base64Clean = fileUrlOrBuffer.includes(',')
      ? fileUrlOrBuffer.slice(fileUrlOrBuffer.indexOf(',') + 1)
      : fileUrlOrBuffer;
    videoBuffer = Buffer.from(base64Clean, 'base64');
  } else {
    videoBuffer = Buffer.from(fileUrlOrBuffer);
  }

  const formData = new FormData();
  formData.append('access_token', accessToken);
  const blob = new Blob([new Uint8Array(videoBuffer)], { type: 'video/mp4' });
  formData.append('source', blob, `ad_video_${Date.now()}.mp4`);

  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData,
    cache: 'no-store',
  });

  const data = (await response.json()) as {
    id?: string;
    error?: { message: string };
  };

  if (!response.ok || data.error || !data.id) {
    throw new Error(
      `[MetaLauncher] Failed uploading video binary to /advideos: ${
        data.error?.message || response.statusText
      }`
    );
  }

  return {
    type: 'VIDEO',
    mediaHashOrId: data.id,
    videoId: data.id,
    thumbnailUrl: null,
  };
}

/**
 * 3. `createClickToMessageCreative(...)`
 * Creates an Ad Creative in `POST /v21.0/${META_AD_ACCOUNT_ID}/adcreatives`
 * with `object_story_spec` configured for Click-to-Messenger/IG (`MESSAGE_PAGE`)
 * and attaches the `page_welcome_message` JSON built from `mkt_chat_templates`.
 */
export async function createClickToMessageCreative({
  name,
  pageId,
  instagramActorId,
  mediaHashOrId,
  mediaType = 'IMAGE',
  thumbnailUrl,
  primaryText,
  headline,
  chatTemplate,
}: CreateClickToMessageCreativeParams): Promise<{ creativeId: string }> {
  const accessToken = getMarketingAccessToken();
  const adAccountId = getNormalizedAdAccountId();
  const resolvedPageId = pageId || process.env.META_PAGE_ID;
  const resolvedIgActorId =
    instagramActorId !== undefined
      ? instagramActorId
      : process.env.META_IG_BUSINESS_ACCOUNT_ID || null;

  if (!resolvedPageId) {
    throw new Error('[MetaLauncher] Missing META_PAGE_ID for Click-to-Message creative.');
  }

  const pageWelcomeMessage = chatTemplate
    ? buildPageWelcomeMessageJson(chatTemplate)
    : undefined;

  const objectStorySpec: Record<string, unknown> = {
    page_id: resolvedPageId,
  };

  if (resolvedIgActorId) {
    objectStorySpec.instagram_actor_id = resolvedIgActorId;
  }

  if (mediaType === 'VIDEO') {
    const videoData: Record<string, unknown> = {
      video_id: mediaHashOrId,
      message: primaryText,
      title: headline,
      call_to_action: {
        type: 'MESSAGE_PAGE',
      },
    };
    if (thumbnailUrl) {
      videoData.image_url = thumbnailUrl;
    }
    if (pageWelcomeMessage) {
      videoData.page_welcome_message = pageWelcomeMessage;
    }
    objectStorySpec.video_data = videoData;
  } else {
    const linkData: Record<string, unknown> = {
      image_hash: mediaHashOrId,
      link: `https://m.me/${resolvedPageId}`,
      message: primaryText,
      name: headline,
      call_to_action: {
        type: 'MESSAGE_PAGE',
      },
    };
    if (pageWelcomeMessage) {
      linkData.page_welcome_message = pageWelcomeMessage;
    }
    objectStorySpec.link_data = linkData;
  }

  const endpoint = `${GRAPH_BASE_URL}/${adAccountId}/adcreatives`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `${name}_Creative`,
      object_story_spec: objectStorySpec,
      access_token: accessToken,
    }),
    cache: 'no-store',
  });

  const data = (await response.json()) as {
    id?: string;
    error?: { message: string; error_user_msg?: string };
  };

  if (!response.ok || data.error || !data.id) {
    const errMsg =
      data.error?.error_user_msg || data.error?.message || response.statusText;
    throw new Error(`[MetaLauncher] Failed creating ad creative "${name}": ${errMsg}`);
  }

  return { creativeId: data.id };
}

/**
 * 4. `publishBulkAdsBatch(batchConfig)`
 * Iterates through uploaded creatives × copy variations, enforces the standardized
 * naming taxonomy (`YYYY-MM_[PromoName]_[Format]_[Creator]_V#`), creates each
 * Ad Creative and Ad (`POST /v21.0/${META_AD_ACCOUNT_ID}/ads`), syncs new `ad_id`s
 * into `mkt_ads_catalog`, and records the batch in `mkt_launch_batches`.
 */
export async function publishBulkAdsBatch(
  batchConfig: PublishBulkAdsBatchConfig
): Promise<{
  batch: MktLaunchBatchRow;
  publishedAds: PublishedAdResultItem[];
}> {
  const accessToken = getMarketingAccessToken();
  const adAccountId = getNormalizedAdAccountId();
  const supabase = getSupabaseAdmin();

  if (!batchConfig.campaignId || !batchConfig.adsetId) {
    throw new Error('[MetaLauncher] campaignId and adsetId are required.');
  }

  if (!Array.isArray(batchConfig.creatives) || batchConfig.creatives.length === 0) {
    throw new Error('[MetaLauncher] At least one creative is required.');
  }

  if (
    !Array.isArray(batchConfig.copyVariations) ||
    batchConfig.copyVariations.length === 0
  ) {
    throw new Error('[MetaLauncher] At least one ad copy variation is required.');
  }

  // Load chatTemplate from `mkt_chat_templates` if `chatTemplateId` is provided
  let resolvedChatTemplate = batchConfig.chatTemplateOverride || null;
  if (!resolvedChatTemplate && batchConfig.chatTemplateId) {
    const { data: tplRow } = await supabase
      .from('mkt_chat_templates')
      .select('*')
      .eq('id', batchConfig.chatTemplateId)
      .maybeSingle<MktChatTemplateRow>();

    if (tplRow) {
      resolvedChatTemplate = {
        greeting_text: tplRow.greeting_text,
        icebreakers: tplRow.icebreakers || [],
      };
    }
  }

  const now = new Date();
  const yearMonth =
    batchConfig.yearMonthOverride?.trim() ||
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const cleanPromo = sanitizeTaxonomySegment(batchConfig.promoName, 'Promo');

  const publishedAds: PublishedAdResultItem[] = [];
  let versionCounter = 0;

  for (const creativeInput of batchConfig.creatives) {
    // Upload media first if `mediaHashOrId` is not already populated
    let mediaHashOrId = creativeInput.mediaHashOrId?.trim() || '';
    let resolvedThumbnailUrl = creativeInput.thumbnailUrl || null;

    if (!mediaHashOrId && creativeInput.fileUrlOrBase64) {
      const uploaded = await uploadAdMedia(
        creativeInput.fileUrlOrBase64,
        creativeInput.type
      );
      mediaHashOrId = uploaded.mediaHashOrId;
      if (uploaded.thumbnailUrl) {
        resolvedThumbnailUrl = uploaded.thumbnailUrl;
      }
    }

    if (!mediaHashOrId) {
      throw new Error(
        '[MetaLauncher] Creative item is missing both mediaHashOrId and fileUrlOrBase64.'
      );
    }

    const formatSegment =
      creativeInput.formatLabel || creativeInput.type || 'CREATIVE';
    const creatorSegment =
      creativeInput.creatorName || batchConfig.defaultCreatorName || 'InHouse';

    for (const copyVar of batchConfig.copyVariations) {
      versionCounter += 1;

      const standardizedAdName = formatStandardizedAdName({
        yearMonth,
        promoName: cleanPromo,
        format: formatSegment,
        creator: creatorSegment,
        versionNumber: versionCounter,
      });

      // Step A: Create the Ad Creative with Click-to-Message CTA & Welcome Icebreakers
      const { creativeId } = await createClickToMessageCreative({
        name: standardizedAdName,
        mediaHashOrId,
        mediaType: creativeInput.type,
        thumbnailUrl: resolvedThumbnailUrl,
        primaryText: copyVar.primaryText,
        headline: copyVar.headline,
        chatTemplate: resolvedChatTemplate,
      });

      // Step B: Create the Ad inside the target Ad Set
      const adEndpoint = `${GRAPH_BASE_URL}/${adAccountId}/ads`;
      const adRes = await fetch(adEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: standardizedAdName,
          adset_id: batchConfig.adsetId,
          creative: { creative_id: creativeId },
          status: batchConfig.launchStatus,
          access_token: accessToken,
        }),
        cache: 'no-store',
      });

      const adData = (await adRes.json()) as {
        id?: string;
        error?: { message: string; error_user_msg?: string };
      };

      if (!adRes.ok || adData.error || !adData.id) {
        const errMsg =
          adData.error?.error_user_msg ||
          adData.error?.message ||
          adRes.statusText;
        throw new Error(
          `[MetaLauncher] Failed creating ad "${standardizedAdName}": ${errMsg}`
        );
      }

      publishedAds.push({
        adId: adData.id,
        creativeId,
        adName: standardizedAdName,
        status: batchConfig.launchStatus,
        mediaType: creativeInput.type,
        thumbnailUrl: resolvedThumbnailUrl,
        primaryText: copyVar.primaryText,
        headline: copyVar.headline,
      });
    }
  }

  // Step C: Immediately upsert all newly created ads into `mkt_ads_catalog`
  const nowIso = new Date().toISOString();
  const catalogRows: MktAdCatalogRow[] = publishedAds.map((item) => ({
    ad_id: item.adId,
    ad_name: item.adName,
    adset_id: batchConfig.adsetId,
    adset_name: batchConfig.adsetName || null,
    campaign_id: batchConfig.campaignId,
    campaign_name: batchConfig.campaignName || null,
    status: item.status,
    thumbnail_url: item.thumbnailUrl,
    creative_body: item.primaryText,
    updated_at: nowIso,
  }));

  if (catalogRows.length > 0) {
    const { error: catalogError } = await supabase
      .from('mkt_ads_catalog')
      .upsert(catalogRows, { onConflict: 'ad_id' });

    if (catalogError) {
      console.error(
        '[MetaLauncher] Ads created in Meta, but failed upserting mkt_ads_catalog:',
        catalogError.message
      );
    }
  }

  // Step D: Record launch history in `mkt_launch_batches`
  const taxonomyPrefix = `${yearMonth}_${cleanPromo}`;
  const { data: batchRecord, error: batchError } = await supabase
    .from('mkt_launch_batches')
    .insert({
      campaign_id: batchConfig.campaignId,
      campaign_name: batchConfig.campaignName || null,
      adset_id: batchConfig.adsetId,
      adset_name: batchConfig.adsetName || null,
      taxonomy_prefix: taxonomyPrefix,
      total_ads_created: publishedAds.length,
      launch_status: batchConfig.launchStatus,
      created_ad_ids: publishedAds.map((a) => a.adId),
    })
    .select('*')
    .single<MktLaunchBatchRow>();

  if (batchError || !batchRecord) {
    throw new Error(
      `[MetaLauncher] Ads published, but failed saving mkt_launch_batches: ${batchError?.message}`
    );
  }

  return {
    batch: batchRecord,
    publishedAds,
  };
}

