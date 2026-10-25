import { getSupabaseAdmin } from '@/lib/supabase/admin';
import type {
  MktCommentIntentCategory,
  MktCommentRuleRow,
} from './types';

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v21.0';
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface NormalizedMetaCommentEvent {
  commentId: string;
  postId: string | null;
  senderId: string;
  senderName: string;
  messageText: string;
  platform: 'FACEBOOK' | 'INSTAGRAM';
}

export interface CommentShieldExecutionResult {
  commentId: string;
  senderName: string;
  messageText: string;
  classification: MktCommentIntentCategory | 'IGNORED_SELF_COMMENT';
  matchedKeyword: string | null;
  publicReplySent: boolean;
  privateDmSent: boolean;
  commentHidden: boolean;
  actionLogged: string;
}

const DEFAULT_COMMENT_RULE: MktCommentRuleRow = {
  id: 'default-comment-rule',
  rule_name: 'Default AI Comment-to-DM Shield',
  is_active: true,
  trigger_keywords: [
    'hm',
    'how much',
    'price',
    'details',
    'available',
    'magkano',
    'pm',
    'interested',
  ],
  public_reply_templates: [
    'Hi {name}! We just sent the full pricing and details straight to your Messenger inbox. Please check your DMs! 💬',
    'Hello {name}! Just messaged you the rates and current promo details—check your inbox! ✨',
    'Thanks for asking, {name}! Sent you a private message with the complete price list and availability. 📩',
  ],
  private_dm_template:
    'Hi {name}! 👋 Thanks for commenting on our post. Here are the details you requested—are you looking for personal use or business volume so our specialist can send the exact package quote?',
  auto_hide_inquiry_comment: true,
  ai_moderation_enabled: true,
};

function getPageAccessToken(): string {
  const token =
    process.env.META_PAGE_ACCESS_TOKEN ||
    process.env.META_ACCESS_TOKEN ||
    process.env.META_SYSTEM_USER_ACCESS_TOKEN;

  if (!token) {
    throw new Error(
      '[MetaComments] Missing META_PAGE_ACCESS_TOKEN, META_ACCESS_TOKEN, or META_SYSTEM_USER_ACCESS_TOKEN.'
    );
  }
  return token;
}

function interpolateTemplate(template: string, name: string): string {
  const cleanName = name?.trim() || 'there';
  return template.replace(/\{name\}/gi, cleanName);
}

/**
 * Checks if comment text matches any configured trigger keyword (case-insensitive).
 * Uses word-boundary matching for short keywords (<= 3 chars like 'hm', 'pm')
 * and substring matching for multi-word phrases ('how much').
 */
