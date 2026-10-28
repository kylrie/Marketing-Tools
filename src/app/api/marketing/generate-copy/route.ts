import { NextRequest, NextResponse } from 'next/server';
import type {
  MktCopyGenerationOutput,
  MktGeneratedCopyHook,
} from '@/lib/meta-engine/types';

export const dynamic = 'force-dynamic';

interface GenerateCopyRequestBody {
  offerDescription: string;
  brandName?: string;
  targetAudience?: string;
  pricePoint?: string;
}

function buildStructuredCopyFromInput(
  offerDescription: string,
  brandName = 'Our Team',
  pricePoint = ''
): MktCopyGenerationOutput {
  const cleanOffer = offerDescription.trim();
  const priceTag = pricePoint.trim() || 'Special Promo Rate';

  const hooks: MktGeneratedCopyHook[] = [
    {
      angle: 'DIRECT_PROMO_OFFER',
      label: 'Direct Promo Offer',
      primaryText: `🔥 ${cleanOffer}\n\nLock in our ${priceTag} today with priority assistance from ${brandName}.\n\n✅ Fast response via Messenger / Instagram DM\n✅ Clear pricing & package details\n\n👇 Tap "Send Message" below to inquire now!`,
    },
    {
      angle: 'PROBLEM_AGITATE_SOLVE',
      label: 'Problem / Agitate / Solve',
      primaryText: `Looking for a reliable offer without waiting days for a quote?\n\n${cleanOffer} — available now at ${priceTag}.\n\n💬 Tap "Send Message" below and our specialist will send the complete details straight to your inbox!`,
    },
    {
      angle: 'TAGLISH_CONVERSATIONAL_HOOK',
      label: 'Taglish Conversational Hook',
      primaryText: `Interested ka ba sa ${cleanOffer}? 👀✨\n\nMay available kaming ${priceTag} para sa mga mag-me-message today!\n\n👇 Click "Send Message" sa baba para ma-send namin agad ang full details sa inbox mo! 💬`,
    },
  ];

  const headlines: string[] = [
    'Tap Send Message for Instant Details 💬',
    `${priceTag} — Message Us Now! 🔥`,
    'Inquire in 1 Tap • Fast Reply ⚡',
  ];

  return { hooks, headlines };
}

/**
 * POST /api/marketing/generate-copy
 * Uses Gemini (`gemini-2.5-flash`) when `GEMINI_API_KEY` is configured,
 * or synthesizes 3 structured Click-to-Message copy hooks from the user's input offer.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as GenerateCopyRequestBody;
    const offerDescription = body.offerDescription?.trim();

    if (!offerDescription) {
      return NextResponse.json(
        { error: 'Please enter a Promo Offer Description first.' },
        { status: 400 }
      );
    }

    const brandName = body.brandName?.trim() || 'Our Brand';
    const targetAudience =
      body.targetAudience?.trim() || 'Philippine social media shoppers & decision-makers';
    const pricePoint = body.pricePoint?.trim() || '';

    const apiKey = (
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      ''
    ).trim();

    if (!apiKey) {
      const generated = buildStructuredCopyFromInput(
        offerDescription,
        brandName,
        pricePoint
      );
      return NextResponse.json({
        success: true,
        source: 'structured_generator',
        ...generated,
      });
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
      apiKey
    )}`;

    const systemPrompt = `You are a Principal Direct-Response Meta Ads Copywriter specializing in high-converting Click-to-Messenger and Click-to-Instagram DM ads in the Philippines.
Given a promo offer description, generate:
1. Exactly 3 distinct Primary Text hooks:
   - Angle 1 ("DIRECT_PROMO_OFFER" / label "Direct Promo Offer"): High-urgency, benefit-packed direct offer with clear value props and a strong call-to-action to tap "Send Message".
   - Angle 2 ("PROBLEM_AGITATE_SOLVE" / label "Problem / Agitate / Solve"): Hooks the reader with a relatable pain point, agitates the cost of waiting, and positions the offer + a quick DM consultation as the solution.
   - Angle 3 ("TAGLISH_CONVERSATIONAL_HOOK" / label "Taglish Conversational Hook"): Natural, warm, persuasive Manila Taglish (English + Tagalog) copy that feels native to Facebook/Instagram feeds and invites the user to message right away.
2. Exactly 3 short, high-CTR Headlines (max 55 characters each) optimized specifically to make users tap the "Send Message" button.

Return valid JSON matching this exact schema:
{
  "hooks": [
    {
      "angle": "DIRECT_PROMO_OFFER",
      "label": "Direct Promo Offer",
      "primaryText": "..."
    },
    {
      "angle": "PROBLEM_AGITATE_SOLVE",
      "label": "Problem / Agitate / Solve",
      "primaryText": "..."
    },
    {
      "angle": "TAGLISH_CONVERSATIONAL_HOOK",
      "label": "Taglish Conversational Hook",
      "primaryText": "..."
    }
  ],
  "headlines": [
    "Headline 1",
    "Headline 2",
    "Headline 3"
  ]
}`;

    const userPrompt = `Brand Name: ${brandName}
Target Audience: ${targetAudience}
Price / Promo Hook: ${pricePoint}
Promo Offer Description: ${offerDescription}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: 'application/json',
        },
      }),
      cache: 'no-store',
    });

    if (!response.ok) {
      const generated = buildStructuredCopyFromInput(
        offerDescription,
        brandName,
        pricePoint
      );
      return NextResponse.json({
        success: true,
        source: 'structured_generator',
        ...generated,
      });
    }

    const geminiData = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const rawJsonText =
      geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    const parsed = JSON.parse(rawJsonText) as MktCopyGenerationOutput;

    if (
      !Array.isArray(parsed.hooks) ||
      parsed.hooks.length === 0 ||
      !Array.isArray(parsed.headlines) ||
      parsed.headlines.length === 0
    ) {
      throw new Error('Gemini returned incomplete JSON structure.');
    }

    return NextResponse.json({
      success: true,
      source: 'gemini-2.5-flash',
      hooks: parsed.hooks,
      headlines: parsed.headlines,
    });
  } catch (error) {
    console.error('[GenerateCopyAPI] Error generating copy:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed generating Click-to-Message ad copy.',
      },
      { status: 500 }
    );
  }
}
