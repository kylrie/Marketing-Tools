import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { getActivePageContext } from './meta-pages';
import type {
  MktAdCatalogRow,
  MktAttributionLedgerRow,
  MktCrmStage,
  MktMessagingPlatform,
} from './types';

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface InboxChatMessageItem {
  id: string;
  message: string;
  senderId: string;
  senderName: string;
  isFromPage: boolean;
  createdTime: string;
  attachmentUrl?: string | null;
  attachmentType?: 'IMAGE' | 'VIDEO' | null;
}

export interface InboxConversationThread {
  threadId: string;
  customerPsid: string;
  customerName: string;
  customerAvatarUrl: string;
  platform: MktMessagingPlatform;
  updatedTime: string;
  unreadCount: number;
  snippet: string;
  crmStage: MktCrmStage;
  dealValuePhp: number;
  sourceAdId: string | null;
  sourceAdName: string | null;
  sourceAdThumbnail: string | null;
  sourceCampaignName: string | null;
  messages: InboxChatMessageItem[];
}

export interface SocialPostCommentReplyItem {
  id: string;
  message: string;
  senderId: string;
  senderName: string;
  isFromPage: boolean;
  createdTime: string;
}

export interface SocialPostCommentItem {
  id: string;
  message: string;
  senderId: string;
  senderName: string;
  createdTime: string;
  isHidden: boolean;
  shieldAction: string | null;
  shieldClassification: string | null;
  privateDmSent: boolean;
  replies: SocialPostCommentReplyItem[];
}

export interface SocialPostItem {
  id: string;
  postId: string;
  platform: 'FACEBOOK' | 'INSTAGRAM';
  mediaType: 'TEXT' | 'IMAGE' | 'VIDEO';
  message: string;
  mediaUrl: string | null;
  permalinkUrl: string | null;
  createdTime: string;
  scheduledFor?: string | null;
  status: string;
  commentsCount: number;
  comments: SocialPostCommentItem[];
}

function getPageAccessToken(): string {
  const token =
    process.env.META_PAGE_ACCESS_TOKEN ||
    process.env.META_SYSTEM_USER_TOKEN ||
    process.env.META_ACCESS_TOKEN ||
    process.env.META_SYSTEM_USER_ACCESS_TOKEN;

  if (!token) {
    throw new Error(
      '[MetaInboxPosts] Missing META_PAGE_ACCESS_TOKEN or META_SYSTEM_USER_TOKEN.'
    );
  }
  return token;
}

function getPageId(): string {
  const pageId = process.env.META_PAGE_ID;
  if (!pageId) {
    throw new Error('[MetaInboxPosts] Missing META_PAGE_ID environment variable.');
  }
  return pageId;
}

const avatarUrlCache = new Map<string, string>();

