import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MktAdAttributionViewRow } from '@/lib/meta-engine/types';

const DB_FILE_PATH = path.join(process.cwd(), '.local-mkt-db.json');

interface LocalDatabaseSchema {
  mkt_ads_catalog: Record<string, unknown>[];
  mkt_ad_daily_metrics: Record<string, unknown>[];
  mkt_attribution_ledger: Record<string, unknown>[];
  mkt_share_links: Record<string, unknown>[];
  mkt_watchdog_rules: Record<string, unknown>[];
  mkt_comment_rules: Record<string, unknown>[];
  mkt_automation_logs: Record<string, unknown>[];
  mkt_chat_templates: Record<string, unknown>[];
  mkt_launch_batches: Record<string, unknown>[];
  mkt_inbox_messages: Record<string, unknown>[];
  mkt_social_posts: Record<string, unknown>[];
  mkt_business_knowledge: Record<string, unknown>[];
  mkt_connected_pages: Record<string, unknown>[];
  [key: string]: Record<string, unknown>[];
}

function getEmptyDb(): LocalDatabaseSchema {
  return {
    mkt_ads_catalog: [],
    mkt_ad_daily_metrics: [],
    mkt_attribution_ledger: [],
    mkt_share_links: [],
    mkt_watchdog_rules: [],
    mkt_comment_rules: [],
    mkt_automation_logs: [],
    mkt_chat_templates: [],
    mkt_launch_batches: [],
    mkt_inbox_messages: [],
    mkt_social_posts: [],
    mkt_business_knowledge: [],
    mkt_connected_pages: [],
  };
}

function readDb(): LocalDatabaseSchema {
  try {
    if (!fs.existsSync(DB_FILE_PATH)) {
      return getEmptyDb();
    }
    const raw = fs.readFileSync(DB_FILE_PATH, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw) as LocalDatabaseSchema;
    return {
      ...getEmptyDb(),
      ...parsed,
    };
  } catch {
    return getEmptyDb();
  }
}

