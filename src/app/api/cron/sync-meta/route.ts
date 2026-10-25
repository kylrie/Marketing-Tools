import { NextRequest, NextResponse } from 'next/server';
import {
  syncAdsCatalog,
  syncDailyMetrics,
} from '@/lib/meta-engine/meta-insights';
import { evaluateWatchdogRules } from '@/lib/meta-engine/meta-watchdog';

export const dynamic = 'force-dynamic';

function isAuthorizedCronRequest(
  request: NextRequest,
  isManualUiTrigger: boolean
): boolean {
  if (isManualUiTrigger) {
    return true;
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return true;
  }

  const authHeader = request.headers.get('authorization');
  const bridgeHeader = request.headers.get('x-bridge-secret');

  return (
    authHeader === `Bearer ${cronSecret}` ||
    bridgeHeader === cronSecret ||
    bridgeHeader === process.env.INTERNAL_BRIDGE_SECRET
  );
}

/**
 * GET /api/cron/sync-meta
 * Invoked hourly by Vercel Cron / scheduler.
 * Runs `syncAdsCatalog()` -> `syncDailyMetrics('last_7d')` -> `evaluateWatchdogRules()`.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request, false)) {
    return NextResponse.json(
      { error: 'Unauthorized cron trigger.' },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const datePreset = searchParams.get('datePreset') || 'last_7d';

    const catalogResult = await syncAdsCatalog();
    const metricsResult = await syncDailyMetrics(datePreset);
    const watchdogResult = await evaluateWatchdogRules();

    return NextResponse.json(
      {
        success: true,
        catalogSynced: catalogResult.syncedCount,
        dailyMetricRowsSynced: metricsResult.syncedRows,
        datePreset: metricsResult.datePreset,
        watchdog: watchdogResult,
        syncedAt: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[CronSyncMeta] GET sync failed:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed syncing Meta catalog, insights, and watchdog rules.',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/cron/sync-meta
 * Invoked by the manual "Sync Meta Now" button on `/marketing/attribution`.
 * Runs `syncAdsCatalog()` -> `syncDailyMetrics()` -> `evaluateWatchdogRules()`.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      datePreset?: string;
      since?: string;
      until?: string;
      skipWatchdog?: boolean;
    };

    const datePreset = body.datePreset || 'last_30d';
    const customTimeRange =
      body.since && body.until
        ? { since: body.since, until: body.until }
        : undefined;

    const catalogResult = await syncAdsCatalog();
    const metricsResult = await syncDailyMetrics(datePreset, customTimeRange);
    const watchdogResult = body.skipWatchdog
      ? null
      : await evaluateWatchdogRules();

    return NextResponse.json(
      {
        success: true,
        catalogSynced: catalogResult.syncedCount,
        dailyMetricRowsSynced: metricsResult.syncedRows,
        datePreset: customTimeRange
          ? `${customTimeRange.since}_to_${customTimeRange.until}`
          : metricsResult.datePreset,
        watchdog: watchdogResult,
        syncedAt: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[CronSyncMeta] POST manual sync failed:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed syncing Meta catalog, insights, and watchdog rules.',
      },
      { status: 500 }
    );
  }
}