function buildFallbackAvatarUrl(name: string): string {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(
    name || 'User'
  )}&background=312e81&color=e0e7ff&bold=true&size=128`;
}

async function resolveCustomerAvatarUrl(
  psid: string,
  customerName: string,
  pageToken: string
): Promise<string> {
  if (avatarUrlCache.has(psid)) {
    return avatarUrlCache.get(psid)!;
  }

  try {
    const picUrl = `${GRAPH_BASE_URL}/${encodeURIComponent(
      psid
    )}/picture?redirect=false&type=normal&access_token=${encodeURIComponent(
      pageToken
    )}`;
    const res = await fetch(picUrl, { cache: 'no-store' });
    if (res.ok) {
      const data = (await res.json()) as {
        data?: { url?: string; is_silhouette?: boolean };
      };
      if (data.data?.url) {
        avatarUrlCache.set(psid, data.data.url);
        return data.data.url;
      }
    }
  } catch {
    // Fallback if Meta restricts picture lookup for older PSIDs
  }

  const fallback = buildFallbackAvatarUrl(customerName);
  avatarUrlCache.set(psid, fallback);
  return fallback;
}

/**
 * 1. `fetchUnifiedInboxConversations()`
 * Queries Meta Graph API `GET /v21.0/${META_PAGE_ID}/conversations` for Messenger & Instagram,
 * merges with local webhook-captured messages (`mkt_inbox_messages`) and CRM attribution
 * records (`mkt_attribution_ledger` + `mkt_ads_catalog`).
 */
export async function fetchUnifiedInboxConversations(
  overridePageId?: string | null
): Promise<{
  pageId: string;
  pageName: string;
  threads: InboxConversationThread[];
  catalogAds: MktAdCatalogRow[];
}> {
  const pageCtx = await getActivePageContext(overridePageId);
  const pageId = pageCtx.pageId;
  const pageToken = pageCtx.pageAccessToken;
  const supabase = getSupabaseAdmin();

  const [
    { data: catalogRows },
    { data: ledgerRows },
    { data: localMessageRows },
  ] = await Promise.all([
    supabase.from('mkt_ads_catalog').select('*').order('updated_at', { ascending: false }),
    supabase.from('mkt_attribution_ledger').select('*'),
    supabase
      .from('mkt_inbox_messages')
      .select('*')
      .order('sent_at', { ascending: true }),
  ]);

  const catalogAds = (catalogRows || []) as MktAdCatalogRow[];
  const adById = new Map<string, MktAdCatalogRow>();
  for (const ad of catalogAds) {
    adById.set(ad.ad_id, ad);
  }

  const ledgerByPsid = new Map<string, MktAttributionLedgerRow>();
  for (const row of (ledgerRows || []) as MktAttributionLedgerRow[]) {
    ledgerByPsid.set(row.customer_psid, row);
  }

  const threadsByPsid = new Map<string, InboxConversationThread>();

  // Fetch live Messenger conversations from Graph API
  try {
    const convUrl = new URL(`${GRAPH_BASE_URL}/${encodeURIComponent(pageId)}/conversations`);
    convUrl.searchParams.set(
      'fields',
      'id,updated_time,unread_count,participants,messages.limit(25){id,message,from,created_time,attachments}'
    );
    convUrl.searchParams.set('limit', '25');
    convUrl.searchParams.set('access_token', pageToken);

    const response = await fetch(convUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    if (response.ok) {
      const payload = (await response.json()) as {
        data?: Array<{
          id: string;
          updated_time?: string;
          unread_count?: number;
          participants?: {
            data?: Array<{ id: string; name?: string; email?: string }>;
          };
          messages?: {
            data?: Array<{
              id: string;
              message?: string;
              from?: { id: string; name?: string };
              created_time?: string;
              attachments?: {
                data?: Array<{
                  image_data?: { url?: string };
                  video_data?: { url?: string };
                }>;
              };
            }>;
          };
        }>;
      };

      for (const conv of payload.data || []) {
        const participants = conv.participants?.data || [];
        const customerParticipant =
          participants.find((p) => p.id !== pageId) || participants[0];

        if (!customerParticipant?.id) continue;

        const psid = customerParticipant.id;
        const customerName =
          customerParticipant.name || `Meta User (${psid.slice(-6)})`;

        // Ensure a ledger entry exists for every real Messenger conversation participant
        let ledger = ledgerByPsid.get(psid);
        if (!ledger) {
          const { data: createdLedger } = await supabase
            .from('mkt_attribution_ledger')
            .upsert(
              {
                customer_psid: psid,
                customer_name: customerName,
                platform: 'MESSENGER',
                crm_stage: 'NEW_INQUIRY',
                deal_value: 0,
                first_inquiry_at: conv.updated_time || new Date().toISOString(),
              },
              { onConflict: 'customer_psid' }
            )
            .select('*')
            .maybeSingle<MktAttributionLedgerRow>();

          if (createdLedger) {
            ledger = createdLedger;
            ledgerByPsid.set(psid, createdLedger);
          }
        }

        const rawMessages = [...(conv.messages?.data || [])].reverse();
        const mappedMessages: InboxChatMessageItem[] = rawMessages
          .filter((m) => m.message || m.attachments?.data?.length)
          .map((m) => {
            const fromId = m.from?.id || '';
            const isFromPage = fromId === pageId;
            const firstAtt = m.attachments?.data?.[0];
            const imageUrl = firstAtt?.image_data?.url || null;
            const videoUrl = firstAtt?.video_data?.url || null;
            const attachmentUrl = imageUrl || videoUrl || null;
            const attachmentType: 'IMAGE' | 'VIDEO' | null = videoUrl
              ? 'VIDEO'
              : imageUrl
              ? 'IMAGE'
              : null;

            return {
              id: m.id,
              message:
                m.message ||
                (attachmentType === 'VIDEO'
                  ? '🎬 Sent a video'
                  : attachmentType === 'IMAGE'
                  ? '📷 Sent a photo'
                  : ''),
              senderId: fromId,
              senderName: m.from?.name || (isFromPage ? 'Page' : customerName),
              isFromPage,
              createdTime: m.created_time || conv.updated_time || new Date().toISOString(),
              attachmentUrl,
              attachmentType,
            };
          });

        const latestMsg =
          mappedMessages[mappedMessages.length - 1]?.message || 'No messages yet';
        const sourceAdId = ledger?.source_ad_id || null;
        const matchedAd = sourceAdId ? adById.get(sourceAdId) : null;
        const displayCustomerName = ledger?.customer_name || customerName;

        threadsByPsid.set(psid, {
          threadId: conv.id,
          customerPsid: psid,
          customerName: displayCustomerName,
          customerAvatarUrl: buildFallbackAvatarUrl(displayCustomerName),
          platform: ledger?.platform || 'MESSENGER',
          updatedTime: conv.updated_time || new Date().toISOString(),
          unreadCount: Number(conv.unread_count ?? 0),
          snippet: latestMsg,
          crmStage: ledger?.crm_stage || 'NEW_INQUIRY',
          dealValuePhp: Number(ledger?.deal_value ?? 0),
          sourceAdId,
          sourceAdName: matchedAd?.ad_name || (sourceAdId ? `Ad ${sourceAdId}` : null),
          sourceAdThumbnail: matchedAd?.thumbnail_url || null,
          sourceCampaignName: matchedAd?.campaign_name || null,
          messages: mappedMessages,
        });
      }
    }
  } catch (err) {
    console.error('[MetaInboxPosts] Error fetching live Graph conversations:', err);
  }

  // Merge any webhook-captured or locally sent messages from `mkt_inbox_messages`
  for (const row of localMessageRows || []) {
    const rowPageId = row.page_id ? String(row.page_id) : '842220459241420';
    if (rowPageId !== pageId) continue;

    const psid = String(row.customer_psid);
    const existingThread = threadsByPsid.get(psid);
    const ledger = ledgerByPsid.get(psid);
    const sourceAdId = ledger?.source_ad_id || null;
    const matchedAd = sourceAdId ? adById.get(sourceAdId) : null;
    const rowRecord = row as Record<string, unknown>;
    const rowAttUrl = rowRecord.attachment_url
      ? String(rowRecord.attachment_url)
      : null;
    const rowAttType =
      rowRecord.attachment_type === 'VIDEO'
        ? 'VIDEO'
        : rowRecord.attachment_type === 'IMAGE'
        ? 'IMAGE'
        : null;

    const msgItem: InboxChatMessageItem = {
      id: String(row.message_mid || row.id),
      message: String(row.message_text || ''),
      senderId: row.direction === 'OUTBOUND' ? pageId : psid,
      senderName:
        row.direction === 'OUTBOUND'
          ? 'Page Agent'
          : String(row.customer_name || ledger?.customer_name || `User ${psid.slice(-6)}`),
      isFromPage: row.direction === 'OUTBOUND',
      createdTime: String(row.sent_at || row.created_at || new Date().toISOString()),
      attachmentUrl: rowAttUrl,
      attachmentType: rowAttType,
    };

    if (existingThread) {
      const alreadyExists = existingThread.messages.some(
        (m) =>
          m.id === msgItem.id ||
          (m.message === msgItem.message &&
            !msgItem.attachmentUrl &&
            Math.abs(
              new Date(m.createdTime).getTime() - new Date(msgItem.createdTime).getTime()
            ) < 5000)
      );
      if (!alreadyExists) {
        existingThread.messages.push(msgItem);
        existingThread.snippet = msgItem.message;
        existingThread.updatedTime = msgItem.createdTime;
      }
    } else {
      const displayName = String(
        row.customer_name || ledger?.customer_name || `Meta Lead (${psid.slice(-6)})`
      );
      threadsByPsid.set(psid, {
        threadId: String(row.thread_id || `t_${psid}`),
        customerPsid: psid,
        customerName: displayName,
        customerAvatarUrl: buildFallbackAvatarUrl(displayName),
        platform: (row.platform as MktMessagingPlatform) || ledger?.platform || 'MESSENGER',
        updatedTime: msgItem.createdTime,
        unreadCount: row.direction === 'INBOUND' ? 1 : 0,
        snippet: msgItem.message,
        crmStage: ledger?.crm_stage || 'NEW_INQUIRY',
        dealValuePhp: Number(ledger?.deal_value ?? 0),
        sourceAdId,
        sourceAdName: matchedAd?.ad_name || null,
        sourceAdThumbnail: matchedAd?.thumbnail_url || null,
        sourceCampaignName: matchedAd?.campaign_name || null,
        messages: [msgItem],
      });
    }
  }

  const sortedThreads = Array.from(threadsByPsid.values()).sort(
    (a, b) => new Date(b.updatedTime).getTime() - new Date(a.updatedTime).getTime()
  );

  // Resolve real Facebook/IG profile picture URLs in parallel (cached in memory)
  await Promise.all(
    sortedThreads.map(async (thread) => {
      thread.customerAvatarUrl = await resolveCustomerAvatarUrl(
        thread.customerPsid,
        thread.customerName,
        pageToken
      );
    })
  );

  return {
    pageId,
    pageName: pageCtx.pageName,
    threads: sortedThreads,
    catalogAds,
  };
}

/**
 * 2. `sendPageChatMessage(...)`
 * Sends a direct message reply (text, photo, or video) from the Facebook Page / Instagram account
 * to `customerPsid` via `POST https://graph.facebook.com/v21.0/${pageId}/messages`
 * and logs it in `mkt_inbox_messages`.
 */
