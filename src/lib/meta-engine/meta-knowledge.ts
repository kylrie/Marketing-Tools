import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { getActivePageContext } from './meta-pages';
import type {
  MktBusinessKnowledgeRow,
  MktToneOfVoice,
  MktWeeklyCalendarPostPlan,
} from './types';

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * Pulls live Page profile info (`name`, `about`, `description`, `category`, `phone`, `website`, `emails`, `single_line_address`)
 * from Meta Graph API (`GET /v21.0/${pageId}`) and merges it into `mkt_business_knowledge`.
 */
export async function syncBusinessProfileFromMetaPage(
  overridePageId?: string | null
): Promise<MktBusinessKnowledgeRow> {
  const supabase = getSupabaseAdmin();
  const pageCtx = await getActivePageContext(overridePageId);
  const pageId = pageCtx.pageId;
  const pageToken = pageCtx.pageAccessToken;

  const { data: existing } = await supabase
    .from('mkt_business_knowledge')
    .select('*')
    .eq('page_id', pageId)
    .maybeSingle<MktBusinessKnowledgeRow>();

  let metaName = existing?.business_name || pageCtx.pageName || 'Official Page';
  let metaCategory = existing?.category || pageCtx.category || '';
  let metaAbout = existing?.about_description || '';
  let metaContact = existing?.contact_info || '';
  let metaLocation = existing?.location_and_hours || '';

  try {
    const url = new URL(`${GRAPH_BASE_URL}/${encodeURIComponent(pageId)}`);
    url.searchParams.set(
      'fields',
      'id,name,about,description,category,phone,website,emails,single_line_address'
    );
    url.searchParams.set('access_token', pageToken);

    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (res.ok) {
      const data = (await res.json()) as {
        name?: string;
        about?: string;
        description?: string;
        category?: string;
        phone?: string;
        website?: string;
        emails?: string[];
        single_line_address?: string;
      };

      if (data.name) metaName = data.name;
      if (data.category) metaCategory = data.category;

      const combinedAbout = [data.about, data.description]
        .filter(Boolean)
        .join('\n\n')
        .trim();
      if (combinedAbout) {
        metaAbout = combinedAbout;
      }

      const contactParts: string[] = [];
      if (data.website) contactParts.push(`Website: ${data.website}`);
      if (Array.isArray(data.emails) && data.emails.length > 0) {
        contactParts.push(`Email: ${data.emails.join(', ')}`);
      }
      if (data.phone) contactParts.push(`Phone: ${data.phone}`);
      if (contactParts.length > 0) {
        metaContact = contactParts.join(' | ');
      }

      if (data.single_line_address && !metaLocation) {
        metaLocation = `Address: ${data.single_line_address}`;
      }
    }
  } catch (err) {
    console.warn('[MetaKnowledge] Warning syncing Page profile from Graph API:', err);
  }

  const nowIso = new Date().toISOString();

  const payload = {
    page_id: pageId,
    business_name: metaName,
    category: metaCategory,
    about_description:
      metaAbout ||
      `${metaName} official page. Message us anytime for promos, rates, and availability.`,
    pricing_and_packages:
      existing?.pricing_and_packages ||
      '• Starter / Solo Package: ₱999 (All-in access + priority support)\n• Group / Bundle Promo: ₱2,499 (Best Seller — save 25%)\n• Custom VIP / Event Package: Message us your preferred date & headcount for an exact quote.',
    faqs_and_policies:
      existing?.faqs_and_policies ||
      'Q: Do you have available slots this weekend?\nA: Yes! Weekend slots are open, but we recommend reserving early before slots fill up.\nQ: Can we reschedule our booking?\nA: Yes, rescheduling is free up to 24 hours before your reserved schedule.',
    booking_and_payment_info:
      existing?.booking_and_payment_info ||
      'To lock in your promo slot, simply reply with your preferred package, target date/time, and contact number. We accept GCash, Maya, and Bank Transfer.',
    location_and_hours:
      metaLocation ||
      'Open Daily: 10:00 AM – 10:00 PM (Online inquiries answered 24/7)',
    contact_info: metaContact || 'Message us directly here on Facebook Messenger',
    tone_of_voice: (existing?.tone_of_voice || 'TAGLISH') as MktToneOfVoice,
    auto_reply_dms: existing?.auto_reply_dms ?? true,
    auto_reply_comments: existing?.auto_reply_comments ?? true,
    auto_qualify_leads: existing?.auto_qualify_leads ?? true,
    updated_at: nowIso,
  };

  if (existing?.id) {
    const { data: updated, error } = await supabase
      .from('mkt_business_knowledge')
      .update(payload)
      .eq('id', existing.id)
      .select('*')
      .single<MktBusinessKnowledgeRow>();

    if (error || !updated) {
      return { id: existing.id, ...payload };
    }
    return updated;
  }

  const { data: created, error } = await supabase
    .from('mkt_business_knowledge')
    .insert({
      ...payload,
      created_at: nowIso,
    })
    .select('*')
    .single<MktBusinessKnowledgeRow>();

  if (error || !created) {
    return { id: 'default-knowledge', ...payload };
  }
  return created;
}

