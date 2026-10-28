import { getSupabaseAdmin } from '@/lib/supabase/admin';
import type { MktConnectedPageRow } from './types';

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface ActivePageContext {
  pageId: string;
  pageName: string;
  category: string;
  pageAccessToken: string;
  igBusinessAccountId: string | null;
  adAccountId: string | null;
  pictureUrl: string | null;
}

function getEnvDefaultToken(): string {
  return (
    process.env.META_PAGE_ACCESS_TOKEN ||
    process.env.META_SYSTEM_USER_TOKEN ||
    process.env.META_ACCESS_TOKEN ||
    process.env.META_SYSTEM_USER_ACCESS_TOKEN ||
    ''
  ).trim();
}

function getEnvDefaultPageId(): string {
  return (process.env.META_PAGE_ID || '842220459241420').trim();
}

/**
 * Fetches live Page metadata (`id`, `name`, `category`, `picture`, `instagram_business_account`) from Meta Graph API.
 */
async function fetchLivePageMetadata(
  pageId: string,
  accessToken: string
): Promise<{
  pageName: string;
  category: string;
  pictureUrl: string | null;
  igBusinessAccountId: string | null;
}> {
  try {
    const url = new URL(`${GRAPH_BASE_URL}/${encodeURIComponent(pageId)}`);
    url.searchParams.set(
      'fields',
      'id,name,category,picture.type(normal){url},instagram_business_account{id,username}'
    );
    url.searchParams.set('access_token', accessToken);

    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) {
      return {
        pageName: `Page ${pageId}`,
        category: 'Facebook Page',
        pictureUrl: null,
        igBusinessAccountId: process.env.META_IG_BUSINESS_ACCOUNT_ID?.trim() || null,
      };
    }

    const data = (await res.json()) as {
      name?: string;
      category?: string;
      picture?: { data?: { url?: string } };
      instagram_business_account?: { id?: string };
    };

    return {
      pageName: data.name?.trim() || `Page ${pageId}`,
      category: data.category?.trim() || 'Facebook Page',
      pictureUrl: data.picture?.data?.url || null,
      igBusinessAccountId:
        data.instagram_business_account?.id ||
        process.env.META_IG_BUSINESS_ACCOUNT_ID?.trim() ||
        null,
    };
  } catch {
    return {
      pageName: `Page ${pageId}`,
      category: 'Facebook Page',
      pictureUrl: null,
      igBusinessAccountId: process.env.META_IG_BUSINESS_ACCOUNT_ID?.trim() || null,
    };
  }
}

/**
 * Returns all connected Facebook Pages from `mkt_connected_pages`.
 * Automatically registers the `.env.local` Page (`META_PAGE_ID`) on first run so existing setups work out-of-the-box.
 */
export async function getConnectedPages(): Promise<MktConnectedPageRow[]> {
  const supabase = getSupabaseAdmin();
  const { data: existingRows } = await supabase
    .from('mkt_connected_pages')
    .select('*')
    .order('created_at', { ascending: true });

  const list = (existingRows || []) as MktConnectedPageRow[];
  if (list.length > 0) {
    // Ensure at least one page is marked active
    if (!list.some((p) => p.is_active)) {
      list[0].is_active = true;
      await supabase
        .from('mkt_connected_pages')
        .update({ is_active: true })
        .eq('page_id', list[0].page_id);
    }
    return list;
  }

  // Seed initial Page from `.env.local`
  const defaultPageId = getEnvDefaultPageId();
  const defaultToken = getEnvDefaultToken();
  if (!defaultPageId || !defaultToken) {
    return [];
  }

  const liveMeta = await fetchLivePageMetadata(defaultPageId, defaultToken);
  const nowIso = new Date().toISOString();

  const initialRow: Omit<MktConnectedPageRow, 'id'> = {
    page_id: defaultPageId,
    page_name: liveMeta.pageName,
    category: liveMeta.category,
    access_token: defaultToken,
    ig_business_account_id: liveMeta.igBusinessAccountId,
    ad_account_id: process.env.META_AD_ACCOUNT_ID?.trim() || null,
    picture_url: liveMeta.pictureUrl,
    is_active: true,
    webhook_subscribed: true,
    created_at: nowIso,
    updated_at: nowIso,
  };

  const { data: inserted } = await supabase
    .from('mkt_connected_pages')
    .upsert(initialRow, { onConflict: 'page_id' })
    .select('*')
    .single<MktConnectedPageRow>();

  return inserted ? [inserted] : [{ id: 'default-page', ...initialRow }];
}