export async function sendPageChatMessage({
  customerPsid,
  customerName,
  platform = 'MESSENGER',
  messageText,
  threadId,
  mediaType,
  mediaUrlOrBase64,
  mediaFileName,
  mediaMimeType,
  pageId: overridePageId,
}: {
  customerPsid: string;
  customerName?: string;
  platform?: MktMessagingPlatform;
  messageText?: string;
  threadId?: string;
  mediaType?: 'IMAGE' | 'VIDEO' | null;
  mediaUrlOrBase64?: string | null;
  mediaFileName?: string;
  mediaMimeType?: string;
  pageId?: string | null;
}): Promise<{
  messageId: string;
  sentAt: string;
  deliveryMode: 'LIVE_GRAPH_API' | 'SANDBOX_STORED';
  metaNotice?: string;
}> {
  const pageCtx = await getActivePageContext(overridePageId);
  const pageId = pageCtx.pageId;
  const pageToken = pageCtx.pageAccessToken;
  const supabase = getSupabaseAdmin();

  const endpoint = `${GRAPH_BASE_URL}/${encodeURIComponent(pageId)}/messages`;
  let messageId = `mid_local_${Date.now()}`;
  let deliveryMode: 'LIVE_GRAPH_API' | 'SANDBOX_STORED' = 'LIVE_GRAPH_API';
  let metaNotice: string | undefined;

  const cleanText = (messageText || '').trim();
  const hasMedia = Boolean(mediaType && mediaUrlOrBase64);

  try {
    // Step A: If a Photo or Video is attached, send it via Meta Send API
    if (hasMedia && mediaUrlOrBase64 && mediaType) {
      const fbAttachmentType = mediaType === 'VIDEO' ? 'video' : 'image';

      if (mediaUrlOrBase64.startsWith('data:')) {
        // Local binary file upload via FormData `filedata`
        const commaIndex = mediaUrlOrBase64.indexOf(',');
        const headerPart = mediaUrlOrBase64.slice(0, commaIndex);
        const base64Data = mediaUrlOrBase64.slice(commaIndex + 1);
        const mimeMatch = headerPart.match(/data:([^;]+);/);
        const resolvedMime =
          mediaMimeType ||
          mimeMatch?.[1] ||
          (mediaType === 'VIDEO' ? 'video/mp4' : 'image/jpeg');
        const resolvedFileName =
          mediaFileName ||
          (mediaType === 'VIDEO' ? `upload_${Date.now()}.mp4` : `upload_${Date.now()}.jpg`);

        const binaryBuffer = Buffer.from(base64Data, 'base64');
        const blob = new Blob([binaryBuffer], { type: resolvedMime });

        const formData = new FormData();
        formData.append('recipient', JSON.stringify({ id: customerPsid }));
        formData.append('messaging_type', 'RESPONSE');
        formData.append(
          'message',
          JSON.stringify({
            attachment: {
              type: fbAttachmentType,
              payload: { is_reusable: true },
            },
          })
        );
        formData.append('filedata', blob, resolvedFileName);
        formData.append('access_token', pageToken);

        const mediaRes = await fetch(endpoint, {
          method: 'POST',
          body: formData,
          cache: 'no-store',
        });

        const mediaData = (await mediaRes.json()) as {
          message_id?: string;
          error?: { message: string };
        };

        if (mediaRes.ok && mediaData.message_id) {
          messageId = mediaData.message_id;
        } else {
          deliveryMode = 'SANDBOX_STORED';
          metaNotice =
            mediaData.error?.message ||
            'Media saved locally in thread (outside Meta 24-hour window or App in Development Mode).';
        }
      } else {
        // Remote URL upload
        const mediaRes = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: customerPsid },
            messaging_type: 'RESPONSE',
            message: {
              attachment: {
                type: fbAttachmentType,
                payload: {
                  url: mediaUrlOrBase64,
                  is_reusable: true,
                },
              },
            },
            access_token: pageToken,
          }),
          cache: 'no-store',
        });

        const mediaData = (await mediaRes.json()) as {
          message_id?: string;
          error?: { message: string };
        };

        if (mediaRes.ok && mediaData.message_id) {
          messageId = mediaData.message_id;
        } else {
          deliveryMode = 'SANDBOX_STORED';
          metaNotice =
            mediaData.error?.message ||
            'Media saved locally in thread (outside Meta 24-hour window or App in Development Mode).';
        }
      }
    }

    // Step B: Send text message if provided
    if (cleanText) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: customerPsid },
          messaging_type: 'RESPONSE',
          message: { text: cleanText },
          access_token: pageToken,
        }),
        cache: 'no-store',
      });

      const data = (await response.json()) as {
        message_id?: string;
        recipient_id?: string;
        error?: { message: string; code?: number; error_subcode?: number };
      };

      if (response.ok && data.message_id) {
        messageId = data.message_id;
      } else if (!hasMedia) {
        deliveryMode = 'SANDBOX_STORED';
        metaNotice =
          data.error?.message ||
          'Message saved locally (outside Meta 24-hour window or App in Development Mode).';
      }
    }
  } catch (err) {
    deliveryMode = 'SANDBOX_STORED';
    metaNotice =
      err instanceof Error ? err.message : 'Message saved locally in thread.';
  }

  const sentAt = new Date().toISOString();
  const displayText =
    cleanText ||
    (mediaType === 'VIDEO'
      ? '🎬 Sent a video'
      : mediaType === 'IMAGE'
      ? '📷 Sent a photo'
      : '');

  await supabase.from('mkt_inbox_messages').insert({
    page_id: pageId,
    thread_id: threadId || `t_${customerPsid}`,
    customer_psid: customerPsid,
    customer_name: customerName || null,
    platform,
    direction: 'OUTBOUND',
    message_text: displayText,
    message_mid: messageId,
    sent_at: sentAt,
    attachment_url: hasMedia ? mediaUrlOrBase64 : null,
    attachment_type: hasMedia ? mediaType : null,
  });

  return {
    messageId,
    sentAt,
    deliveryMode,
    metaNotice,
  };
}

