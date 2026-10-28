import { NextRequest, NextResponse } from 'next/server';
import {
  fetchPublishedPagePosts,
  publishPagePost,
  replyOrModeratePostComment,
} from '@/lib/meta-engine/meta-inbox-posts';
import { syncRecentPageComments } from '@/lib/meta-engine/meta-comments';

export const dynamic = 'force-dynamic';

/**
 * GET /api/marketing/posts
 * Fetches published organic Facebook Page & Instagram posts and runs Comment-to-DM Shield on any new comments.
 */
export async function GET() {
  try {
    await syncRecentPageComments();
    const posts = await fetchPublishedPagePosts();
    return NextResponse.json({
      success: true,
      pageId: process.env.META_PAGE_ID || '',
      posts,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[PostsAPI] GET error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed fetching Page posts.',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/marketing/posts
 * Publishes a new organic post (`TEXT`, `IMAGE`, or `VIDEO`) to the Facebook Page (`META_PAGE_ID`).
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      platform?: 'FACEBOOK' | 'INSTAGRAM';
      mediaType?: 'TEXT' | 'IMAGE' | 'VIDEO';
      message: string;
      mediaUrl?: string | null;
      scheduledFor?: string | null;
    };

    const message = body.message?.trim();
    if (!message) {
      return NextResponse.json(
        { error: 'Post caption / message is required.' },
        { status: 400 }
      );
    }

    const result = await publishPagePost({
      platform: body.platform || 'FACEBOOK',
      mediaType: body.mediaType || 'TEXT',
      message,
      mediaUrl: body.mediaUrl || null,
      scheduledFor: body.scheduledFor || null,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('[PostsAPI] POST error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed publishing social post.',
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/marketing/posts
 * Replies publicly to a post comment, sends a Private DM to a commenter, or hides/unhides a comment.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      commentId: string;
      action: 'REPLY_PUBLIC' | 'SEND_PRIVATE_DM' | 'TOGGLE_HIDE';
      replyText?: string;
      isHidden?: boolean;
    };

    if (!body.commentId || !body.action) {
      return NextResponse.json(
        { error: 'commentId and action are required.' },
        { status: 400 }
      );
    }

    const result = await replyOrModeratePostComment({
      commentId: body.commentId,
      action: body.action,
      replyText: body.replyText,
      isHidden: body.isHidden,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[PostsAPI] PATCH comment action error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed executing comment action.',
      },
      { status: 500 }
    );
  }
}


