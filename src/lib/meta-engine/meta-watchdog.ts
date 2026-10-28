import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { setAdStatus } from './meta-actions';
import type {
  MktAdAttributionViewRow,
  MktWatchdogRuleRow,
} from './types';

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface WatchdogEvaluationDecision {
  adId: string;
  adName: string;
  ruleId: string;
  ruleName: string;
  ruleType: string;
  actionTaken: string;
  reason: string;
}

function getMarketingAccessToken(): string {
  const token =
    process.env.META_SYSTEM_USER_TOKEN ||
    process.env.META_ACCESS_TOKEN ||
    process.env.META_SYSTEM_USER_ACCESS_TOKEN;

  if (!token) {
    throw new Error(
      '[MetaWatchdog] Missing META_SYSTEM_USER_TOKEN or META_ACCESS_TOKEN.'
    );
  }
  return token;
}

/**
 * Increases an Ad Set's `daily_budget` by +20% via Meta Marketing API
 * (`GET /v21.0/${adsetId}?fields=daily_budget` -> `POST /v21.0/${adsetId}`).
 */
async function increaseAdSetDailyBudgetBy20Pct(adsetId: string): Promise<{
  previousBudgetMinorUnits: number;
  newBudgetMinorUnits: number;
}> {
  const accessToken = getMarketingAccessToken();
  const getUrl = new URL(`${GRAPH_BASE_URL}/${encodeURIComponent(adsetId)}`);
  getUrl.searchParams.set('fields', 'daily_budget');
  getUrl.searchParams.set('access_token', accessToken);

  const getRes = await fetch(getUrl.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  const getData = (await getRes.json()) as {
    daily_budget?: string;
    error?: { message: string };
  };

  if (!getRes.ok || getData.error) {
    throw new Error(
      getData.error?.message || `Failed reading daily_budget for adset ${adsetId}`
    );
  }

  const currentBudget = Number.parseInt(getData.daily_budget || '0', 10);
  if (!currentBudget || currentBudget <= 0) {
    throw new Error(
      `AdSet ${adsetId} uses campaign-level (CBO) or lifetime budget; daily_budget is not set.`
    );
  }

  const newBudget = Math.round(currentBudget * 1.2);

  const postRes = await fetch(`${GRAPH_BASE_URL}/${encodeURIComponent(adsetId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      daily_budget: String(newBudget),
      access_token: accessToken,
    }),
    cache: 'no-store',
  });

  const postData = (await postRes.json()) as {
    success?: boolean;
    error?: { message: string };
  };

  if (!postRes.ok || postData.error) {
    throw new Error(
      postData.error?.message || `Failed updating daily_budget for adset ${adsetId}`
    );
  }

  return {
    previousBudgetMinorUnits: currentBudget,
    newBudgetMinorUnits: newBudget,
  };
}

/**
 * Checks whether an ad matches a specific Watchdog Rule's threshold conditions.
 */
function doesAdMatchRule(
  ad: MktAdAttributionViewRow,
  rule: MktWatchdogRuleRow
): { matched: boolean; reasonSummary: string } {
  const spend = Number(ad.total_spend || 0);
  const dms = Number(ad.total_dms || 0);
  const qualified = Number(ad.qualified_count || 0);
  const won = Number(ad.won_count || 0);
  const roas = Number(ad.true_roas || 0);

  const minSpend = Number(rule.min_spend_php || 0);
  const minDms = Number(rule.min_dms || 0);
  const maxQualified = Number(rule.max_qualified_leads || 0);
  const minRoas = Number(rule.min_roas || 0);

  if (rule.rule_type === 'FREEBIE_SEEKER_KILLER') {
    const matched =
      spend >= minSpend &&
      dms >= minDms &&
      qualified <= maxQualified &&
      won === 0;

    return {
      matched,
      reasonSummary: `Rule "${rule.rule_name}" triggered: ${dms} DMs (≥ ${minDms}), ₱${spend.toFixed(
        2
      )} spend (≥ ₱${minSpend.toFixed(2)}), ${qualified} qualified leads (≤ ${maxQualified}), 0 won deals.`,
    };
  }

  if (rule.rule_type === 'BLEEDING_SPEND_STOPLOSS') {
    const matched =
      spend >= minSpend &&
      dms >= minDms &&
      roas < minRoas;

    return {
      matched,
      reasonSummary: `Rule "${rule.rule_name}" triggered: ₱${spend.toFixed(
        2
      )} spend (≥ ₱${minSpend.toFixed(2)}) with ${roas.toFixed(2)}x True ROAS (< ${minRoas.toFixed(
        2
      )}x threshold).`,
    };
  }

  if (rule.rule_type === 'WINNER_SCALER') {
    const matched =
      spend >= minSpend &&
      dms >= minDms &&
      roas >= minRoas &&
      won > 0;

    return {
      matched,
      reasonSummary: `Rule "${rule.rule_name}" triggered: ${roas.toFixed(
        2
      )}x True ROAS (≥ ${minRoas.toFixed(2)}x), ${won} won deals, ₱${spend.toFixed(
        2
      )} spend.`,
    };
  }

  return { matched: false, reasonSummary: '' };
}

/**
 * Evaluates all currently `ACTIVE` ads from `v_mkt_ad_attribution` against
 * active rules in `mkt_watchdog_rules`.
 * Enforces the 48-hour CRM Pending Pipeline safeguard before pausing any ad.
 */
export async function evaluateWatchdogRules(): Promise<{
  evaluatedAdsCount: number;
  activeRulesCount: number;
  decisionsCount: number;
  decisions: WatchdogEvaluationDecision[];
}> {
  const supabase = getSupabaseAdmin();

  // 1. Fetch active watchdog rules and all currently ACTIVE ads from `v_mkt_ad_attribution`
  const [
    { data: activeRules, error: rulesError },
    { data: activeAds, error: adsError },
  ] = await Promise.all([
    supabase
      .from('mkt_watchdog_rules')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: true }),
    supabase
      .from('v_mkt_ad_attribution')
      .select('*')
      .eq('status', 'ACTIVE'),
  ]);

  if (rulesError) {
    throw new Error(`[MetaWatchdog] Failed querying mkt_watchdog_rules: ${rulesError.message}`);
  }

  if (adsError) {
    throw new Error(`[MetaWatchdog] Failed querying v_mkt_ad_attribution: ${adsError.message}`);
  }

  const rules = (activeRules || []) as MktWatchdogRuleRow[];
  const ads = (activeAds || []) as MktAdAttributionViewRow[];

  if (rules.length === 0 || ads.length === 0) {
    return {
      evaluatedAdsCount: ads.length,
      activeRulesCount: rules.length,
      decisionsCount: 0,
      decisions: [],
    };
  }

  // 2. Query `mkt_attribution_ledger` for `PENDING` deals updated or created within the last 48 hours
  const cutoff48hIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: recentPendingRows } = await supabase
    .from('mkt_attribution_ledger')
    .select('source_ad_id, deal_value, updated_at, first_inquiry_at')
    .eq('crm_stage', 'PENDING')
    .gte('updated_at', cutoff48hIso)
    .not('source_ad_id', 'is', null);

  const pending48hValueByAdId = new Map<string, number>();
  for (const row of recentPendingRows || []) {
    const adId = String(row.source_ad_id);
    const val = Number(row.deal_value ?? 0);
    pending48hValueByAdId.set(adId, (pending48hValueByAdId.get(adId) || 0) + val);
  }

  const decisions: WatchdogEvaluationDecision[] = [];
  const pausedAdIdsInRun = new Set<string>();

  for (const ad of ads) {
    if (pausedAdIdsInRun.has(ad.ad_id)) {
      continue;
    }

    for (const rule of rules) {
      const { matched, reasonSummary } = doesAdMatchRule(ad, rule);
      if (!matched) {
        continue;
      }

      const pendingValueTotal = Number(ad.pending_pipeline_value || 0);
      const pendingValueLast48h = pending48hValueByAdId.get(ad.ad_id) ?? pendingValueTotal;
      const hasRecentPendingPipeline =
        pendingValueTotal > 0 && pendingValueLast48h > 0;

      // 3. Crucial Safeguard: Protect active PENDING pipeline in CRM (last 48 hours)
      if (
        rule.action_to_take === 'PAUSE_AD' &&
        rule.protect_pending_pipeline &&
        hasRecentPendingPipeline
      ) {
        const skipReason = `Skipped Pause: Active Pending Deals in CRM (₱${pendingValueTotal.toLocaleString(
          'en-PH',
          { minimumFractionDigits: 2 }
        )} pending pipeline in last 48h). ${reasonSummary}`;

        await supabase.from('mkt_automation_logs').insert({
          module: 'WATCHDOG',
          action_taken: 'SKIPPED_PAUSE_PIPELINE_PROTECTED',
          target_id: ad.ad_id,
          target_name: ad.ad_name,
          reason: 'Skipped Pause: Active Pending Deals in CRM',
          metadata: {
            rule_id: rule.id,
            rule_name: rule.rule_name,
            rule_type: rule.rule_type,
            pending_pipeline_value: pendingValueTotal,
            pending_48h_value: pendingValueLast48h,
            detail: skipReason,
          },
        });

        decisions.push({
          adId: ad.ad_id,
          adName: ad.ad_name,
          ruleId: rule.id,
          ruleName: rule.rule_name,
          ruleType: rule.rule_type,
          actionTaken: 'SKIPPED_PAUSE_PIPELINE_PROTECTED',
          reason: 'Skipped Pause: Active Pending Deals in CRM',
        });

        continue;
      }

      // 4. Execute rule action
      if (rule.action_to_take === 'PAUSE_AD') {
        try {
          await setAdStatus(ad.ad_id, 'PAUSED');
          pausedAdIdsInRun.add(ad.ad_id);

          await supabase.from('mkt_automation_logs').insert({
            module: 'WATCHDOG',
            action_taken: 'PAUSED_AD',
            target_id: ad.ad_id,
            target_name: ad.ad_name,
            reason: reasonSummary,
            metadata: {
              rule_id: rule.id,
              rule_name: rule.rule_name,
              rule_type: rule.rule_type,
              total_spend: ad.total_spend,
              total_dms: ad.total_dms,
              qualified_count: ad.qualified_count,
              true_roas: ad.true_roas,
            },
          });

          decisions.push({
            adId: ad.ad_id,
            adName: ad.ad_name,
            ruleId: rule.id,
            ruleName: rule.rule_name,
            ruleType: rule.rule_type,
            actionTaken: 'PAUSED_AD',
            reason: reasonSummary,
          });
          break; // Ad is now paused, stop evaluating further rules for this ad
        } catch (err) {
          const errMessage =
            err instanceof Error ? err.message : 'Failed pausing ad via Meta API';
          await supabase.from('mkt_automation_logs').insert({
            module: 'WATCHDOG',
            action_taken: 'PAUSE_AD_FAILED',
            target_id: ad.ad_id,
            target_name: ad.ad_name,
            reason: `${reasonSummary} — Error: ${errMessage}`,
            metadata: { rule_id: rule.id, error: errMessage },
          });
        }
      } else if (rule.action_to_take === 'INCREASE_BUDGET_20_PCT') {
        let actionTakenLabel = 'SCALED_ADSET_BUDGET_20_PCT';
        let finalReason = reasonSummary;

        if (ad.adset_id) {
          try {
            const budgetUpdate = await increaseAdSetDailyBudgetBy20Pct(ad.adset_id);
            finalReason = `${reasonSummary} Increased AdSet (${ad.adset_id}) daily budget by +20% (${budgetUpdate.previousBudgetMinorUnits} -> ${budgetUpdate.newBudgetMinorUnits} minor units).`;
          } catch (budgetErr) {
            actionTakenLabel = 'SCALE_RECOMMENDED_ALERT';
            finalReason = `${reasonSummary} (Budget auto-bump fallback alert: ${
              budgetErr instanceof Error ? budgetErr.message : 'CBO enabled'
            })`;
          }
        } else {
          actionTakenLabel = 'SCALE_RECOMMENDED_ALERT';
        }

        await supabase.from('mkt_automation_logs').insert({
          module: 'WATCHDOG',
          action_taken: actionTakenLabel,
          target_id: ad.ad_id,
          target_name: ad.ad_name,
          reason: finalReason,
          metadata: {
            rule_id: rule.id,
            rule_name: rule.rule_name,
            rule_type: rule.rule_type,
            adset_id: ad.adset_id,
            true_roas: ad.true_roas,
            closed_revenue: ad.closed_revenue,
          },
        });

        decisions.push({
          adId: ad.ad_id,
          adName: ad.ad_name,
          ruleId: rule.id,
          ruleName: rule.rule_name,
          ruleType: rule.rule_type,
          actionTaken: actionTakenLabel,
          reason: finalReason,
        });
      } else {
        // ALERT_ONLY
        await supabase.from('mkt_automation_logs').insert({
          module: 'WATCHDOG',
          action_taken: 'WATCHDOG_ALERT',
          target_id: ad.ad_id,
          target_name: ad.ad_name,
          reason: reasonSummary,
          metadata: {
            rule_id: rule.id,
            rule_name: rule.rule_name,
            rule_type: rule.rule_type,
          },
        });

        decisions.push({
          adId: ad.ad_id,
          adName: ad.ad_name,
          ruleId: rule.id,
          ruleName: rule.rule_name,
          ruleType: rule.rule_type,
          actionTaken: 'WATCHDOG_ALERT',
          reason: reasonSummary,
        });
      }
    }
  }

  return {
    evaluatedAdsCount: ads.length,
    activeRulesCount: rules.length,
    decisionsCount: decisions.length,
    decisions,
  };
}

