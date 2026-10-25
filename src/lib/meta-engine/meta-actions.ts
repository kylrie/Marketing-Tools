import { getSupabaseAdmin } from '@/lib/supabase/admin';
import type { MktAdToggleStatus } from './types';

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

interface MetaUpdateAdResponse {
  success?: boolean;
  error?: {
    message: string;
    type: string;
    code: number;
    fbtrace_id?: string;
  };
}

function getMarketingAccessToken(): string {
  const token =
    process.env.META_ACCESS_TOKEN ||
    process.env.META_SYSTEM_USER_ACCESS_TOKEN;

  if (!token) {
    throw new Error(
      '[MetaActions] Missing META_ACCESS_TOKEN or META_SYSTEM_USER_ACCESS_TOKEN environment variable.'
    );
  }
  return token;
}

/**
 * Updates an ad's delivery status (`ACTIVE` | `PAUSED`) directly in Meta Ads Manager
 * via `POST https://graph.facebook.com/v21.0/${adId}` and persists the new status
 * in `public.mkt_ads_catalog`.
 */
export async function setAdStatus(
  adId: string,
  status: MktAdToggleStatus
): Promise<{
  adId: string;
  status: MktAdToggleStatus;
  updatedAt: string;
}> {
  if (!adId || typeof adId !== 'string') {
    throw new Error('[MetaActions] A valid adId is required.');
  }

  if (status !== 'ACTIVE' && status !== 'PAUSED') {
    throw new Error(`[MetaActions] Invalid status "${status}". Expected 'ACTIVE' or 'PAUSED'.`);
  }

  const accessToken = getMarketingAccessToken();
  const supabase = getSupabaseAdmin();

  const endpoint = `${GRAPH_BASE_URL}/${encodeURIComponent(adId)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      status,
      access_token: accessToken,
    }),
    cache: 'no-store',
  });

  const payload = (await response.json()) as MetaUpdateAdResponse;

  if (!response.ok || payload.error) {
    const errMsg = payload.error?.message || `HTTP ${response.status}`;
    const errCode = payload.error?.code ?? response.status;
    throw new Error(
      `[MetaActions] Failed setting ad ${adId} to ${status} (${errCode}): ${errMsg}`
    );
  }

  const updatedAt = new Date().toISOString();

  const { error: dbError } = await supabase
    .from('mkt_ads_catalog')
    .update({
      status,
      updated_at: updatedAt,
    })
    .eq('ad_id', adId);

  if (dbError) {
    throw new Error(
      `[MetaActions] Ad ${adId} toggled in Meta, but failed updating mkt_ads_catalog: ${dbError.message}`
    );
  }

  return {
    adId,
    status,
    updatedAt,
  };
}

export async function pauseAd(adId: string) {
  return setAdStatus(adId, 'PAUSED');
}

export async function activateAd(adId: string) {
  return setAdStatus(adId, 'ACTIVE');
}

