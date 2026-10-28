import { NextRequest, NextResponse } from 'next/server';
import {
  autoDiscoverPagesFromMeta,
  connectOrUpdateMetaPage,
  getActivePageContext,
  getConnectedPages,
  removeConnectedPage,
  switchActivePage,
} from '@/lib/meta-engine/meta-pages';
import { syncBusinessProfileFromMetaPage } from '@/lib/meta-engine/meta-knowledge';

export const dynamic = 'force-dynamic';

/**
 * GET /api/marketing/pages
 * Lists all connected Facebook Pages and the currently active Page context.
 */
export async function GET() {
  try {
    const [pages, activePage] = await Promise.all([
      getConnectedPages(),
      getActivePageContext(),
    ]);

    return NextResponse.json({
      success: true,
      pages,
      activePage,
    });
  } catch (error) {
    console.error('[PagesAPI] GET error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed loading connected Facebook Pages.',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/marketing/pages
 * Actions:
 * - `SWITCH_ACTIVE_PAGE` (`pageId`)
 * - `ADD_PAGE` (`pageId`, `accessToken`, `pageName?`, `adAccountId?`, `igBusinessAccountId?`)
 * - `AUTO_DISCOVER_PAGES` (`userAccessToken?`)
 * - `DELETE_PAGE` (`pageId`)
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as
      | {
          action: 'SWITCH_ACTIVE_PAGE';
          pageId: string;
        }
      | {
          action: 'ADD_PAGE';
          pageId: string;
          accessToken: string;
          pageName?: string;
          adAccountId?: string;
          igBusinessAccountId?: string;
        }
      | {
          action: 'AUTO_DISCOVER_PAGES';
          userAccessToken?: string;
        }
      | {
          action: 'DELETE_PAGE';
          pageId: string;
        };

    if (body.action === 'SWITCH_ACTIVE_PAGE') {
      const pages = await switchActivePage(body.pageId);
      const activePage = await getActivePageContext();
      return NextResponse.json({
        success: true,
        pages,
        activePage,
      });
    }

    if (body.action === 'ADD_PAGE') {
      const added = await connectOrUpdateMetaPage({
        pageId: body.pageId,
        accessToken: body.accessToken,
        pageName: body.pageName,
        adAccountId: body.adAccountId,
        igBusinessAccountId: body.igBusinessAccountId,
        setActive: true,
      });

      // Automatically sync the new Page's profile into its own `mkt_business_knowledge` row
      await syncBusinessProfileFromMetaPage(added.page_id).catch(() => {});

      const [pages, activePage] = await Promise.all([
        getConnectedPages(),
        getActivePageContext(),
      ]);

      return NextResponse.json({
        success: true,
        addedPage: added,
        pages,
        activePage,
      });
    }

    if (body.action === 'AUTO_DISCOVER_PAGES') {
      const result = await autoDiscoverPagesFromMeta(body.userAccessToken);
      for (const p of result.pages) {
        await syncBusinessProfileFromMetaPage(p.page_id).catch(() => {});
      }
      const activePage = await getActivePageContext();
      return NextResponse.json({
        success: true,
        discoveredCount: result.discoveredCount,
        pages: result.pages,
        activePage,
      });
    }

    if (body.action === 'DELETE_PAGE') {
      const pages = await removeConnectedPage(body.pageId);
      const activePage = await getActivePageContext();
      return NextResponse.json({
        success: true,
        pages,
        activePage,
      });
    }

    return NextResponse.json(
      { error: 'Unsupported action in /api/marketing/pages.' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[PagesAPI] POST error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed executing Multi-Page action.',
      },
      { status: 500 }
    );
  }
}