/**
 * 3. `fetchPublishedPagePosts()`
 * Fetches organic posts from `GET /v21.0/${META_PAGE_ID}/feed`
 * and merges with locally recorded `mkt_social_posts`.
 */
export async function fetchPublishedPagePosts(
  overridePageId?: string | null
): Promise<SocialPostItem[]> {
  const pageCtx = await getActivePageContext(overridePageId);
  const pageId = pageCtx.pageId;
  const pageToken = pageCtx.pageAccessToken;
  const supabase = getSupabaseAdmin();

  const { data: localPosts } = await supabase
    .from('mkt_social_posts')
    .select('*')
    .order('created_at', { ascending: false });

  const { data: shieldLogs } = await supabase
    .from('mkt_automation_logs')
    .select('*')
    .eq('module', 'COMMENT_SHIELD')
    .order('created_at', { ascending: false })
    .limit(200);

  const shieldByCommentId = new Map<
    string,
    {
      actionTaken: string;
      classification: string | null;
      privateDmSent: boolean;
    }
  >();

  for (const log of shieldLogs || []) {
    const cid = String(log.target_id || '');
    if (cid && !shieldByCommentId.has(cid)) {
      const meta = (log.metadata || {}) as Record<string, unknown>;
      shieldByCommentId.set(cid, {
        actionTaken: String(log.action_taken || ''),
        classification: meta.classification ? String(meta.classification) : null,
        privateDmSent: Boolean(meta.private_dm_sent),
      });
    }
  }

  const postsById = new Map<string, SocialPostItem>();

  for (const row of localPosts || []) {
    const postId = String(row.post_id);
    const rowPageId = row.page_id
      ? String(row.page_id)
      : postId.includes('_')
        ? postId.split('_')[0]
        : '842220459241420';
    if (rowPageId !== pageId) continue;

    postsById.set(postId, {
      id: String(row.id),
      postId,
      platform: (row.platform as 'FACEBOOK' | 'INSTAGRAM') || 'FACEBOOK',
      mediaType: (row.media_type as 'TEXT' | 'IMAGE' | 'VIDEO') || 'TEXT',
      message: String(row.message || ''),
      mediaUrl: row.media_url ? String(row.media_url) : null,
      permalinkUrl: row.permalink_url ? String(row.permalink_url) : null,
      createdTime: String(row.created_at || new Date().toISOString()),
      status: String(row.status || 'PUBLISHED'),
      commentsCount: 0,
      comments: [],
    });
  }

  try {
    const feedUrl = new URL(`${GRAPH_BASE_URL}/${encodeURIComponent(pageId)}/feed`);
    feedUrl.searchParams.set(
      'fields',
      'id,message,created_time,full_picture,permalink_url,comments.limit(25){id,message,from,created_time,is_hidden,comments.limit(10){id,message,from,created_time}}'
    );
    feedUrl.searchParams.set('limit', '20');
    feedUrl.searchParams.set('access_token', pageToken);

    const response = await fetch(feedUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    if (response.ok) {
      const data = (await response.json()) as {
        data?: Array<{
          id: string;
          message?: string;
          created_time?: string;
          full_picture?: string;
          permalink_url?: string;
          comments?: {
            data?: Array<{
              id: string;
              message?: string;
              from?: { id?: string; name?: string };
              created_time?: string;
              is_hidden?: boolean;
              comments?: {
                data?: Array<{
                  id: string;
                  message?: string;
                  from?: { id?: string; name?: string };
                  created_time?: string;
                }>;
              };
            }>;
          };
        }>;
      };

      for (const item of data.data || []) {
        const mappedComments: SocialPostCommentItem[] = (
          item.comments?.data || []
        ).map((c) => {
          const shield = shieldByCommentId.get(c.id);
          const replies: SocialPostCommentReplyItem[] = (
            c.comments?.data || []
          ).map((r) => ({
            id: r.id,
            message: r.message || '',
            senderId: r.from?.id || '',
            senderName: r.from?.name || 'Facebook User',
            isFromPage: r.from?.id === pageId,
            createdTime: r.created_time || new Date().toISOString(),
          }));

          return {
            id: c.id,
            message: c.message || '',
            senderId: c.from?.id || '',
            senderName: c.from?.name || 'Facebook User',
            createdTime: c.created_time || new Date().toISOString(),
            isHidden: Boolean(c.is_hidden),
            shieldAction: shield?.actionTaken || null,
            shieldClassification: shield?.classification || null,
            privateDmSent: Boolean(shield?.privateDmSent),
            replies,
          };
        });

        const existing = postsById.get(item.id);
        if (existing) {
          existing.commentsCount = mappedComments.length;
          existing.comments = mappedComments;
          if (item.permalink_url) {
            existing.permalinkUrl = item.permalink_url;
          }
          if (!existing.mediaUrl && item.full_picture) {
            existing.mediaUrl = item.full_picture;
          }
        } else {
          postsById.set(item.id, {
            id: item.id,
            postId: item.id,
            platform: 'FACEBOOK',
            mediaType: item.full_picture ? 'IMAGE' : 'TEXT',
            message: item.message || '(Media Post)',
            mediaUrl: item.full_picture || null,
            permalinkUrl:
              item.permalink_url || `https://www.facebook.com/${item.id}`,
            createdTime: item.created_time || new Date().toISOString(),
            status: 'PUBLISHED_ON_META',
            commentsCount: mappedComments.length,
            comments: mappedComments,
          });
        }
      }
    }
  } catch (err) {
    console.error('[MetaInboxPosts] Error fetching Page feed posts:', err);
  }

  return Array.from(postsById.values()).sort(
    (a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime()
  );
}

/**
 * 4. `publishPagePost(...)`
 * Publishes an organic Facebook Page post (`POST /v21.0/${META_PAGE_ID}/feed` or `/photos`)
 * and stores it in `mkt_social_posts`.
 */
export async function publishPagePost({
  platform = 'FACEBOOK',
  mediaType = 'TEXT',
  message,
  mediaUrl,
  scheduledFor,
  pageId: overridePageId,
}: {
  platform?: 'FACEBOOK' | 'INSTAGRAM';
  mediaType?: 'TEXT' | 'IMAGE' | 'VIDEO';
  message: string;
  mediaUrl?: string | null;
  scheduledFor?: string | null;
  pageId?: string | null;
}): Promise<{
  post: SocialPostItem;
  publishedLiveToMeta: boolean;
  metaNotice?: string;
}> {
  const pageCtx = await getActivePageContext(overridePageId);
  const pageId = pageCtx.pageId;
  const pageToken = pageCtx.pageAccessToken;
  const supabase = getSupabaseAdmin();

  let postId = `${pageId}_${Date.now()}`;
  let permalinkUrl: string | null = `https://www.facebook.com/${pageId}`;
  let publishedLiveToMeta = false;
  const isScheduled =
    Boolean(scheduledFor) &&
    new Date(scheduledFor!).getTime() > Date.now() + 60 * 1000;
  const scheduledUnix = isScheduled
    ? Math.floor(new Date(scheduledFor!).getTime() / 1000)
    : null;
  let status = isScheduled ? 'SCHEDULED' : 'PUBLISHED_ON_META';
  let metaNotice: string | undefined;

  try {
    if (mediaType === 'IMAGE' && mediaUrl) {
      const photoEndpoint = `${GRAPH_BASE_URL}/${encodeURIComponent(pageId)}/photos`;
      let res: Response;

      if (mediaUrl.startsWith('data:')) {
        const commaIdx = mediaUrl.indexOf(',');
        const headerPart = mediaUrl.slice(0, commaIdx);
        const base64Data = mediaUrl.slice(commaIdx + 1);
        const mimeMatch = headerPart.match(/data:([^;]+);/);
        const mimeType = mimeMatch?.[1] || 'image/jpeg';
        const buffer = Buffer.from(base64Data, 'base64');
        const blob = new Blob([buffer], { type: mimeType });

        const formData = new FormData();
        formData.append('source', blob, `post_${Date.now()}.jpg`);
        formData.append('caption', message);
        if (scheduledUnix && scheduledUnix > Math.floor(Date.now() / 1000) + 600) {
          formData.append('published', 'false');
          formData.append('scheduled_publish_time', String(scheduledUnix));
        }
        formData.append('access_token', pageToken);

        res = await fetch(photoEndpoint, {
          method: 'POST',
          body: formData,
          cache: 'no-store',
        });
      } else {
        const payloadObj: Record<string, unknown> = {
          url: mediaUrl,
          caption: message,
          access_token: pageToken,
        };
        if (scheduledUnix && scheduledUnix > Math.floor(Date.now() / 1000) + 600) {
          payloadObj.published = false;
          payloadObj.scheduled_publish_time = scheduledUnix;
        }
        res = await fetch(photoEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloadObj),
          cache: 'no-store',
        });
      }

      const data = (await res.json()) as {
        id?: string;
        post_id?: string;
        error?: { message: string };
      };

      if (res.ok && (data.post_id || data.id)) {
        postId = String(data.post_id || data.id);
        permalinkUrl = `https://www.facebook.com/${postId}`;
        publishedLiveToMeta = true;
      } else {
        status = isScheduled ? 'SCHEDULED' : 'SANDBOX_PUBLISHED';
        metaNotice =
          data.error?.message ||
          'Saved to Social Post Studio queue.';
      }
    } else if (mediaType === 'VIDEO' && mediaUrl) {
      const videoEndpoint = `${GRAPH_BASE_URL}/${encodeURIComponent(pageId)}/videos`;
      let res: Response;

      if (mediaUrl.startsWith('data:')) {
        const commaIdx = mediaUrl.indexOf(',');
        const headerPart = mediaUrl.slice(0, commaIdx);
        const base64Data = mediaUrl.slice(commaIdx + 1);
        const mimeMatch = headerPart.match(/data:([^;]+);/);
        const mimeType = mimeMatch?.[1] || 'video/mp4';
        const buffer = Buffer.from(base64Data, 'base64');
        const blob = new Blob([buffer], { type: mimeType });

        const formData = new FormData();
        formData.append('source', blob, `video_${Date.now()}.mp4`);
        formData.append('description', message);
        if (scheduledUnix && scheduledUnix > Math.floor(Date.now() / 1000) + 600) {
          formData.append('published', 'false');
          formData.append('scheduled_publish_time', String(scheduledUnix));
        }
        formData.append('access_token', pageToken);

        res = await fetch(videoEndpoint, {
          method: 'POST',
          body: formData,
          cache: 'no-store',
        });
      } else {
        const payloadObj: Record<string, unknown> = {
          file_url: mediaUrl,
          description: message,
          access_token: pageToken,
        };
        if (scheduledUnix && scheduledUnix > Math.floor(Date.now() / 1000) + 600) {
          payloadObj.published = false;
          payloadObj.scheduled_publish_time = scheduledUnix;
        }
        res = await fetch(videoEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloadObj),
          cache: 'no-store',
        });
      }

      const data = (await res.json()) as {
        id?: string;
        error?: { message: string };
      };

      if (res.ok && data.id) {
        postId = `${pageId}_${data.id}`;
        permalinkUrl = `https://www.facebook.com/${postId}`;
        publishedLiveToMeta = true;
      } else {
        status = isScheduled ? 'SCHEDULED' : 'SANDBOX_PUBLISHED';
        metaNotice = data.error?.message || 'Saved to Social Post Studio queue.';
      }
    } else {
      const feedEndpoint = `${GRAPH_BASE_URL}/${encodeURIComponent(pageId)}/feed`;
      const payloadObj: Record<string, unknown> = {
        message,
        access_token: pageToken,
      };
      if (scheduledUnix && scheduledUnix > Math.floor(Date.now() / 1000) + 600) {
        payloadObj.published = false;
        payloadObj.scheduled_publish_time = scheduledUnix;
      }

      const res = await fetch(feedEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadObj),
        cache: 'no-store',
      });
      const data = (await res.json()) as {
        id?: string;
        error?: { message: string };
      };

      if (res.ok && data.id) {
        postId = data.id;
        permalinkUrl = `https://www.facebook.com/${postId}`;
        publishedLiveToMeta = true;
      } else {
        status = isScheduled ? 'SCHEDULED' : 'SANDBOX_PUBLISHED';
        metaNotice =
          data.error?.message ||
          'Saved to Social Post Studio queue.';
      }
    }
  } catch (err) {
    status = isScheduled ? 'SCHEDULED' : 'SANDBOX_PUBLISHED';
    metaNotice =
      err instanceof Error ? err.message : 'Saved to local social posts studio.';
  }

  const createdTime = new Date().toISOString();
  const { data: savedRow } = await supabase
    .from('mkt_social_posts')
    .insert({
      page_id: pageId,
      post_id: postId,
      platform,
      media_type: mediaType,
      message,
      media_url: mediaUrl || null,
      permalink_url: permalinkUrl,
      scheduled_for: scheduledFor || null,
      status,
      created_at: createdTime,
    })
    .select('*')
    .single();

  return {
    post: {
      id: String(savedRow?.id || postId),
      postId,
      platform,
      mediaType,
      message,
      mediaUrl: mediaUrl || null,
      permalinkUrl,
      createdTime,
      scheduledFor: scheduledFor || null,
      status,
      commentsCount: 0,
      comments: [],
    },
    publishedLiveToMeta,
    metaNotice,
  };
}