/**
 * Resolves the active Page Context (or a specific `overridePageId` when routing webhooks / page-specific calls).
 */
export async function getActivePageContext(
  overridePageId?: string | null
): Promise<ActivePageContext> {
  const pages = await getConnectedPages();
  const cleanOverride = overridePageId?.trim();

  const matched =
    (cleanOverride ? pages.find((p) => p.page_id === cleanOverride) : null) ||
    pages.find((p) => p.is_active) ||
    pages[0];

  if (matched) {
    return {
      pageId: matched.page_id,
      pageName: matched.page_name,
      category: matched.category,
      pageAccessToken: matched.access_token || getEnvDefaultToken(),
      igBusinessAccountId: matched.ig_business_account_id,
      adAccountId:
        matched.ad_account_id || process.env.META_AD_ACCOUNT_ID?.trim() || null,
      pictureUrl: matched.picture_url,
    };
  }

  return {
    pageId: cleanOverride || getEnvDefaultPageId(),
    pageName: 'Kylrie',
    category: 'Facebook Page',
    pageAccessToken: getEnvDefaultToken(),
    igBusinessAccountId: process.env.META_IG_BUSINESS_ACCOUNT_ID?.trim() || null,
    adAccountId: process.env.META_AD_ACCOUNT_ID?.trim() || null,
    pictureUrl: null,
  };
}

/**
 * Switches the active Facebook Page across the entire workspace.
 */
export async function switchActivePage(
  pageId: string
): Promise<MktConnectedPageRow[]> {
  const supabase = getSupabaseAdmin();
  const pages = await getConnectedPages();
  const target = pages.find((p) => p.page_id === pageId.trim());
  if (!target) {
    throw new Error(`Page ID ${pageId} is not connected yet.`);
  }

  const nowIso = new Date().toISOString();
  for (const p of pages) {
    await supabase
      .from('mkt_connected_pages')
      .update({
        is_active: p.page_id === target.page_id,
        updated_at: nowIso,
      })
      .eq('page_id', p.page_id);
  }

  return getConnectedPages();
}

/**
 * Connects or updates a Facebook Page in `mkt_connected_pages`, pulls its live metadata & avatar from Meta Graph API,
 * subscribes it to webhooks (`messages,feed`), and sets it active if requested.
 */
export async function connectOrUpdateMetaPage(input: {
  pageId: string;
  accessToken: string;
  pageName?: string;
  adAccountId?: string | null;
  igBusinessAccountId?: string | null;
  setActive?: boolean;
}): Promise<MktConnectedPageRow> {
  const pageId = input.pageId.trim();
  const accessToken = input.accessToken.trim();
  if (!pageId || !accessToken) {
    throw new Error('Both Facebook Page ID and Page Access Token are required.');
  }

  const supabase = getSupabaseAdmin();
  const liveMeta = await fetchLivePageMetadata(pageId, accessToken);

  // Best-effort webhook subscription (`messages,feed`) on Meta Graph API
  let webhookSubscribed = true;
  try {
    const subUrl = `${GRAPH_BASE_URL}/${encodeURIComponent(pageId)}/subscribed_apps`;
    await fetch(subUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscribed_fields: ['messages', 'messaging_postbacks', 'feed'],
        access_token: accessToken,
      }),
      cache: 'no-store',
    });
  } catch {
    webhookSubscribed = false;
  }

  const nowIso = new Date().toISOString();
  const payload = {
    page_id: pageId,
    page_name: input.pageName?.trim() || liveMeta.pageName,
    category: liveMeta.category,
    access_token: accessToken,
    ig_business_account_id:
      input.igBusinessAccountId?.trim() || liveMeta.igBusinessAccountId || null,
    ad_account_id:
      input.adAccountId?.trim() ||
      process.env.META_AD_ACCOUNT_ID?.trim() ||
      null,
    picture_url: liveMeta.pictureUrl,
    is_active: Boolean(input.setActive ?? true),
    webhook_subscribed: webhookSubscribed,
    updated_at: nowIso,
  };

  if (payload.is_active) {
    const existing = await getConnectedPages();
    for (const p of existing) {
      if (p.page_id !== pageId && p.is_active) {
        await supabase
          .from('mkt_connected_pages')
          .update({ is_active: false, updated_at: nowIso })
          .eq('page_id', p.page_id);
      }
    }
  }

  const { data: saved, error } = await supabase
    .from('mkt_connected_pages')
    .upsert(payload, { onConflict: 'page_id' })
    .select('*')
    .single<MktConnectedPageRow>();

  if (error || !saved) {
    throw new Error(
      `[MetaPages] Failed saving Page ${pageId}: ${error?.message || 'Unknown error'}`
    );
  }

  return saved;
}

