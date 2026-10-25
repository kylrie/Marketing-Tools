import type { MktMessagingPlatform } from './types';

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface SendMetaCapiEventParams {
  psid: string;
  platform: MktMessagingPlatform;
  eventName: 'Lead' | 'Purchase' | string;
  value?: number;
  currency?: string;
  eventId?: string;
  adId?: string | null;
}

export interface MetaCapiResponse {
  events_received?: number;
  messages?: string[];
  fbtrace_id?: string;
  error?: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

function getCapiAccessToken(): string {
  const token =
    process.env.META_ACCESS_TOKEN ||
    process.env.META_SYSTEM_USER_ACCESS_TOKEN ||
    process.env.META_PAGE_ACCESS_TOKEN;

  if (!token) {
    throw new Error(
      '[MetaCAPI] Missing META_ACCESS_TOKEN, META_SYSTEM_USER_ACCESS_TOKEN, or META_PAGE_ACCESS_TOKEN.'
    );
  }
  return token;
}

/**
 * Dispatches a Business Messaging Conversions API (`Lead` or `Purchase`) event
 * to `POST https://graph.facebook.com/v21.0/${META_DATASET_ID}/events`.
 */
export async function sendMetaCapiEvent({
  psid,
  platform,
  eventName,
  value,
  currency = 'PHP',
  eventId,
  adId,
}: SendMetaCapiEventParams): Promise<MetaCapiResponse> {
  const datasetId = process.env.META_DATASET_ID;
  const pageId = process.env.META_PAGE_ID;
  const accessToken = getCapiAccessToken();

  if (!datasetId) {
    throw new Error('[MetaCAPI] Missing META_DATASET_ID environment variable.');
  }

  if (!pageId) {
    throw new Error('[MetaCAPI] Missing META_PAGE_ID environment variable.');
  }

  const eventTime = Math.floor(Date.now() / 1000);
  const messagingChannel = platform === 'INSTAGRAM' ? 'instagram' : 'messenger';

  const customData: Record<string, unknown> = {
    currency,
  };

  if (typeof value === 'number' && !Number.isNaN(value)) {
    customData.value = Number(value.toFixed(2));
  } else if (eventName === 'Purchase') {
    customData.value = 0;
  }

  if (adId) {
    customData.source_ad_id = adId;
  }

  const eventPayload: Record<string, unknown> = {
    event_name: eventName,
    event_time: eventTime,
    event_id: eventId || `${eventName.toLowerCase()}_${psid}_${eventTime}`,
    action_source: 'business_messaging',
    messaging_channel: messagingChannel,
    user_data: {
      page_id: pageId,
      page_scoped_user_id: psid,
    },
    custom_data: customData,
  };

  const requestBody: Record<string, unknown> = {
    data: [eventPayload],
    access_token: accessToken,
  };

  if (process.env.META_CAPI_TEST_EVENT_CODE?.trim()) {
    requestBody.test_event_code = process.env.META_CAPI_TEST_EVENT_CODE.trim();
  }

  const endpoint = `${GRAPH_BASE_URL}/${datasetId}/events`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(requestBody),
    cache: 'no-store',
  });

  const result = (await response.json()) as MetaCapiResponse;

  if (!response.ok || result.error) {
    const errMsg = result.error?.message || `HTTP ${response.status}`;
    const errCode = result.error?.code ?? response.status;
    throw new Error(`[MetaCAPI] Failed sending ${eventName} event (${errCode}): ${errMsg}`);
  }

  return result;
}