/**
 * Returns the current Business Knowledge Base for the active Page (or `overridePageId`), auto-syncing from the Page on first run.
 */
export async function getOrCreateBusinessKnowledge(
  overridePageId?: string | null
): Promise<MktBusinessKnowledgeRow> {
  const supabase = getSupabaseAdmin();
  const pageCtx = await getActivePageContext(overridePageId);
  const pageId = pageCtx.pageId;

  const { data: existing } = await supabase
    .from('mkt_business_knowledge')
    .select('*')
    .eq('page_id', pageId)
    .maybeSingle<MktBusinessKnowledgeRow>();

  if (existing) {
    return existing;
  }

  return await syncBusinessProfileFromMetaPage(pageId);
}

/**
 * Saves user edits to `mkt_business_knowledge`.
 */
export async function saveBusinessKnowledge(
  updates: Partial<MktBusinessKnowledgeRow>,
  overridePageId?: string | null
): Promise<MktBusinessKnowledgeRow> {
  const supabase = getSupabaseAdmin();
  const current = await getOrCreateBusinessKnowledge(
    overridePageId || updates.page_id
  );
  const nowIso = new Date().toISOString();

  const merged = {
    page_id: current.page_id,
    business_name: updates.business_name ?? current.business_name,
    category: updates.category ?? current.category,
    about_description: updates.about_description ?? current.about_description,
    pricing_and_packages:
      updates.pricing_and_packages ?? current.pricing_and_packages,
    faqs_and_policies: updates.faqs_and_policies ?? current.faqs_and_policies,
    booking_and_payment_info:
      updates.booking_and_payment_info ?? current.booking_and_payment_info,
    location_and_hours: updates.location_and_hours ?? current.location_and_hours,
    contact_info: updates.contact_info ?? current.contact_info,
    tone_of_voice: (updates.tone_of_voice ?? current.tone_of_voice) as MktToneOfVoice,
    auto_reply_dms:
      updates.auto_reply_dms !== undefined
        ? Boolean(updates.auto_reply_dms)
        : current.auto_reply_dms,
    auto_reply_comments:
      updates.auto_reply_comments !== undefined
        ? Boolean(updates.auto_reply_comments)
        : current.auto_reply_comments,
    auto_qualify_leads:
      updates.auto_qualify_leads !== undefined
        ? Boolean(updates.auto_qualify_leads)
        : current.auto_qualify_leads,
    updated_at: nowIso,
  };

  const { data: saved, error } = await supabase
    .from('mkt_business_knowledge')
    .update(merged)
    .eq('id', current.id)
    .select('*')
    .single<MktBusinessKnowledgeRow>();

  if (error || !saved) {
    return { ...current, ...merged };
  }
  return saved;
}

/**
 * Generates an accurate, knowledge-grounded reply for a customer DM or Post Comment
 * using the Business Profile & Knowledge Base (`mkt_business_knowledge`).
 */
