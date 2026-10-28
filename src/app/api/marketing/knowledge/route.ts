import { NextRequest, NextResponse } from 'next/server';
import {
  generateKnowledgeBotReply,
  generateWeeklyContentCalendar,
  getOrCreateBusinessKnowledge,
  saveBusinessKnowledge,
  syncBusinessProfileFromMetaPage,
} from '@/lib/meta-engine/meta-knowledge';
import type { MktBusinessKnowledgeRow } from '@/lib/meta-engine/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const knowledge = await getOrCreateBusinessKnowledge();
    return NextResponse.json({
      success: true,
      knowledge,
    });
  } catch (error) {
    console.error('[KnowledgeAPI] GET error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed loading Business Knowledge Base.',
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<MktBusinessKnowledgeRow>;
    const knowledge = await saveBusinessKnowledge(body);
    return NextResponse.json({
      success: true,
      knowledge,
    });
  } catch (error) {
    console.error('[KnowledgeAPI] PUT error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed saving Business Knowledge Base.',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as
      | {
          action: 'SYNC_FROM_META_PAGE';
        }
      | {
          action: 'GENERATE_BOT_REPLY';
          customerName: string;
          customerMessage: string;
          channel?: 'DM' | 'COMMENT_PUBLIC' | 'COMMENT_PRIVATE_DM';
          recentMessages?: Array<{ sender: string; text: string }>;
        }
      | {
          action: 'GENERATE_WEEKLY_CALENDAR';
          topic?: string;
          promoFocus?: string;
        };

    if (body.action === 'SYNC_FROM_META_PAGE') {
      const knowledge = await syncBusinessProfileFromMetaPage();
      return NextResponse.json({
        success: true,
        knowledge,
      });
    }

    if (body.action === 'GENERATE_BOT_REPLY') {
      const result = await generateKnowledgeBotReply({
        customerName: body.customerName || 'Customer',
        customerMessage: body.customerMessage || '',
        channel: body.channel || 'DM',
        recentMessages: body.recentMessages || [],
      });
      return NextResponse.json({
        success: true,
        ...result,
      });
    }

    if (body.action === 'GENERATE_WEEKLY_CALENDAR') {
      const calendar = await generateWeeklyContentCalendar(
        body.topic || body.promoFocus
      );
      return NextResponse.json({
        success: true,
        calendar,
        posts: calendar,
      });
    }

    return NextResponse.json(
      { error: 'Unsupported action in /api/marketing/knowledge.' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[KnowledgeAPI] POST error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed executing Knowledge Base action.',
      },
      { status: 500 }
    );
  }
}