function findMatchingTriggerKeyword(
  commentText: string,
  triggerKeywords: string[]
): string | null {
  const normalizedText = commentText.toLowerCase().trim();
  if (!normalizedText) return null;

  for (const rawKeyword of triggerKeywords) {
    const keyword = rawKeyword.toLowerCase().trim();
    if (!keyword) continue;

    if (keyword.length <= 3 && !keyword.includes(' ')) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?:^|\\b|\\s)${escaped}(?:$|\\b|\\s|[?!.,])`, 'i');
      if (regex.test(normalizedText)) {
        return rawKeyword;
      }
    } else if (normalizedText.includes(keyword)) {
      return rawKeyword;
    }
  }

  return null;
}

/**
 * Uses Gemini (`gemini-2.5-flash`) to classify a comment into:
 * `'PRICE_INQUIRY'` | `'SPAM_OR_TROLL'` | `'SUPPORT_COMPLAINT'` | `'GENERAL_PRAISE'`.
 * Falls back to deterministic lexical rules if GEMINI_API_KEY is not set or on network timeout.
 */
export async function classifyCommentWithGemini(
  commentText: string
): Promise<MktCommentIntentCategory> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  if (apiKey) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
        apiKey
      )}`;

      const systemInstruction = `You are an expert e-commerce and social media ad moderation AI for a Philippine business running Meta Click-to-Messenger & Instagram ads (English, Tagalog, and Taglish).
Classify the user's comment into EXACTLY ONE of these 4 labels:
- PRICE_INQUIRY: Asking about price, cost, rates, availability, shipping, location, promo, how to order, or requesting a DM ("hm", "magkano", "pa-pm", "loc?", "cod?", "how to avail").
- SPAM_OR_TROLL: Scams, external links, competitor poaching, offensive profanity, fake giveaways, or malicious trolling ("scam yan", "buy cheaper here http...", "trash").
- SUPPORT_COMPLAINT: Existing customer complaining about a delayed order, defective item, refund request, or unanswered support ticket ("where is my order", "di pa dumadating", "broken item", "refund").
- GENERAL_PRAISE: Positive feedback, tagging friends, emojis, or general appreciation ("nice!", "legit seller", "love this", "@friend look").

Respond with ONLY the exact label string and nothing else.`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: `Comment: "${commentText}"` }],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 20,
          },
        }),
        cache: 'no-store',
      });

      if (response.ok) {
        const data = (await response.json()) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
        };

        const rawOutput =
          data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase() || '';

        if (rawOutput.includes('PRICE_INQUIRY')) return 'PRICE_INQUIRY';
        if (rawOutput.includes('SPAM_OR_TROLL')) return 'SPAM_OR_TROLL';
        if (rawOutput.includes('SUPPORT_COMPLAINT')) return 'SUPPORT_COMPLAINT';
        if (rawOutput.includes('GENERAL_PRAISE')) return 'GENERAL_PRAISE';
      }
    } catch (err) {
      console.error('[MetaComments] Gemini classification error, using fallback:', err);
    }
  }

  // Deterministic fallback classifier if GEMINI_API_KEY is absent or unreachable
  const lower = commentText.toLowerCase();

  if (
    /\b(http:\/\/|https:\/\/|bit\.ly|t\.me|whatsapp|scam|fake|bobo|pangit|basura|wag kayo)\b/i.test(
      lower
    )
  ) {
    return 'SPAM_OR_TROLL';
  }

  if (
    /\b(refund|return|damaged|defective|broken|delayed|tracking|order\s*#|asan na|wala pa|wrong item|complaint)\b/i.test(
      lower
    )
  ) {
    return 'SUPPORT_COMPLAINT';
  }

  if (
    /\b(hm|how much|magkano|price|details|avail|available|cod|shipping|location|loc|order|inquire|pm|dm)\b/i.test(
      lower
    )
  ) {
    return 'PRICE_INQUIRY';
  }

  return 'GENERAL_PRAISE';
}

/**
 * Posts a public reply to `POST /v21.0/${commentId}/comments`
 */
async function postPublicCommentReply(
  commentId: string,
  replyMessage: string
): Promise<boolean> {
  const token = getPageAccessToken();
  const endpoint = `${GRAPH_BASE_URL}/${encodeURIComponent(commentId)}/comments`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: replyMessage,
      access_token: token,
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    console.error(
      `[MetaComments] Failed posting public reply to ${commentId}:`,
      errText
    );
    return false;
  }

  return true;
}

/**
 * Sends a Private Reply DM via `POST /v21.0/${META_PAGE_ID}/messages`
 * using `recipient: { comment_id: commentId }`.
 */
async function sendPrivateReplyDm(
  commentId: string,
  dmMessage: string
): Promise<boolean> {
  const pageId = process.env.META_PAGE_ID;
  if (!pageId) {
    console.error('[MetaComments] Missing META_PAGE_ID for Private Reply DM.');
    return false;
  }

  const token = getPageAccessToken();
  const endpoint = `${GRAPH_BASE_URL}/${encodeURIComponent(pageId)}/messages`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { comment_id: commentId },
      message: { text: dmMessage },
      access_token: token,
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    console.error(
      `[MetaComments] Failed sending Private Reply DM for comment ${commentId}:`,
      errText
    );
    return false;
  }

  return true;
}

/**
 * Hides a comment on the ad/post via `POST /v21.0/${commentId}` (`is_hidden: true`)
 * so competitors cannot poach the inquiring lead or view spam/complaints.
 */
