import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { sendMetaCapiEvent } from '@/lib/meta-engine/meta-capi';
import type { MktAttributionLedgerRow, MktCrmStage } from '@/lib/meta-engine/types';

export const dynamic = 'force-dynamic';

const VALID_STAGES: MktCrmStage[] = [
  'NEW_INQUIRY',
  'QUALIFIED',
  'PENDING',
  'WON',
  'LOST',
];

interface CrmSyncRequestBody {
  crm_deal_id?: string | number;
  customer_psid: string;
  new_stage: MktCrmStage;
  deal_value?: number | string;
}

/**
 * POST /api/webhooks/crm-sync
 * Receives real-time pipeline stage transitions from the In-House CRM.
 * Updates `mkt_attribution_ledger` and triggers Meta CAPI `Lead` or `Purchase` loopback events.
 */
export async function POST(request: NextRequest) {
  try {
    const providedSecret = request.headers.get('x-bridge-secret');
    const expectedSecret =
      process.env.INTERNAL_BRIDGE_SECRET || process.env.CRM_INBOUND_WEBHOOK_SECRET;

    if (!expectedSecret || providedSecret !== expectedSecret) {
      return NextResponse.json(
        { error: 'Unauthorized: invalid or missing x-bridge-secret header.' },
        { status: 401 }
      );
    }

    const body = (await request.json()) as CrmSyncRequestBody;
    const customerPsid = body.customer_psid?.trim();
    const newStage = body.new_stage;

    if (!customerPsid) {
      return NextResponse.json(
        { error: 'Missing required field: customer_psid.' },
        { status: 400 }
      );
    }

    if (!newStage || !VALID_STAGES.includes(newStage)) {
      return NextResponse.json(
        {
          error: `Invalid new_stage "${String(newStage)}". Expected one of: ${VALID_STAGES.join(', ')}.`,
        },
        { status: 400 }
      );
    }

    const numericDealValue =
      body.deal_value !== undefined && body.deal_value !== null
        ? Number.parseFloat(String(body.deal_value)) || 0
        : undefined;

    const supabase = getSupabaseAdmin();

    // 1. Fetch existing attribution ledger record for this customer_psid
    const { data: existingLedger, error: fetchError } = await supabase
      .from('mkt_attribution_ledger')
      .select('*')
      .eq('customer_psid', customerPsid)
      .maybeSingle<MktAttributionLedgerRow>();

    if (fetchError) {
      throw new Error(
        `[CrmSync] Database error looking up PSID ${customerPsid}: ${fetchError.message}`
      );
    }

    if (!existingLedger) {
      return NextResponse.json(
        {
          error: `No attributed Meta inquiry found in mkt_attribution_ledger for customer_psid "${customerPsid}".`,
        },
        { status: 404 }
      );
    }

    const nowIso = new Date().toISOString();
    const resolvedDealValue =
      numericDealValue !== undefined
        ? Number(numericDealValue.toFixed(2))
        : Number(existingLedger.deal_value || 0);

    const isTerminalStage = newStage === 'WON' || newStage === 'LOST';

    // 2. Update the CRM stage and deal value in `mkt_attribution_ledger`
    const updatePayload: Record<string, unknown> = {
      crm_stage: newStage,
      deal_value: resolvedDealValue,
      updated_at: nowIso,
    };

    if (body.crm_deal_id !== undefined && body.crm_deal_id !== null) {
      updatePayload.crm_deal_id = String(body.crm_deal_id);
    }

    if (isTerminalStage) {
      updatePayload.closed_at = existingLedger.closed_at || nowIso;
    }

    const { data: updatedLedger, error: updateError } = await supabase
      .from('mkt_attribution_ledger')
      .update(updatePayload)
      .eq('id', existingLedger.id)
      .select('*')
      .single<MktAttributionLedgerRow>();

    if (updateError || !updatedLedger) {
      throw new Error(
        `[CrmSync] Failed updating mkt_attribution_ledger: ${updateError?.message}`
      );
    }

    // 3. Meta Conversions API (CAPI) Loopback Dispatcher
    let capiEventFired: 'Lead' | 'Purchase' | null = null;
    let capiResponse = null;

    if (newStage === 'QUALIFIED') {
      capiResponse = await sendMetaCapiEvent({
        psid: updatedLedger.customer_psid,
        platform: updatedLedger.platform,
        eventName: 'Lead',
        value: resolvedDealValue,
        currency: 'PHP',
        eventId: `lead_${updatedLedger.customer_psid}_${updatedLedger.crm_deal_id || updatedLedger.id}`,
        adId: updatedLedger.source_ad_id,
      });
      capiEventFired = 'Lead';
    } else if (newStage === 'WON' && !existingLedger.capi_purchase_sent) {
      capiResponse = await sendMetaCapiEvent({
        psid: updatedLedger.customer_psid,
        platform: updatedLedger.platform,
        eventName: 'Purchase',
        value: resolvedDealValue,
        currency: 'PHP',
        eventId: `purchase_${updatedLedger.customer_psid}_${updatedLedger.crm_deal_id || updatedLedger.id}`,
        adId: updatedLedger.source_ad_id,
      });
      capiEventFired = 'Purchase';

      // Mark `capi_purchase_sent = true` so duplicate WON webhooks never double-fire Purchase events
      const { error: flagError } = await supabase
        .from('mkt_attribution_ledger')
        .update({
          capi_purchase_sent: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', updatedLedger.id);

      if (flagError) {
        console.error(
          `[CrmSync] CAPI Purchase sent for ${customerPsid}, but failed setting capi_purchase_sent=true:`,
          flagError.message
        );
      } else {
        updatedLedger.capi_purchase_sent = true;
      }
    }

    return NextResponse.json(
      {
        success: true,
        ledger: updatedLedger,
        capi: {
          eventFired: capiEventFired,
          response: capiResponse,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[CrmSync] Error handling CRM sync webhook:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Internal server error in CRM sync webhook.',
      },
      { status: 500 }
    );
  }
}

