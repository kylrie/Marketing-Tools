import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  fetchActiveCampaignsAndAdSets,
  publishBulkAdsBatch,
  uploadAdMedia,
  type MetaAdSetOption,
  type MetaCampaignOption,
  type PublishBulkAdsBatchConfig,
} from '@/lib/meta-engine/meta-launcher';
import type {
  MktChatIcebreaker,
  MktChatTemplateRow,
  MktLaunchBatchRow,
} from '@/lib/meta-engine/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = getSupabaseAdmin();

    const { data: chatTemplates, error: tplError } = await supabase
      .from('mkt_chat_templates')
      .select('*')
      .order('created_at', { ascending: false });

    if (tplError) {
      throw new Error(
        `[LauncherAPI] Error loading mkt_chat_templates: ${tplError.message}`
      );
    }

    const { data: launchBatches } = await supabase
      .from('mkt_launch_batches')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    let campaigns: MetaCampaignOption[] = [];
    let adSets: MetaAdSetOption[] = [];
    let metaSource: 'graph_api' | 'catalog_fallback' = 'graph_api';

    try {
      const metaHierarchy = await fetchActiveCampaignsAndAdSets();
      campaigns = metaHierarchy.campaigns;
      adSets = metaHierarchy.adSets;
    } catch {
      metaSource = 'catalog_fallback';
      const { data: catalogRows } = await supabase
        .from('mkt_ads_catalog')
        .select('campaign_id, campaign_name, adset_id, adset_name, status');

      const campMap = new Map<string, MetaCampaignOption>();
      const adSetMap = new Map<string, MetaAdSetOption>();

      for (const row of catalogRows || []) {
        if (row.campaign_id && !campMap.has(row.campaign_id)) {
          campMap.set(row.campaign_id, {
            id: String(row.campaign_id),
            name: String(row.campaign_name || `Campaign ${row.campaign_id}`),
            status: 'ACTIVE',
            objective: 'OUTCOME_ENGAGEMENT',
          });
        }
        if (row.adset_id && !adSetMap.has(row.adset_id)) {
          adSetMap.set(row.adset_id, {
            id: String(row.adset_id),
            name: String(row.adset_name || `Ad Set ${row.adset_id}`),
            status: 'ACTIVE',
            campaign_id: String(row.campaign_id || ''),
            campaign_name: row.campaign_name ? String(row.campaign_name) : undefined,
            optimization_goal: 'CONVERSATIONS',
            destination_type: 'MESSENGER',
            is_messaging_optimized: true,
          });
        }
      }

      campaigns = Array.from(campMap.values());
      adSets = Array.from(adSetMap.values());
    }

    return NextResponse.json({
      metaSource,
      campaigns,
      adSets,
      chatTemplates: (chatTemplates || []) as MktChatTemplateRow[],
      launchBatches: (launchBatches || []) as MktLaunchBatchRow[],
    });
  } catch (error) {
    console.error('[LauncherAPI] GET error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed loading Bulk Ad Launcher data.',
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      id?: string;
      template_name: string;
      greeting_text: string;
      icebreakers: MktChatIcebreaker[];
    };

    const templateName = body.template_name?.trim();
    const greetingText = body.greeting_text?.trim();

    if (!templateName || !greetingText) {
      return NextResponse.json(
        { error: 'Template Name and Greeting Text are required.' },
        { status: 400 }
      );
    }

    const sanitizedIcebreakers = (body.icebreakers || [])
      .filter((ib) => ib.question?.trim())
      .map((ib, idx) => ({
        question: ib.question.trim(),
        payload:
          ib.payload?.trim() ||
          `ICEBREAKER_${idx + 1}_${ib.question
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '_')
            .slice(0, 24)}`,
      }));

    const supabase = getSupabaseAdmin();

    if (body.id) {
      const { data: updated, error } = await supabase
        .from('mkt_chat_templates')
        .update({
          template_name: templateName,
          greeting_text: greetingText,
          icebreakers: sanitizedIcebreakers,
          updated_at: new Date().toISOString(),
        })
        .eq('id', body.id)
        .select('*')
        .single<MktChatTemplateRow>();

      if (error) {
        throw new Error(
          `[LauncherAPI] Failed updating chat template: ${error.message}`
        );
      }

      return NextResponse.json({ success: true, chatTemplate: updated });
    }

    const { data: created, error } = await supabase
      .from('mkt_chat_templates')
      .insert({
        template_name: templateName,
        greeting_text: greetingText,
        icebreakers: sanitizedIcebreakers,
      })
      .select('*')
      .single<MktChatTemplateRow>();

    if (error) {
      throw new Error(
        `[LauncherAPI] Failed creating chat template: ${error.message}`
      );
    }

    return NextResponse.json({ success: true, chatTemplate: created });
  } catch (error) {
    console.error('[LauncherAPI] PUT error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed saving chat template.',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as
      | ({ action: 'UPLOAD_MEDIA'; fileUrlOrBase64: string; type: 'IMAGE' | 'VIDEO' })
      | ({ action?: 'PUBLISH_BATCH' } & PublishBulkAdsBatchConfig);

    if (body.action === 'UPLOAD_MEDIA') {
      const uploaded = await uploadAdMedia(body.fileUrlOrBase64, body.type);
      return NextResponse.json({
        success: true,
        uploaded,
      });
    }

    const batchPayload = body as PublishBulkAdsBatchConfig;
    const result = await publishBulkAdsBatch(batchPayload);

    return NextResponse.json({
      success: true,
      batch: result.batch,
      publishedAds: result.publishedAds,
    });
  } catch (error) {
    console.error('[LauncherAPI] POST error:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed publishing bulk ads batch to Meta Ads Manager.',
      },
      { status: 500 }
    );
  }
}