async function hidePublicComment(commentId: string): Promise<boolean> {
  const token = getPageAccessToken();
  const endpoint = `${GRAPH_BASE_URL}/${encodeURIComponent(commentId)}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      is_hidden: true,
      access_token: token,
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    console.error(`[MetaComments] Failed hiding comment ${commentId}:`, errText);
    return false;
  }

  return true;
}

/**
 * Extracts normalized comment events from either a full Meta webhook payload
 * (`entry[].changes[]` where `field === 'feed'` or `field === 'comments'`)
 * or a single comment event object.
 */
export function extractIncomingCommentsFromPayload(
  payload: Record<string, unknown>
): NormalizedMetaCommentEvent[] {
  const results: NormalizedMetaCommentEvent[] = [];

  // Case A: Direct single comment payload passed to `handleIncomingComment`
  if (typeof payload.comment_id === 'string' || typeof payload.commentId === 'string') {
    const fromObj = (payload.from as Record<string, unknown>) || {};
    const commentId = String(payload.comment_id || payload.commentId);
    const messageText = String(payload.message || payload.text || '').trim();
    if (commentId && messageText) {
      results.push({
        commentId,
        postId: payload.post_id ? String(payload.post_id) : null,
        senderId: String(fromObj.id || payload.sender_id || ''),
        senderName: String(fromObj.name || fromObj.username || payload.sender_name || 'Customer'),
        messageText,
        platform: payload.platform === 'INSTAGRAM' ? 'INSTAGRAM' : 'FACEBOOK',
      });
    }
    return results;
  }

  // Case B: Standard Meta Webhook payload (`entry[].changes[]`)
  const objectType = String(payload.object || 'page').toLowerCase();
  const entries = Array.isArray(payload.entry) ? payload.entry : [];

  for (const entry of entries as Array<Record<string, unknown>>) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes as Array<Record<string, unknown>>) {
      const field = String(change.field || '');
      if (field !== 'feed' && field !== 'comments') {
        continue;
      }

      const value = (change.value as Record<string, unknown>) || {};

      // For Facebook Page `feed` changes, process only newly added comments
      if (field === 'feed') {
        if (value.item && value.item !== 'comment') continue;
        if (value.verb && value.verb !== 'add') continue;
      }

      const commentId = String(value.comment_id || value.id || '').trim();
      const messageText = String(value.message || value.text || '').trim();
      if (!commentId || !messageText) {
        continue;
      }

      const fromObj = (value.from as Record<string, unknown>) || {};
      const senderId = String(fromObj.id || value.sender_id || '').trim();
      const senderName = String(
        fromObj.name || fromObj.username || value.sender_name || 'Valued Customer'
      ).trim();

      const mediaObj = (value.media as Record<string, unknown>) || {};
      const postId = value.post_id
        ? String(value.post_id)
        : mediaObj.id
          ? String(mediaObj.id)
          : null;

      results.push({
        commentId,
        postId,
        senderId,
        senderName,
        messageText,
        platform:
          objectType === 'instagram' || field === 'comments' ? 'INSTAGRAM' : 'FACEBOOK',
      });
    }
  }

  return results;
}

/**
 * Main entry point for the AI Comment-to-DM Shield (`handleIncomingComment`).
 */
export async function handleIncomingComment(
  payload: Record<string, unknown>
): Promise<CommentShieldExecutionResult[]> {
  const events = extractIncomingCommentsFromPayload(payload);
  if (events.length === 0) {
    return [];
  }

  const supabase = getSupabaseAdmin();
  const ownPageId = process.env.META_PAGE_ID?.trim();
  const ownIgId = process.env.META_IG_BUSINESS_ACCOUNT_ID?.trim();

  // Load active Comment Shield rule from `mkt_comment_rules`
  const { data: ruleRow } = await supabase
    .from('mkt_comment_rules')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<MktCommentRuleRow>();

  const activeRule: MktCommentRuleRow = ruleRow || DEFAULT_COMMENT_RULE;

  const executionResults: CommentShieldExecutionResult[] = [];

  for (const event of events) {
    // 1. Ignore comments made by our own Facebook Page or IG Business Account
    if (
      (ownPageId && event.senderId === ownPageId) ||
      (ownIgId && event.senderId === ownIgId)
    ) {
      executionResults.push({
        commentId: event.commentId,
        senderName: event.senderName,
        messageText: event.messageText,
        classification: 'IGNORED_SELF_COMMENT',
        matchedKeyword: null,
        publicReplySent: false,
        privateDmSent: false,
        commentHidden: false,
        actionLogged: 'IGNORED_SELF_COMMENT',
      });
      continue;
    }

    // 2. Check trigger_keywords first, or classify via Gemini 2.5 Flash
    const matchedKeyword = findMatchingTriggerKeyword(
      event.messageText,
      activeRule.trigger_keywords || DEFAULT_COMMENT_RULE.trigger_keywords
    );

    let classification: MktCommentIntentCategory = 'GENERAL_PRAISE';
    if (matchedKeyword) {
      classification = 'PRICE_INQUIRY';
    } else if (activeRule.ai_moderation_enabled) {
      classification = await classifyCommentWithGemini(event.messageText);
    }

    let publicReplySent = false;
    let privateDmSent = false;
    let commentHidden = false;
    let actionLogged = 'NO_ACTION';
    let logReason = '';

    // 3. Execute workflow based on classification
    if (classification === 'PRICE_INQUIRY') {
      const templates =
        Array.isArray(activeRule.public_reply_templates) &&
        activeRule.public_reply_templates.length > 0
          ? activeRule.public_reply_templates
          : DEFAULT_COMMENT_RULE.public_reply_templates;

      const randomTemplate =
        templates[Math.floor(Math.random() * templates.length)];
      const publicReplyText = interpolateTemplate(randomTemplate, event.senderName);
      const privateDmText = interpolateTemplate(
        activeRule.private_dm_template || DEFAULT_COMMENT_RULE.private_dm_template,
        event.senderName
      );

      // Step 3a: Post randomized public reply to `POST /v21.0/${commentId}/comments`
      publicReplySent = await postPublicCommentReply(event.commentId, publicReplyText);

      // Step 3b: Send Private Reply DM via `POST /v21.0/${META_PAGE_ID}/messages`
      privateDmSent = await sendPrivateReplyDm(event.commentId, privateDmText);

      // Step 3c: Optionally hide inquiry comment so competitors can't poach the lead
      if (activeRule.auto_hide_inquiry_comment) {
        commentHidden = await hidePublicComment(event.commentId);
      }

      actionLogged = commentHidden
        ? 'PUBLIC_REPLY_DM_SENT_AND_HIDDEN'
        : 'PUBLIC_REPLY_AND_DM_SENT';
      logReason = matchedKeyword
        ? `Matched keyword "${matchedKeyword}" on comment: "${event.messageText}"`
        : `AI classified as PRICE_INQUIRY: "${event.messageText}"`;
    } else if (classification === 'SPAM_OR_TROLL') {
      // Step 4: Immediately hide spam or troll comment
      commentHidden = await hidePublicComment(event.commentId);
      actionLogged = 'HIDDEN_SPAM_OR_TROLL';
      logReason = `AI Moderation detected SPAM_OR_TROLL: "${event.messageText}"`;
    } else if (classification === 'SUPPORT_COMPLAINT') {
      // Step 5: Hide complaint from public ad, send polite Private DM asking for order info, and log urgent alert
      commentHidden = await hidePublicComment(event.commentId);
      const supportDmText = `Hi ${event.senderName || 'there'}, we saw your comment and want to resolve this for you right away. Could you please reply here with your Order Number or registered phone number so our priority support team can assist you immediately? 🙏`;
      privateDmSent = await sendPrivateReplyDm(event.commentId, supportDmText);
      actionLogged = 'URGENT_SUPPORT_COMPLAINT_ESCALATED';
      logReason = `AI Moderation detected SUPPORT_COMPLAINT (hidden publicly & Private DM sent): "${event.messageText}"`;
    } else {
      // GENERAL_PRAISE: keep visible on ad for social proof
      actionLogged = 'KEPT_GENERAL_PRAISE';
      logReason = `AI Moderation classified as positive social proof (GENERAL_PRAISE): "${event.messageText}"`;
    }

    // Record audit entry in `mkt_automation_logs`
    await supabase.from('mkt_automation_logs').insert({
      module: 'COMMENT_SHIELD',
      action_taken: actionLogged,
      target_id: event.commentId,
      target_name: `${event.senderName} (${event.platform})`,
      reason: logReason,
      metadata: {
        post_id: event.postId,
        sender_id: event.senderId,
        sender_name: event.senderName,
        comment_text: event.messageText,
        classification,
        matched_keyword: matchedKeyword,
        public_reply_sent: publicReplySent,
        private_dm_sent: privateDmSent,
        comment_hidden: commentHidden,
      },
    });

    executionResults.push({
      commentId: event.commentId,
      senderName: event.senderName,
      messageText: event.messageText,
      classification,
      matchedKeyword,
      publicReplySent,
      privateDmSent,
      commentHidden,
      actionLogged,
    });
  }

  return executionResults;
}