/**
 * Auto-discovers all Facebook Pages managed by a User / System User token via `GET /v21.0/me/accounts`
 * (or falls back to inspecting `/me` if the token is a direct Page token).
 */
export async function autoDiscoverPagesFromMeta(
  customToken?: string
): Promise<{
  discoveredCount: number;
  pages: MktConnectedPageRow[];
}> {
  const token = (customToken || getEnvDefaultToken()).trim();
  if (!token) {
    throw new Error('No Meta Access Token provided for Page discovery.');
  }

  let discoveredCount = 0;

  // 1. Try `/me/accounts` (works for User or System User tokens that manage multiple Pages)
  try {
    const accountsUrl = new URL(`${GRAPH_BASE_URL}/me/accounts`);
    accountsUrl.searchParams.set(
      'fields',
      'id,name,category,access_token,picture.type(normal){url},instagram_business_account{id,username}'
    );
    accountsUrl.searchParams.set('limit', '50');
    accountsUrl.searchParams.set('access_token', token);

    const res = await fetch(accountsUrl.toString(), { cache: 'no-store' });
    if (res.ok) {
      const data = (await res.json()) as {
        data?: Array<{
          id: string;
          name?: string;
          category?: string;
          access_token?: string;
          instagram_business_account?: { id?: string };
        }>;
      };

      const rawPages = data.data || [];
      for (let i = 0; i < rawPages.length; i++) {
        const item = rawPages[i];
        if (!item?.id) continue;
        await connectOrUpdateMetaPage({
          pageId: item.id,
          accessToken: item.access_token || token,
          pageName: item.name,
          igBusinessAccountId: item.instagram_business_account?.id || null,
          setActive: i === 0 && discoveredCount === 0,
        });
        discoveredCount += 1;
      }
    }
  } catch {
    // Fall through to `/me` check
  }

  // 2. If `/me/accounts` returned 0 pages (because the token is a Page-scoped token directly), check `/me`
  if (discoveredCount === 0) {
    const meUrl = new URL(`${GRAPH_BASE_URL}/me`);
    meUrl.searchParams.set('fields', 'id,name,category');
    meUrl.searchParams.set('access_token', token);
    const meRes = await fetch(meUrl.toString(), { cache: 'no-store' });
    if (meRes.ok) {
      const meData = (await meRes.json()) as {
        id?: string;
        name?: string;
      };
      if (meData.id) {
        await connectOrUpdateMetaPage({
          pageId: meData.id,
          accessToken: token,
          pageName: meData.name,
          setActive: true,
        });
        discoveredCount += 1;
      }
    }
  }

  const allPages = await getConnectedPages();
  return {
    discoveredCount,
    pages: allPages,
  };
}

/**
 * Removes a connected Facebook Page from `mkt_connected_pages`.
 */
export async function removeConnectedPage(
  pageId: string
): Promise<MktConnectedPageRow[]> {
  const supabase = getSupabaseAdmin();
  await supabase.from('mkt_connected_pages').delete().eq('page_id', pageId.trim());
  return getConnectedPages();
}

