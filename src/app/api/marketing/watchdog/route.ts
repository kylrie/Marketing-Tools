import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { evaluateWatchdogRules } from '@/lib/meta-engine/meta-watchdog';
import { syncRecentPageComments } from '@/lib/meta-engine/meta-comments';
import type {
  MktAutomationLogRow,
  MktCommentRuleRow,
  MktWatchdogRuleRow,
} from '@/lib/meta-engine/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await syncRecentPageComments();
    const supabase = getSupabaseAdmin();

    const { data: watchdogRules, error: wdError } = await supabase
      .from('mkt_watchdog_rules')
      .select('*')
      .order('created_at', { ascending: true });

    if (wdError) {
      throw new Error(`[WatchdogAPI] Error loading mkt_watchdog_rules: ${wdError.message}`);
    }

    const { data: commentRule, error: cmError } = await supabase
      .from('mkt_comment_rules')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<MktCommentRuleRow>();

    if (cmError) {
      throw new Error(`[WatchdogAPI] Error loading mkt_comment_rules: ${cmError.message}`);
    }

    const { data: automationLogs, error: logsError } = await supabase
      .from('mkt_automation_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (logsError) {
      throw new Error(
        `[WatchdogAPI] Error loading mkt_automation_logs: ${logsError.message}`
      );
    }

    return NextResponse.json({
      watchdogRules: (watchdogRules || []) as MktWatchdogRuleRow[],
      commentRule: commentRule || null,
      automationLogs: (automationLogs || []) as MktAutomationLogRow[],
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[WatchdogAPI] GET error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed loading Watchdog & Comment Shield configuration.',
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      target:
        | 'WATCHDOG_RULE'
        | 'CREATE_WATCHDOG_RULE'
        | 'DELETE_WATCHDOG_RULE'
        | 'PIPELINE_PROTECTOR_ALL'
        | 'COMMENT_RULE';
      rule?: Partial<MktWatchdogRuleRow> & { id?: string };
      ruleId?: string;
      protect_pending_pipeline?: boolean;
      commentRule?: Partial<MktCommentRuleRow> & { id?: string };
    };

    const supabase = getSupabaseAdmin();

    if (body.target === 'CREATE_WATCHDOG_RULE' && body.rule) {
      const r = body.rule;
      const nowIso = new Date().toISOString();
      const { data: createdRule, error } = await supabase
        .from('mkt_watchdog_rules')
        .insert({
          rule_name: r.rule_name || 'Custom Stop-Loss Rule',
          rule_type: r.rule_type || 'BLEEDING_SPEND_STOPLOSS',
          is_active: r.is_active ?? true,
          min_spend_php: Number(r.min_spend_php ?? 1500),
          min_dms: Number(r.min_dms ?? 0),
          max_qualified_leads: Number(r.max_qualified_leads ?? 0),
          min_roas: Number(r.min_roas ?? 1.5),
          protect_pending_pipeline: Boolean(r.protect_pending_pipeline ?? true),
          action_to_take: r.action_to_take || 'PAUSE_AD',
          created_at: nowIso,
          updated_at: nowIso,
        })
        .select('*')
        .single<MktWatchdogRuleRow>();

      if (error) {
        throw new Error(`[WatchdogAPI] Failed creating rule: ${error.message}`);
      }

      return NextResponse.json({ success: true, watchdogRule: createdRule });
    }

    if (body.target === 'DELETE_WATCHDOG_RULE' && body.ruleId) {
      const { error } = await supabase
        .from('mkt_watchdog_rules')
        .delete()
        .eq('id', body.ruleId);

      if (error) {
        throw new Error(`[WatchdogAPI] Failed deleting rule: ${error.message}`);
      }

      return NextResponse.json({ success: true, deletedRuleId: body.ruleId });
    }

    if (body.target === 'WATCHDOG_RULE' && body.rule?.id) {
      const { id, ...fields } = body.rule;
      const { data: updatedRule, error } = await supabase
        .from('mkt_watchdog_rules')
        .update({
          rule_name: fields.rule_name,
          is_active: fields.is_active,
          min_spend_php: Number(fields.min_spend_php ?? 0),
          min_dms: Number(fields.min_dms ?? 0),
          max_qualified_leads: Number(fields.max_qualified_leads ?? 0),
          min_roas: Number(fields.min_roas ?? 0),
          protect_pending_pipeline: Boolean(fields.protect_pending_pipeline),
          action_to_take: fields.action_to_take,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*')
        .single<MktWatchdogRuleRow>();

      if (error) {
        throw new Error(`[WatchdogAPI] Failed updating rule: ${error.message}`);
      }

      return NextResponse.json({ success: true, watchdogRule: updatedRule });
    }

    if (body.target === 'PIPELINE_PROTECTOR_ALL') {
      const protect = Boolean(body.protect_pending_pipeline);
      const { data: updatedRules, error } = await supabase
        .from('mkt_watchdog_rules')
        .update({
          protect_pending_pipeline: protect,
          updated_at: new Date().toISOString(),
        })
        .neq('id', '00000000-0000-0000-0000-000000000000')
        .select('*');

      if (error) {
        throw new Error(
          `[WatchdogAPI] Failed updating pipeline protector safeguard: ${error.message}`
        );
      }

      return NextResponse.json({
        success: true,
        watchdogRules: updatedRules as MktWatchdogRuleRow[],
      });
    }

    if (body.target === 'COMMENT_RULE' && body.commentRule) {
      const cr = body.commentRule;
      if (cr.id) {
        const { data: updatedCommentRule, error } = await supabase
          .from('mkt_comment_rules')
          .update({
            trigger_keywords: cr.trigger_keywords || [],
            public_reply_templates: cr.public_reply_templates || [],
            private_dm_template: cr.private_dm_template || '',
            auto_hide_inquiry_comment: Boolean(cr.auto_hide_inquiry_comment),
            ai_moderation_enabled: Boolean(cr.ai_moderation_enabled),
            updated_at: new Date().toISOString(),
          })
          .eq('id', cr.id)
          .select('*')
          .single<MktCommentRuleRow>();

        if (error) {
          throw new Error(
            `[WatchdogAPI] Failed updating comment shield rule: ${error.message}`
          );
        }

        return NextResponse.json({
          success: true,
          commentRule: updatedCommentRule,
        });
      } else {
        const { data: createdCommentRule, error } = await supabase
          .from('mkt_comment_rules')
          .insert({
            rule_name: cr.rule_name || 'AI Comment-to-DM Shield',
            is_active: cr.is_active ?? true,
            trigger_keywords: cr.trigger_keywords || [],
            public_reply_templates: cr.public_reply_templates || [],
            private_dm_template: cr.private_dm_template || '',
            auto_hide_inquiry_comment: Boolean(cr.auto_hide_inquiry_comment),
            ai_moderation_enabled: Boolean(cr.ai_moderation_enabled),
          })
          .select('*')
          .single<MktCommentRuleRow>();

        if (error) {
          throw new Error(
            `[WatchdogAPI] Failed creating comment shield rule: ${error.message}`
          );
        }

        return NextResponse.json({
          success: true,
          commentRule: createdCommentRule,
        });
      }
    }

    return NextResponse.json(
      { error: 'Invalid update target payload.' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[WatchdogAPI] PUT error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed saving configuration.',
      },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const supabase = getSupabaseAdmin();
    await syncRecentPageComments();
    const evaluation = await evaluateWatchdogRules();

    const { data: latestLogs } = await supabase
      .from('mkt_automation_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    return NextResponse.json({
      success: true,
      evaluation,
      automationLogs: (latestLogs || []) as MktAutomationLogRow[],
    });
  } catch (error) {
    console.error('[WatchdogAPI] POST manual check error:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed running Watchdog evaluation.',
      },
      { status: 500 }
    );
  }
}
