import { NextRequest, NextResponse } from 'next/server';
import type { MktCopyGenerationOutput } from '@/lib/meta-engine/types';

export const dynamic = 'force-dynamic';

interface GenerateCopyRequestBody {
  offerDescription: string;
  brandName?: string;
  targetAudience?: string;
  pricePoint?: string;
}

/**
 * POST /api/marketing/generate-copy
 * Uses Gemini (`gemini-2.5-flash`) to generate 3 distinct Click-to-Message Primary Text hooks
 * (`Direct Promo Offer`, `Problem/Agitate/Solve`, `Taglish Conversational Hook`)
 * plus 3 short Headlines optimized for Messenger & Instagram DM clicks.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as GenerateCopyRequestBody;
    const offerDescription = body.offerDescription?.trim();

    if (!offerDescription) {
      return NextResponse.json(
        { error: 'Please provide an offerDescription to generate ad copy.' },
        { status: 400 }
      );
    }

    const brandName = body.brandName?.trim() || 'Our Brand';
    const targetAudience =
      body.targetAudience?.trim() || 'Philippine social media shoppers & decision-makers';
    const pricePoint = body.pricePoint?.trim() || '';

    const apiKey =
      process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            'Missing GEMINI_API_KEY environment variable. Configure GEMINI_API_KEY to generate AI copy hooks.',
        },
        { status: 500 }
      );
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
      const errText = await response.text().catch(() => '');
      throw new Error(
        `Gemini API request failed (${response.status}): ${errText || response.statusText}`
      );
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