function writeDb(db: LocalDatabaseSchema): void {
  try {
    fs.writeFileSync(DB_FILE_PATH, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('[LocalSupabaseAdapter] Failed writing .local-mkt-db.json:', err);
  }
}

function computeAttributionRows(
  db: LocalDatabaseSchema,
  startDate?: string | null,
  endDate?: string | null
): MktAdAttributionViewRow[] {
  const catalogRows = db.mkt_ads_catalog || [];
  const metricRows = (db.mkt_ad_daily_metrics || []).filter((m) => {
    const dateStat = String(m.date_stat || '');
    if (startDate && dateStat < startDate) return false;
    if (endDate && dateStat > endDate) return false;
    return true;
  });

  const startIso = startDate ? `${startDate}T00:00:00.000+08:00` : null;
  const endIso = endDate ? `${endDate}T23:59:59.999+08:00` : null;

  const ledgerRows = (db.mkt_attribution_ledger || []).filter((l) => {
    if (!l.source_ad_id) return false;
    const inquiryIso = String(l.first_inquiry_at || '');
    if (startIso && inquiryIso < startIso) return false;
    if (endIso && inquiryIso > endIso) return false;
    return true;
  });

  const metricsByAd = new Map<
    string,
    {
      spend: number;
      impressions: number;
      linkClicks: number;
      video3sViews: number;
      thruplays: number;
      metaConversations: number;
    }
  >();

  for (const m of metricRows) {
    const adId = String(m.ad_id);
    const curr = metricsByAd.get(adId) || {
      spend: 0,
      impressions: 0,
      linkClicks: 0,
      video3sViews: 0,
      thruplays: 0,
      metaConversations: 0,
    };
    curr.spend += Number(m.spend ?? 0);
    curr.impressions += Number(m.impressions ?? 0);
    curr.linkClicks += Number(m.link_clicks ?? 0);
    curr.video3sViews += Number(m.video_3s_views ?? 0);
    curr.thruplays += Number(m.thruplays ?? 0);
    curr.metaConversations += Number(m.meta_conversations ?? 0);
    metricsByAd.set(adId, curr);
  }

  const crmByAd = new Map<
    string,
    {
      attributedDms: number;
      qualifiedCount: number;
      stageQualifiedOnlyCount: number;
      pendingCount: number;
      pendingPipelineValue: number;
      wonCount: number;
      lostCount: number;
      closedRevenue: number;
    }
  >();

  for (const l of ledgerRows) {
    const adId = String(l.source_ad_id);
    const curr = crmByAd.get(adId) || {
      attributedDms: 0,
      qualifiedCount: 0,
      stageQualifiedOnlyCount: 0,
      pendingCount: 0,
      pendingPipelineValue: 0,
      wonCount: 0,
      lostCount: 0,
      closedRevenue: 0,
    };

    curr.attributedDms += 1;
    const stage = String(l.crm_stage || 'NEW_INQUIRY');
    const val = Number(l.deal_value ?? 0);

    if (stage === 'QUALIFIED' || stage === 'PENDING' || stage === 'WON') {
      curr.qualifiedCount += 1;
    }
    if (stage === 'QUALIFIED') {
      curr.stageQualifiedOnlyCount += 1;
    }
    if (stage === 'PENDING') {
      curr.pendingCount += 1;
      curr.pendingPipelineValue += val;
    }
    if (stage === 'WON') {
      curr.wonCount += 1;
      curr.closedRevenue += val;
    }
    if (stage === 'LOST') {
      curr.lostCount += 1;
    }

    crmByAd.set(adId, curr);
  }

  return catalogRows.map((cat) => {
    const adId = String(cat.ad_id);
    const m = metricsByAd.get(adId) || {
      spend: 0,
      impressions: 0,
      linkClicks: 0,
      video3sViews: 0,
      thruplays: 0,
      metaConversations: 0,
    };
    const c = crmByAd.get(adId) || {
      attributedDms: 0,
      qualifiedCount: 0,
      stageQualifiedOnlyCount: 0,
      pendingCount: 0,
      pendingPipelineValue: 0,
      wonCount: 0,
      lostCount: 0,
      closedRevenue: 0,
    };

    const totalSpend = Number(m.spend.toFixed(2));
    const hookRatePct =
      m.impressions > 0
        ? Number(((m.video3sViews / m.impressions) * 100).toFixed(2))
        : 0;
    const holdRatePct =
      m.video3sViews > 0
        ? Number(((m.thruplays / m.video3sViews) * 100).toFixed(2))
        : 0;

    const totalDms = Math.max(m.metaConversations, c.attributedDms);
    const trueCpa =
      c.wonCount > 0 ? Number((totalSpend / c.wonCount).toFixed(2)) : null;
    const trueRoas =
      totalSpend > 0 ? Number((c.closedRevenue / totalSpend).toFixed(2)) : 0;
    const chatCloseRatePct =
      totalDms > 0 ? Number(((c.wonCount / totalDms) * 100).toFixed(2)) : 0;

    return {
      ad_id: adId,
      ad_name: String(cat.ad_name || `Ad ${adId}`),
      adset_id: cat.adset_id ? String(cat.adset_id) : null,
      adset_name: cat.adset_name ? String(cat.adset_name) : null,
      campaign_id: cat.campaign_id ? String(cat.campaign_id) : null,
      campaign_name: cat.campaign_name ? String(cat.campaign_name) : null,
      status: String(cat.status || 'ACTIVE'),
      thumbnail_url: cat.thumbnail_url ? String(cat.thumbnail_url) : null,
      creative_body: cat.creative_body ? String(cat.creative_body) : null,
      updated_at: String(cat.updated_at || new Date().toISOString()),
      total_spend: totalSpend,
      total_impressions: m.impressions,
      total_link_clicks: m.linkClicks,
      total_video_3s_views: m.video3sViews,
      total_thruplays: m.thruplays,
      hook_rate_pct: hookRatePct,
      hold_rate_pct: holdRatePct,
      meta_conversations: m.metaConversations,
      attributed_dms: c.attributedDms,
      total_dms: totalDms,
      qualified_count: c.qualifiedCount,
      stage_qualified_only_count: c.stageQualifiedOnlyCount,
      pending_count: c.pendingCount,
      pending_pipeline_value: Number(c.pendingPipelineValue.toFixed(2)),
      won_count: c.wonCount,
      lost_count: c.lostCount,
      closed_revenue: Number(c.closedRevenue.toFixed(2)),
      true_cpa: trueCpa,
      true_roas: trueRoas,
      chat_close_rate_pct: chatCloseRatePct,
      is_window_shopper:
        totalDms >= 20 && c.qualifiedCount === 0 && c.wonCount === 0,
    };
  });
}

type FilterPredicate = (row: Record<string, unknown>) => boolean;

class LocalQueryBuilder {
  private tableName: string;
  private operation: 'SELECT' | 'INSERT' | 'UPSERT' | 'UPDATE' | 'DELETE' = 'SELECT';
  private payload: Record<string, unknown> | Record<string, unknown>[] | null = null;
  private upsertOptions: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private filters: FilterPredicate[] = [];
  private orderSpec: { column: string; ascending: boolean } | null = null;
  private limitCount: number | null = null;
  private expectSingle = false;
  private expectMaybeSingle = false;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  select(_columns?: string): this {
    return this;
  }

  insert(rows: Record<string, unknown> | Record<string, unknown>[]): this {
    this.operation = 'INSERT';
    this.payload = rows;
    return this;
  }

  upsert(
    rows: Record<string, unknown> | Record<string, unknown>[],
    options?: { onConflict?: string; ignoreDuplicates?: boolean }
  ): this {
    this.operation = 'UPSERT';
    this.payload = rows;
    this.upsertOptions = options || {};
    return this;
  }

  update(fields: Record<string, unknown>): this {
    this.operation = 'UPDATE';
    this.payload = fields;
    return this;
  }

  delete(): this {
    this.operation = 'DELETE';
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push((row) => String(row[column] ?? '') === String(value ?? ''));
    return this;
  }

  neq(column: string, value: unknown): this {
    this.filters.push((row) => String(row[column] ?? '') !== String(value ?? ''));
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters.push((row) => String(row[column] ?? '') >= String(value ?? ''));
    return this;
  }

  lte(column: string, value: unknown): this {
    this.filters.push((row) => String(row[column] ?? '') <= String(value ?? ''));
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    if (operator === 'is' && value === null) {
      this.filters.push(
        (row) => row[column] !== null && row[column] !== undefined && row[column] !== ''
      );
    } else {
      this.filters.push((row) => row[column] !== value);
    }
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderSpec = {
      column,
      ascending: options?.ascending ?? true,
    };
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  single(): Promise<{ data: unknown; error: null | { message: string } }> {
    this.expectSingle = true;
    return this.execute();
  }

  maybeSingle(): Promise<{ data: unknown; error: null | { message: string } }> {
    this.expectMaybeSingle = true;
    return this.execute();
  }

  then<TResult1 = { data: unknown; error: null | { message: string } }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null | { message: string } }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<{ data: unknown; error: null | { message: string } }> {
    try {
      const db = readDb();

      if (this.tableName === 'v_mkt_ad_attribution') {
        let rows = computeAttributionRows(db) as unknown as Record<string, unknown>[];
        for (const f of this.filters) {
          rows = rows.filter(f);
        }
        return this.finalizeResult(rows);
      }

      if (!db[this.tableName]) {
        db[this.tableName] = [];
      }

      const table = db[this.tableName];
      const nowIso = new Date().toISOString();

      if (this.operation === 'INSERT') {
        const items = Array.isArray(this.payload)
          ? this.payload
          : this.payload
          ? [this.payload]
          : [];
        const inserted: Record<string, unknown>[] = [];

        for (const item of items) {
          const newRow: Record<string, unknown> = {
            ...(this.tableName !== 'mkt_ads_catalog' &&
            this.tableName !== 'mkt_share_links'
              ? { id: item.id || crypto.randomUUID() }
              : {}),
            created_at: item.created_at || nowIso,
            updated_at: item.updated_at || nowIso,
            ...item,
          };
          table.push(newRow);
          inserted.push(newRow);
        }

        writeDb(db);
        return this.finalizeResult(inserted);
      }

      if (this.operation === 'UPSERT') {
        const items = Array.isArray(this.payload)
          ? this.payload
          : this.payload
          ? [this.payload]
          : [];
        const conflictCols = (this.upsertOptions.onConflict || 'id')
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean);

        const upserted: Record<string, unknown>[] = [];

        for (const item of items) {
          const existingIdx = table.findIndex((row) =>
            conflictCols.every(
              (col) =>
                row[col] !== undefined &&
                item[col] !== undefined &&
                String(row[col]) === String(item[col])
            )
          );

          if (existingIdx >= 0) {
            if (!this.upsertOptions.ignoreDuplicates) {
              table[existingIdx] = {
                ...table[existingIdx],
                ...item,
                updated_at: item.updated_at || nowIso,
              };
            }
            upserted.push(table[existingIdx]);
          } else {
            const newRow: Record<string, unknown> = {
              ...(this.tableName !== 'mkt_ads_catalog' &&
              this.tableName !== 'mkt_share_links'
                ? { id: item.id || crypto.randomUUID() }
                : {}),
              created_at: item.created_at || nowIso,
              updated_at: item.updated_at || nowIso,
              ...item,
            };
            table.push(newRow);
            upserted.push(newRow);
          }
        }

        writeDb(db);
        return this.finalizeResult(upserted);
      }

      if (this.operation === 'UPDATE') {
        const updates = (this.payload || {}) as Record<string, unknown>;
        const updatedRows: Record<string, unknown>[] = [];

        for (let i = 0; i < table.length; i++) {
          const row = table[i];
          if (this.filters.every((f) => f(row))) {
            table[i] = {
              ...row,
              ...updates,
              updated_at: updates.updated_at || nowIso,
            };
            updatedRows.push(table[i]);
          }
        }

        writeDb(db);
        return this.finalizeResult(updatedRows);
      }

      if (this.operation === 'DELETE') {
        const deletedRows: Record<string, unknown>[] = [];
        const remainingRows: Record<string, unknown>[] = [];
        for (const row of table) {
          if (this.filters.every((f) => f(row))) {
            deletedRows.push(row);
          } else {
            remainingRows.push(row);
          }
        }
        db[this.tableName] = remainingRows;
        writeDb(db);
        return this.finalizeResult(deletedRows);
      }

      // SELECT
      let rows = [...table];
      for (const f of this.filters) {
        rows = rows.filter(f);
      }

      if (this.orderSpec) {
        const { column, ascending } = this.orderSpec;
        rows.sort((a, b) => {
          const va = a[column];
          const vb = b[column];
          if (va === vb) return 0;
          if (va === undefined || va === null) return 1;
          if (vb === undefined || vb === null) return -1;
          if (typeof va === 'number' && typeof vb === 'number') {
            return ascending ? va - vb : vb - va;
          }
          return ascending
            ? String(va).localeCompare(String(vb))
            : String(vb).localeCompare(String(va));
        });
      }

      if (this.limitCount !== null) {
        rows = rows.slice(0, this.limitCount);
      }

      return this.finalizeResult(rows);
    } catch (error) {
      return {
        data: null,
        error: {
          message:
            error instanceof Error ? error.message : 'Local DB operation failed.',
        },
      };
    }
  }

  private finalizeResult(rows: Record<string, unknown>[]): {
    data: unknown;
    error: null | { message: string };
  } {
    if (this.expectSingle) {
      if (rows.length === 0) {
        return { data: null, error: { message: 'No rows found.' } };
      }
      return { data: rows[0], error: null };
    }

    if (this.expectMaybeSingle) {
      return { data: rows[0] ?? null, error: null };
    }

    return { data: rows, error: null };
  }
}

export function createLocalSupabaseAdapter(): SupabaseClient {
  const adapter = {
    from(tableName: string) {
      return new LocalQueryBuilder(tableName);
    },
    async rpc(
      fnName: string,
      params?: { p_start_date?: string | null; p_end_date?: string | null }
    ) {
      if (fnName === 'fn_mkt_ad_attribution_by_date') {
        const db = readDb();
        const rows = computeAttributionRows(
          db,
          params?.p_start_date,
          params?.p_end_date
        );
        return { data: rows, error: null };
      }
      return { data: [], error: null };
    },
  };

  return adapter as unknown as SupabaseClient;
}

