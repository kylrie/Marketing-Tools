import crypto from 'crypto';
import type { MktMessagingPlatform } from './types';

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface MetaMessagingReferral {
  ad_id?: string;
  source?: string;
  type?: string;
  ref?: string;
  ads_context_data?: {
    ad_title?: string;
    photo_url?: string;
    video_url?: string;
    post_id?: string;
  };
}

export interface MetaMessagingEvent {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: number;
  referral?: MetaMessagingReferral;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    referral?: MetaMessagingReferral;
  };
}

export interface MetaWebhookEntry {
  id: string;
  time?: number;
  messaging?: MetaMessagingEvent[];
}

export interface MetaWebhookPayload {
  object?: 'page' | 'instagram' | string;
  entry?: MetaWebhookEntry[];
}

export interface ExtractedAdReferralEvent {
  customerPsid: string;
  sourceAdId: string;
  platform: MktMessagingPlatform;
  adTitle: string | null;
  messageText: string | null;
  eventTimestampIso: string;
}

/**
 * Validates the GET challenge handshake from Meta App Dashboard -> Webhooks.
 */
export function verifyMetaWebhookChallenge(searchParams: URLSearchParams): {
  valid: boolean;
  challenge: string | null;
} {
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');
  const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && expectedToken && token === expectedToken && challenge) {
    return { valid: true, challenge };
  }

  return { valid: false, challenge: null };
}

/**
 * Validates `X-Hub-Signature-256` HMAC-SHA256 header if `META_APP_SECRET` is configured.
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null
): boolean {
  const appSecret = process.env.META_APP_SECRET;
  // If META_APP_SECRET is not set in local/dev testing, skip signature check
  if (!appSecret) {
    return true;
  }
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }

  const expectedSignature =
    'sha256=' +
    crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHeader, 'utf8'),
      Buffer.from(expectedSignature, 'utf8')
    );
  } catch {
    return false;
  }
}

/**
 * Parses a Meta `page` or `instagram` webhook payload and extracts all
 * messaging events that contain an ad referral (`referral.ad_id` or `message.referral.ad_id`).
 */
export function extractAttributableMessagingEvents(
  payload: MetaWebhookPayload
): ExtractedAdReferralEvent[] {
  if (!payload || !Array.isArray(payload.entry)) {
    return [];
  }

  const platform: MktMessagingPlatform =
    payload.object?.toLowerCase() === 'instagram' ? 'INSTAGRAM' : 'MESSENGER';

  const extracted: ExtractedAdReferralEvent[] = [];

  for (const entry of payload.entry) {
    if (!Array.isArray(entry.messaging)) continue;

    for (const messagingEvent of entry.messaging) {
      // Ignore outbound echo messages from the Page/IG business account itself
      if (messagingEvent.message?.is_echo) {
        continue;
      }

      const customerPsid = messagingEvent.sender?.id?.trim();
      if (!customerPsid) {
        continue;
      }

      // Check both `messagingEvent.referral?.ad_id` and `messagingEvent.message?.referral?.ad_id`
      const referralObj =
        messagingEvent.referral ?? messagingEvent.message?.referral;
      const sourceAdId =
        messagingEvent.referral?.ad_id?.trim() ||
        messagingEvent.message?.referral?.ad_id?.trim();

      if (!sourceAdId) {
        continue;
      }

      const timestampMs = messagingEvent.timestamp
        ? messagingEvent.timestamp > 1e11
          ? messagingEvent.timestamp
          : messagingEvent.timestamp * 1000
        : Date.now();

      extracted.push({
        customerPsid,
        sourceAdId,
        platform,
        adTitle: referralObj?.ads_context_data?.ad_title?.trim() || null,
        messageText: messagingEvent.message?.text?.trim() || null,
        eventTimestampIso: new Date(timestampMs).toISOString(),
      });
    }
  }

  return extracted;
}

/**
 * Queries Meta Graph API `GET https://graph.facebook.com/v21.0/${psid}?fields=name`
 * to resolve the customer's display name. Never throws so attribution logging is never blocked.
 */
export async function fetchMetaCustomerName(psid: string): Promise<string | null> {
  const token =
    process.env.META_PAGE_ACCESS_TOKEN ||
    process.env.META_ACCESS_TOKEN ||
    process.env.META_SYSTEM_USER_ACCESS_TOKEN;

  if (!token) {
    return null;
  }

  try {
    const url = new URL(`${GRAPH_BASE_URL}/${encodeURIComponent(psid)}`);
    url.searchParams.set('fields', 'name');
    url.searchParams.set('access_token', token);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      name?: string;
      first_name?: string;
      last_name?: string;
    };

    if (data.name?.trim()) {
      return data.name.trim();
    }

    const fullName = [data.first_name, data.last_name].filter(Boolean).join(' ').trim();
    return fullName || null;
  } catch {
    return null;
  }
}

