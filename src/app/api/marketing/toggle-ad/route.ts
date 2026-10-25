import { NextRequest, NextResponse } from 'next/server';
import { setAdStatus } from '@/lib/meta-engine/meta-actions';
import type { MktAdToggleStatus } from '@/lib/meta-engine/types';

export const dynamic = 'force-dynamic';

interface ToggleAdRequestBody {
  adId?: string;
  ad_id?: string;
  status: MktAdToggleStatus;
}

/**
 * POST /api/marketing/toggle-ad
 * Toggles an ad's status (`ACTIVE` | `PAUSED`) in Meta Ads Manager
 * and updates `mkt_ads_catalog.status` in Supabase.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ToggleAdRequestBody;
    const adId = (body.adId || body.ad_id || '').trim();
    const targetStatus = body.status;

    if (!adId) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: adId.' },
        { status: 400 }
      );
    }

    if (targetStatus !== 'ACTIVE' && targetStatus !== 'PAUSED') {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid status "${String(targetStatus)}". Must be 'ACTIVE' or 'PAUSED'.`,
        },
        { status: 400 }
      );
    }

    const result = await setAdStatus(adId, targetStatus);

    return NextResponse.json(
      {
        success: true,
        adId: result.adId,
        status: result.status,
        updatedAt: result.updatedAt,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[ToggleAdAPI] Failed toggling ad status:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed updating ad status in Meta.',
      },
      { status: 500 }
    );
  }
}