/**
 * 5. `replyOrModeratePostComment(...)`
 * Allows direct interaction with comments inside `/marketing/posts`:
 * - `REPLY_PUBLIC`: Posts a public reply under the comment (`POST /v21.0/{commentId}/comments`)
 * - `SEND_PRIVATE_DM`: Sends a Private Reply DM to the commenter's Messenger inbox (`POST /v21.0/{pageId}/messages`)
 * - `TOGGLE_HIDE`: Hides or unhides the comment on Facebook (`POST /v21.0/{commentId}`)
 */
export async function replyOrModeratePostComment({
  commentId,
  action,
  replyText,
  isHidden,
  pageId: overridePageId,
}: {
  commentId: string;
  action: 'REPLY_PUBLIC' | 'SEND_PRIVATE_DM' | 'TOGGLE_HIDE';
  replyText?: string;
  isHidden?: boolean;
  pageId?: string | null;
}): Promise<{
  success: boolean;
  message?: string;
}> {
  const pageCtx = await getActivePageContext(overridePageId);
  const pageId = pageCtx.pageId;
  const pageToken = pageCtx.pageAccessToken;

  if (action === 'REPLY_PUBLIC') {
    const cleanReply = replyText?.trim();
    if (!cleanReply) {
      throw new Error('Reply text is required.');
    }
    const endpoint = `${GRAPH_BASE_URL}/${encodeURIComponent(commentId)}/comments`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: cleanReply,
        access_token: pageToken,
      }),
      cache: 'no-store',
    });
    const data = (await res.json()) as { id?: string; error?: { message: string } };
    if (!res.ok || data.error) {
      throw new Error(data.error?.message || 'Failed posting public comment reply.');
    }
    return { success: true, message: 'Public comment reply posted to Facebook.' };
  }

  if (action === 'SEND_PRIVATE_DM') {
    const cleanDm = replyText?.trim();
    if (!cleanDm) {
      throw new Error('Private DM text is required.');
    }
    const endpoint = `${GRAPH_BASE_URL}/${encodeURIComponent(pageId)}/messages`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text: cleanDm },
        access_token: pageToken,
      }),
      cache: 'no-store',
    });
    const data = (await res.json()) as {
      message_id?: string;
      error?: { message: string };
    };
    if (!res.ok || data.error) {
      throw new Error(
        data.error?.message ||
          'Failed sending Private DM (Note: Meta only allows 1 Private Reply per comment within 7 days).'
      );
    }
    return {
      success: true,
      message: 'Private DM sent directly to the commenter on Messenger.',
    };
  }

  if (action === 'TOGGLE_HIDE') {
    const endpoint = `${GRAPH_BASE_URL}/${encodeURIComponent(commentId)}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        is_hidden: Boolean(isHidden),
        access_token: pageToken,
      }),
      cache: 'no-store',
    });
    const data = (await res.json()) as {
      success?: boolean;
      error?: { message: string };
    };
    if (!res.ok || data.error) {
      throw new Error(data.error?.message || 'Failed updating comment visibility.');
    }
    return {
      success: true,
      message: isHidden
        ? 'Comment hidden from public view on Facebook.'
        : 'Comment unhidden and visible publicly on Facebook.',
    };
  }

  throw new Error(`Unsupported comment action: ${action}`);
}