export async function generateKnowledgeBotReply({
  customerName,
  customerMessage,
  channel = 'DM',
  recentMessages = [],
  pageId,
}: {
  customerName: string;
  customerMessage: string;
  channel?: 'DM' | 'COMMENT_PUBLIC' | 'COMMENT_PRIVATE_DM';
  recentMessages?: Array<{ sender: string; text: string }>;
  pageId?: string | null;
}): Promise<{
  replyText: string;
  matchedTopic: string;
  shouldQualifyLead: boolean;
}> {
  const kb = await getOrCreateBusinessKnowledge(pageId);
  const cleanName = customerName?.trim() || 'there';
  const msgLower = (customerMessage || '').toLowerCase().trim();

  // Detect high-intent buying / booking signals
  const shouldQualifyLead =
    /\b(book|reserve|order|avail|buy|kuha|kunin|gcash|maya|pay|payment|slot|saturday|sunday|tomorrow|today|package|bundle|confirm)\b/i.test(
      msgLower
    );

  // If GEMINI_API_KEY is configured, use Gemini 2.5 Flash grounded on the Knowledge Base
  const geminiKey =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (geminiKey) {
    try {
      const historyContext =
        recentMessages.length > 0
          ? recentMessages.map((m) => `${m.sender}: ${m.text}`).join('\n')
          : 'No prior messages.';

      const prompt = `You are the AI Sales & Customer Support Assistant for "${kb.business_name}" (${kb.category}).
Tone of voice: ${kb.tone_of_voice}.
Channel: ${channel} (${
        channel === 'COMMENT_PUBLIC'
          ? 'Keep public comment reply under 2 short sentences telling them you also sent full details to their Messenger DMs'
          : 'Direct Messenger / IG DM reply — helpful, concise, and ends with a clear closing question'
      }).

=== BUSINESS PROFILE & KNOWLEDGE BASE ===
About: ${kb.about_description}
Pricing & Packages:
${kb.pricing_and_packages}
Booking & Payment Info:
${kb.booking_and_payment_info}
FAQs & Policies:
${kb.faqs_and_policies}
Location & Hours:
${kb.location_and_hours}
Contact Info:
${kb.contact_info}

=== RECENT CONVERSATION ===
${historyContext}

Customer Name: ${cleanName}
Customer Latest Message: "${customerMessage}"

Write ONLY the exact reply text to send to ${cleanName}.`;

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
        geminiKey
      )}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 350 },
        }),
        cache: 'no-store',
      });
      if (res.ok) {
        const data = (await res.json()) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
        };
        const text =
          data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        if (text) {
          return {
            replyText: text,
            matchedTopic: 'AI_KNOWLEDGE_GEMINI',
            shouldQualifyLead,
          };
        }
      }
    } catch (err) {
      console.warn('[MetaKnowledge] Gemini fallback to deterministic KB engine:', err);
    }
  }

  // Deterministic Knowledge Base Answer Engine (works 100% offline/without GEMINI_API_KEY)
  if (channel === 'COMMENT_PUBLIC') {
    const publicReply =
      kb.tone_of_voice === 'TAGLISH'
        ? `Hi ${cleanName}! 👋 Nag-send na po kami ng full rates & promo details ng ${kb.business_name} sa Messenger inbox mo. Pa-check po ng DMs! 💬✨`
        : `Hi ${cleanName}! 👋 We just sent the complete ${kb.business_name} rates and package details straight to your Messenger inbox. Please check your DMs! 💬`;

    return {
      replyText: publicReply,
      matchedTopic: 'COMMENT_PUBLIC_SHIELD',
      shouldQualifyLead,
    };
  }

  // 1. Check if customer asked about Booking / Reserving / Payment
  if (
    /\b(book|reserve|reservation|order|avail|pay|payment|gcash|maya|bank|lock|slot)\b/i.test(
      msgLower
    )
  ) {
    const replyText =
      kb.tone_of_voice === 'TAGLISH'
        ? `Hi ${cleanName}! 🙌 Here’s how to book with ${kb.business_name}:\n\n${kb.booking_and_payment_info}\n\n📋 Available Packages:\n${kb.pricing_and_packages}\n\nAling package at anong date/time po ang i-re-reserve natin para sa inyo? ✅`
        : `Hi ${cleanName}! 🙌 Here is how to reserve your slot with ${kb.business_name}:\n\n${kb.booking_and_payment_info}\n\n📋 Packages & Rates:\n${kb.pricing_and_packages}\n\nWhich package and date/time would you like us to lock in for you? ✅`;

    return {
      replyText,
      matchedTopic: 'BOOKING_AND_PAYMENT',
      shouldQualifyLead: true,
    };
  }

  // 2. Check if customer asked about Location / Hours / Schedule
  if (
    /\b(where|location|address|located|san|saan|hours|open|close|oras|schedule|branch)\b/i.test(
      msgLower
    )
  ) {
    const replyText =
      kb.tone_of_voice === 'TAGLISH'
        ? `Hi ${cleanName}! 📍 Narito po ang schedule & location details ng ${kb.business_name}:\n\n${kb.location_and_hours}\n${kb.contact_info}\n\nGusto niyo rin po bang makita ang current promo packages namin? 😊`
        : `Hi ${cleanName}! 📍 Here are the location and operating hours for ${kb.business_name}:\n\n${kb.location_and_hours}\n${kb.contact_info}\n\nWould you also like me to send our current promo packages? 😊`;

    return {
      replyText,
      matchedTopic: 'LOCATION_AND_HOURS',
      shouldQualifyLead,
    };
  }

  // 3. Check if customer asked about Pricing / How Much / Packages (or COMMENT_PRIVATE_DM)
  if (
    channel === 'COMMENT_PRIVATE_DM' ||
    /\b(hm|how much|how|price|pricing|rate|rates|magkano|package|packages|promo|cost|details|interested|pm)\b/i.test(
      msgLower
    )
  ) {
    const replyText =
      kb.tone_of_voice === 'TAGLISH'
        ? `Hi ${cleanName}! 👋 Thanks sa pag-message sa ${kb.business_name}! Narito po ang aming current Promo Rates & Packages:\n\n${kb.pricing_and_packages}\n\n💡 Paano mag-avail:\n${kb.booking_and_payment_info}\n\nAlin po dito ang pinaka-bet niyo para ma-check namin ang slot availability? 💬`
        : `Hi ${cleanName}! 👋 Thanks for reaching out to ${kb.business_name}! Here are our current Promo Rates & Packages:\n\n${kb.pricing_and_packages}\n\n💡 How to Book:\n${kb.booking_and_payment_info}\n\nWhich package fits your needs best so we can check availability for you? 💬`;

    return {
      replyText,
      matchedTopic: 'PRICING_AND_PACKAGES',
      shouldQualifyLead,
    };
  }

  // 4. General / About / FAQ fallback using full business profile
  const replyText =
    kb.tone_of_voice === 'TAGLISH'
      ? `Hi ${cleanName}! 👋 Welcome sa ${kb.business_name} (${kb.category || 'Official Page'}).\n\n${kb.about_description}\n\n✨ Current Packages & Promos:\n${kb.pricing_and_packages}\n\nPaano po kami makakatulong sa inyo today—gusto niyo po bang mag-inquire sa rates o mag-reserve ng slot? 😊`
      : `Hi ${cleanName}! 👋 Welcome to ${kb.business_name} (${kb.category || 'Official Page'}).\n\n${kb.about_description}\n\n✨ Current Packages & Promos:\n${kb.pricing_and_packages}\n\nHow can we help you today—would you like to check package rates or reserve a slot? 😊`;

  return {
    replyText,
    matchedTopic: 'BUSINESS_PROFILE_OVERVIEW',
    shouldQualifyLead,
  };
}

