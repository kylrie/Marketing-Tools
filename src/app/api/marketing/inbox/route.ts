import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  fetchUnifiedInboxConversations,
  sendPageChatMessage,
} from '@/lib/meta-engine/meta-inbox-posts';
import { sendMetaCapiEvent } from '@/lib/meta-engine/meta-capi';
import type {
  MktAttributionLedgerRow,
  MktCrmStage,
  MktMessagingPlatform,
} from '@/lib/meta-engine/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/marketing/inbox
 * Returns unified Messenger & Instagram DM conversations from Meta Graph API (`/{page_id}/conversations`)
 * joined with `mkt_inbox_messages`, `mkt_attribution_ledger`, and `mkt_ads_catalog`.
 */
export async function GET() {
  try {
    const result = await fetchUnifiedInboxConversations();
    return NextResponse.json({
      success: true,
      pageId: result.pageId,
      threads: result.threads,
      catalogAds: result.catalogAds,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[InboxAPI] GET error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed loading Meta Messenger & IG conversations.',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/marketing/inbox
 * Supports:
 * 1. `action: 'SEND_MESSAGE'` -> Sends a reply to the Facebook Messenger / IG DM user via Graph API.
 * 2. `action: 'UPDATE_CRM_STAGE'` -> Updates the customer's CRM Pipeline Stage (`QUALIFIED`, `PENDING`, `WON`, `LOST`),
 *    Deal Value (`₱`), and `source_ad_id` in `mkt_attribution_ledger`, and fires Meta CAPI (`Lead` / `Purchase`).
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as
      | {
          action: 'SEND_MESSAGE';
          customerPsid: string;
          customerName?: string;
          platform?: MktMessagingPlatform;
          messageText?: string;
          threadId?: string;
          mediaType?: 'IMAGE' | 'VIDEO' | null;
          mediaUrlOrBase64?: string | null;
          mediaFileName?: string;
          mediaMimeType?: string;
        }
      | {
          action: 'UPDATE_CRM_STAGE';
          customerPsid: string;
          customerName?: string;
          platform?: MktMessagingPlatform;
          crmStage: MktCrmStage;
          dealValuePhp?: number;
          sourceAdId?: string | null;
        };

    if (body.action === 'SEND_MESSAGE') {
      const customerPsid = body.customerPsid?.trim();
      const messageText = body.messageText?.trim() || '';
      const hasMedia = Boolean(body.mediaType && body.mediaUrlOrBase64);

      if (!customerPsid || (!messageText && !hasMedia)) {
        return NextResponse.json(
          { error: 'customerPsid and either messageText or a media attachment are required.' },
          { status: 400 }
        );
      }

      const sent = await sendPageChatMessage({
        customerPsid,
        customerName: body.customerName,
        platform: body.platform || 'MESSENGER',
        messageText,
        threadId: body.threadId,
        mediaType: body.mediaType || null,
        mediaUrlOrBase64: body.mediaUrlOrBase64 || null,
        mediaFileName: body.mediaFileName,
        mediaMimeType: body.mediaMimeType,
      });

      return NextResponse.json({
        success: true,
        ...sent,
      });
    }

    if (body.action === 'UPDATE_CRM_STAGE') {
      const customerPsid = body.customerPsid?.trim();
      if (!customerPsid) {
        return NextResponse.json(
          { error: 'customerPsid is required.' },
          { status: 400 }
        );
      }

      const supabase = getSupabaseAdmin();
      const nowIso = new Date().toISOString();
      const dealValue = Number(body.dealValuePhp ?? 0);
      const platform = body.platform || 'MESSENGER';

      const { data: existing } = await supabase
        .from('mkt_attribution_ledger')
        .select('*')
        .eq('customer_psid', customerPsid)
        .maybeSingle<MktAttributionLedgerRow>();

      const { data: updatedLedger, error: upsertErr } = await supabase
        .from('mkt_attribution_ledger')
        .upsert(
          {
            customer_psid: customerPsid,
            customer_name:
              body.customerName ||
              existing?.customer_name ||
              `Meta Lead (${customerPsid.slice(-6)})`,
            platform,
            source_ad_id:
              body.sourceAdId !== undefined
                ? body.sourceAdId || null
                : existing?.source_ad_id || null,
            crm_stage: body.crmStage,
            deal_value: dealValue,
            ...(body.crmStage === 'QUALIFIED' && !existing?.qualified_at
              ? { qualified_at: nowIso }
              : {}),
            ...(body.crmStage === 'WON' ? { closed_at: nowIso } : {}),
          },
          { onConflict: 'customer_psid' }
        )
        .select('*')
        .single<MktAttributionLedgerRow>();

      if (upsertErr) {
        throw new Error(`[InboxAPI] Failed updating CRM stage: ${upsertErr.message}`);
      }

      // Fire Meta CAPI for Business Messaging when transitioning to QUALIFIED (`Lead`) or WON (`Purchase`)
      let capiDispatched: string | null = null;
      let capiError: string | null = null;

      try {
        if (body.crmStage === 'QUALIFIED' && !existing?.capi_lead_sent) {
          await sendMetaCapiEvent({
            psid: customerPsid,
            platform,
            eventName: 'Lead',
            adId: updatedLedger.source_ad_id,
          });
          capiDispatched = 'Lead';
          await supabase
            .from('mkt_attribution_ledger')
            .update({ capi_lead_sent: true })
            .eq('customer_psid', customerPsid);
        } else if (body.crmStage === 'WON' && !existing?.capi_purchase_sent) {
          await sendMetaCapiEvent({
            psid: customerPsid,
            platform,
            eventName: 'Purchase',
            value: dealValue,
            currency: 'PHP',
            adId: updatedLedger.source_ad_id,
          });
          capiDispatched = 'Purchase';
          await supabase
            .from('mkt_attribution_ledger')
            .update({ capi_purchase_sent: true })
            .eq('customer_psid', customerPsid);
        }
      } catch (capiErr) {
        capiError =
          capiErr instanceof Error ? capiErr.message : 'CAPI dispatch warning';
      }

      return NextResponse.json({
        success: true,
        ledger: updatedLedger,
        capiDispatched,
        capiError,
      });
    }

    return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
  } catch (error) {
    console.error('[InboxAPI] POST error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed processing inbox action.',
      },
      { status: 500 }
    );
  }
}

