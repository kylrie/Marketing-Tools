import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  extractAttributableMessagingEvents,
  fetchMetaCustomerName,
  verifyMetaSignature,
  verifyMetaWebhookChallenge,
  type MetaWebhookPayload,
} from '@/lib/meta-engine/meta-webhooks';
import { handleIncomingComment } from '@/lib/meta-engine/meta-comments';

export const dynamic = 'force-dynamic';

/**
 * GET /api/webhooks/meta
 * Handles Meta App Dashboard webhook verification (`hub.mode`, `hub.verify_token`, `hub.challenge`).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const { valid, challenge } = verifyMetaWebhookChallenge(searchParams);

  if (!valid || !challenge) {
    return NextResponse.json(
      { error: 'Webhook verification failed: invalid hub.verify_token or hub.mode.' },
      { status: 403 }
    );
  }

  return new NextResponse(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

/**
 * POST /api/webhooks/meta
 * 1. Listens to `entry[].messaging[]` (`messages` & `messaging_referrals`) to extract
 *    `customer_psid` + `source_ad_id`, upsert `mkt_attribution_ledger`, and forward leads to the In-House CRM.
 * 2. Listens to `entry[].changes[]` where `field === 'feed'` or `field === 'comments'`
 *    and dispatches new comments to `handleIncomingComment()` (AI Comment-to-DM Shield).
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signatureHeader = request.headers.get('x-hub-signature-256');

    if (!verifyMetaSignature(rawBody, signatureHeader)) {
      return NextResponse.json(
        { error: 'Invalid X-Hub-Signature-256 header.' },
        { status: 401 }
      );
    }

    const payload = JSON.parse(rawBody) as MetaWebhookPayload & Record<string, unknown>;

    // -------------------------------------------------------------------------
    // Part A: Process Feed / Instagram Comments via AI Comment-to-DM Shield
    // -------------------------------------------------------------------------
    const hasCommentChanges =
      Array.isArray(payload.entry) &&
      payload.entry.some((entry) => {
        const changes = (entry as unknown as { changes?: Array<{ field?: string }> })
          .changes;
        return (
          Array.isArray(changes) &&
          changes.some((c) => c.field === 'feed' || c.field === 'comments')
        );
      });

    const commentShieldResults = hasCommentChanges
      ? await handleIncomingComment(payload)
      : [];

    // -------------------------------------------------------------------------
    // Part B: Process Messaging Ad Referrals (`messages` & `messaging_referrals`)
    // -------------------------------------------------------------------------
    const referralEvents = extractAttributableMessagingEvents(payload);

    if (referralEvents.length === 0) {
      return NextResponse.json(
        {
          received: true,
          processedReferrals: 0,
          processedComments: commentShieldResults.length,
          commentResults: commentShieldResults,
        },
        { status: 200 }
      );
    }

    const supabase = getSupabaseAdmin();
    const crmWebhookUrl =
      process.env.CRM_WEBHOOK_URL || process.env.CRM_OUTBOUND_WEBHOOK_URL;
    const bridgeSecret =
      process.env.INTERNAL_BRIDGE_SECRET || process.env.CRM_OUTBOUND_WEBHOOK_SECRET || '';

    const processedResults: Array<{
      customer_psid: string;
      source_ad_id: string;
      platform: string;
      crm_forwarded: boolean;
    }> = [];

    for (const event of referralEvents) {
      // 1. Ensure `source_ad_id` exists in `mkt_ads_catalog` to satisfy FK constraint
      await supabase.from('mkt_ads_catalog').upsert(
        {
          ad_id: event.sourceAdId,
          ad_name: event.adTitle || `Ad ${event.sourceAdId}`,
          status: 'ACTIVE',
        },
        { onConflict: 'ad_id', ignoreDuplicates: true }
      );

      // 2. Fetch customer display name from Graph API (`/{psid}?fields=name`)
      const customerName = await fetchMetaCustomerName(event.customerPsid);

      // 3. Check if customer already has a ledger entry
      const { data: existingLedger } = await supabase
        .from('mkt_attribution_ledger')
        .select('id, customer_name, source_ad_id, crm_deal_id, crm_stage')
        .eq('customer_psid', event.customerPsid)
        .maybeSingle();

      const resolvedName =
        customerName ||
        existingLedger?.customer_name ||
        `Meta Lead (${event.customerPsid.slice(-6)})`;

      const resolvedAdId = existingLedger?.source_ad_id || event.sourceAdId;

      const { data: upsertedRow, error: upsertError } = await supabase
        .from('mkt_attribution_ledger')
        .upsert(
          {
            customer_psid: event.customerPsid,
            customer_name: resolvedName,
            platform: event.platform,
            source_ad_id: resolvedAdId,
            crm_stage: existingLedger?.crm_stage || 'NEW_INQUIRY',
            ...(existingLedger ? {} : { first_inquiry_at: event.eventTimestampIso }),
          },
          { onConflict: 'customer_psid' }
        )
        .select('*')
        .single();

      if (upsertError) {
        console.error(
          `[MetaWebhook] Failed upserting ledger for PSID ${event.customerPsid}:`,
          upsertError.message
        );
        continue;
      }

      // 4. Forward newly attributed lead to the In-House CRM via authenticated webhook
      let crmForwarded = false;
      if (crmWebhookUrl) {
        try {
          const crmResponse = await fetch(crmWebhookUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-bridge-secret': bridgeSecret,
            },
            body: JSON.stringify({
              event: 'META_ATTRIBUTED_INQUIRY',
              ledger_id: upsertedRow.id,
              customer_psid: event.customerPsid,
              customer_name: resolvedName,
              platform: event.platform,
              source_ad_id: resolvedAdId,
              ad_title: event.adTitle,
              initial_message: event.messageText,
              first_inquiry_at: upsertedRow.first_inquiry_at,
            }),
            cache: 'no-store',
          });

          crmForwarded = crmResponse.ok;

          if (crmResponse.ok) {
            const crmData = (await crmResponse.json().catch(() => null)) as {
              crm_deal_id?: string;
            } | null;

            if (crmData?.crm_deal_id && !existingLedger?.crm_deal_id) {
              await supabase
                .from('mkt_attribution_ledger')
                .update({ crm_deal_id: String(crmData.crm_deal_id) })
                .eq('customer_psid', event.customerPsid);
            }
          }
        } catch (crmErr) {
          console.error(
            `[MetaWebhook] Error posting lead ${event.customerPsid} to CRM_WEBHOOK_URL:`,
            crmErr
          );
        }
      }

      processedResults.push({
        customer_psid: event.customerPsid,
        source_ad_id: resolvedAdId,
        platform: event.platform,
        crm_forwarded: crmForwarded,
      });
    }

    return NextResponse.json(
      {
        received: true,
        processedReferrals: processedResults.length,
        results: processedResults,
        processedComments: commentShieldResults.length,
        commentResults: commentShieldResults,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[MetaWebhook] Unhandled error processing webhook:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Internal server error processing Meta webhook.',
      },
      { status: 500 }
    );
  }
}