/**
 * Generates a 7-Day Social Media Content Calendar grounded on the Business Knowledge Base.
 */
export async function generateWeeklyContentCalendar(
  customFocusTopic?: string,
  overridePageId?: string | null
): Promise<MktWeeklyCalendarPostPlan[]> {
  const kb = await getOrCreateBusinessKnowledge(overridePageId);
  const focus =
    customFocusTopic?.trim() ||
    `${kb.business_name} Special Promo & Packages`;

  const days: MktWeeklyCalendarPostPlan[] = [
    {
      dayNumber: 1,
      dayName: 'Monday',
      theme: 'Problem / Pain Hook',
      recommendedTime: '12:00 PM',
      headline: `Looking for the Best ${kb.category || 'Offer'}?`,
      promoBadge: 'MONDAY SPECIAL • COMMENT "HOW"',
      caption: `Pagod ka na ba maghanap ng sulit at subok na ${kb.category || 'package'}? 👀✨\n\nSa ${kb.business_name}, ginawa naming hassle-free para sa'yo!\n\n${kb.about_description}\n\n👇 Comment "HOW" or "HM" sa baba at i-se-send ng AI assistant namin ang full promo rates sa Messenger mo agad! 💬`,
    },
    {
      dayNumber: 2,
      dayName: 'Tuesday',
      theme: 'Full Promo & Package Breakdown',
      recommendedTime: '6:30 PM',
      headline: `${focus} — Open Today!`,
      promoBadge: 'LIMITED PROMO RATES • SAVE 25%',
      caption: `🔥 ${focus.toUpperCase()} UPDATE! 🔥\n\nNarito ang aming pinaka-sulit na packages sa ${kb.business_name}:\n\n${kb.pricing_and_packages}\n\n👇 Comment "HOW MUCH" or "DETAILS" below para ma-receive mo sa DM ang exact promo breakdown! 📩`,
    },
    {
      dayNumber: 3,
      dayName: 'Wednesday',
      theme: 'FAQ & Objection Buster',
      recommendedTime: '12:30 PM',
      headline: `Top Questions Answered — ${kb.business_name}`,
      promoBadge: 'FAST BOOKING • INSTANT DM',
      caption: `Maraming nagtatanong sa amin tungkol sa ${focus}! 💡\n\n${kb.faqs_and_policies}\n\n📍 ${kb.location_and_hours}\n\nMay tanong ka pa ba? Comment "HOW" sa baba o mag-message lang diretso sa Page namin! 👇💬`,
    },
    {
      dayNumber: 4,
      dayName: 'Thursday',
      theme: 'How to Book / Step-by-Step Guide',
      recommendedTime: '7:00 PM',
      headline: `Lock In Your Slot in 60 Seconds`,
      promoBadge: 'EASY RESERVATION • GCASH / MAYA',
      caption: `Paano mag-avail o mag-reserve sa ${kb.business_name}? Super dali lang! ✅\n\n${kb.booking_and_payment_info}\n\n👇 Comment "INTERESTED" or "PM" sa baba para ma-assist ka namin agad sa Messenger! 🚀`,
    },
    {
      dayNumber: 5,
      dayName: 'Friday',
      theme: 'Weekend Slot Urgency Alert',
      recommendedTime: '5:30 PM',
      headline: `Weekend Promo Slots Almost Full!`,
      promoBadge: 'WEEKEND RUSH • LIMITED SLOTS',
      caption: `⚠️ WEEKEND ALERT sa ${kb.business_name}! ⚠️\n\nKonti na lang ang available slots para sa ${focus} ngayong weekend!\n\n${kb.pricing_and_packages}\n\n👇 Comment "AVAILABLE" or "HOW" ngayon bago maubusan ng slot! 🔥💬`,
    },
    {
      dayNumber: 6,
      dayName: 'Saturday',
      theme: 'Weekend Bundle Spotlight',
      recommendedTime: '11:00 AM',
      headline: `Saturday Best-Seller Bundle`,
      promoBadge: 'BEST SELLER • MESSAGE US NOW',
      caption: `Happy Weekend! 🎉 Kung naghahanap ka ng pinaka-sulit na deal today sa ${kb.business_name}, ito na ang sign mo!\n\n${kb.pricing_and_packages}\n\n👇 Comment "PRICE" sa baba at i-DM namin sa'yo ang weekend voucher! ✨`,
    },
    {
      dayNumber: 7,
      dayName: 'Sunday',
      theme: 'Early-Bird Next Week Reservation',
      recommendedTime: '7:30 PM',
      headline: `Early-Bird Promo for Next Week`,
      promoBadge: 'EARLY BIRD • PRIORITY SLOTS',
      caption: `Planning ahead for next week? 📅 Mag-early reservation na sa ${kb.business_name} para makuha mo ang priority promo rate!\n\n${kb.booking_and_payment_info}\n\n👇 Comment "HOW" below to claim your Early-Bird rate via Messenger! 💬`,
    },
  ];

  return days;
}
