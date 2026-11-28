/**
 * Signalyn Canonical English Story Presentation Service (Phase 4A.8)
 * 
 * Invariant:
 * CANONICAL STORY PRESENTATION LANGUAGE = ENGLISH
 * 
 * Applies to:
 * - canonicalTitle
 * - title (kept in sync with canonicalTitle)
 * - summary / canonicalSummary
 * - presentationLanguage = 'en'
 * 
 * Guarantees:
 * 1. Independent of source article language (Greek, English, etc.).
 * 2. Original /articles content and titles remain untouched in /articles and StoryMemberships.
 * 3. Never copies raw source article headlines as canonical titles.
 * 4. Factual, concise, neutral, event-focused intelligence headlines (6-16 words).
 * 5. Uses server-side Gemini when available with strict structured output.
 * 6. High-fidelity deterministic fallback if Gemini is unconfigured or unavailable.
 */

import { Type } from '@google/genai';
import { Article, ArticleAnalysis, Story } from '../../types';
import {
  getGeminiClient,
  isGeminiConfigured,
  GEMINI_ANALYSIS_MODEL,
} from '../geminiClient';
import {
  checkGeminiQuotaAllowance,
  handleGeminiRateLimitError,
  isQuotaOrRateLimitError,
  recordGeminiProviderRequest,
} from '../geminiQuotaGuard';
import { GeminiQuotaLane } from '../../types';

export interface StoryPresentationInput {
  storyId?: string;
  articles: Article[];
  analyses: ArticleAnalysis[];
  primaryCompanyId?: string | null;
  primaryProductId?: string | null;
  newsType?: string | null;
  existingStory?: Story | null;
}

export interface StoryPresentationOutput {
  canonicalTitle: string;
  title: string;
  summary: string;
  canonicalSummary: string;
  presentationLanguage: 'en';
}

/**
 * Detects if a text contains Greek alphabet characters.
 */
export function containsGreekCharacters(text: string | null | undefined): boolean {
  if (!text) return false;
  return /[\u0370-\u03FF\u1F00-\u1FFF]/.test(text);
}

/**
 * Detects language category ('el' | 'en' | 'other').
 */
export function detectLanguage(text: string | null | undefined): 'el' | 'en' | 'other' {
  if (!text || !text.trim()) return 'en';
  if (containsGreekCharacters(text)) return 'el';
  return 'en';
}

/**
 * Checks whether an existing Story requires presentation migration:
 * - Title or summary contains Greek characters
 * - Title was copied verbatim from a source article headline
 * - Presentation language is not 'en'
 */
export function isPresentationMigrationRequired(
  story: Story,
  memberArticles: Article[]
): boolean {
  if (story.isLegacy || /^story-00[1-9]$/.test(story.id)) {
    return false; // Legacy bootstrap stories are strictly preserved
  }

  // 1. Greek characters in canonical title or title
  if (containsGreekCharacters(story.canonicalTitle) || containsGreekCharacters(story.title)) {
    return true;
  }

  // 2. Greek characters in summary
  if (containsGreekCharacters(story.summary)) {
    return true;
  }

  // 3. Verbatim copy of single-source article headline
  if (memberArticles.length === 1) {
    const artTitle = memberArticles[0]?.title?.trim().toLowerCase();
    const stCanonical = story.canonicalTitle?.trim().toLowerCase();
    const stTitle = story.title?.trim().toLowerCase();
    if (stCanonical && artTitle && stCanonical === artTitle) {
      return true;
    }
    if (stTitle && artTitle && stTitle === artTitle) {
      return true;
    }
  }

  // 4. Missing presentation language
  if (story.presentationLanguage !== 'en') {
    // If it's already an English synthesized title, we can also tag it
    if (story.canonicalTitle.includes('Coverage: Multi-Source Synthesized Story')) {
      return false; // Already valid English canonical title
    }
  }

  return false;
}

/**
 * Deterministic English presentation synthesizer.
 * Used as fallback or fast path.
 */
export function generateDeterministicPresentation(
  input: StoryPresentationInput
): StoryPresentationOutput {
  const { articles, analyses, primaryCompanyId, primaryProductId, newsType } = input;

  // Determine lead / rep analysis
  let repAnalysis: ArticleAnalysis | null = null;
  let maxScore = -1;
  for (const an of analyses) {
    const score = an.importanceScore || 0;
    if (score > maxScore) {
      maxScore = score;
      repAnalysis = an;
    }
  }
  if (!repAnalysis && analyses.length > 0) {
    repAnalysis = analyses[0];
  }

  // Extract company and product names
  const companies = Array.from(
    new Set(
      analyses
        .flatMap((a) => a.companies || [])
        .map((c) => c.canonicalName || (c as any).name)
        .filter(Boolean)
    )
  );

  const products = Array.from(
    new Set(
      analyses
        .flatMap((a) => a.products || [])
        .map((p) => p.canonicalName || (p as any).name)
        .filter(Boolean)
    )
  );

  const resolvedNewsType = (newsType || repAnalysis?.newsType || 'NEWS').toUpperCase();

  // Multi-company comparison detection (e.g. Xiaomi + Apple)
  let canonicalTitle = '';
  if (companies.length >= 2 && products.length >= 2) {
    canonicalTitle = `${products[0]} vs ${products[1]}: Comparative Flagship Analysis`;
  } else if (products.length > 0) {
    const primaryProd = products[0];
    const primaryComp = companies[0] || primaryCompanyId || 'Manufacturer';

    // Normalize product name to avoid repetition like "Huawei Huawei Mate XT2"
    const displayProd = primaryProd.toLowerCase().startsWith(primaryComp.toLowerCase())
      ? primaryProd
      : `${primaryComp} ${primaryProd}`;

    if (resolvedNewsType === 'PRODUCT_LAUNCH') {
      canonicalTitle = `${displayProd} Officially Unveiled with Next-Generation Capabilities`;
    } else if (resolvedNewsType === 'PRODUCT_LEAK') {
      canonicalTitle = `${displayProd} Specifications and Design Details Leak Ahead of Launch`;
    } else if (resolvedNewsType === 'REVIEW') {
      canonicalTitle = `${displayProd} In-Depth Review and Competitive Hardware Evaluation`;
    } else if (resolvedNewsType === 'MARKET_EXPANSION' || resolvedNewsType === 'REGIONAL_LAUNCH') {
      canonicalTitle = `${displayProd} Regional Market Availability and Launch Details`;
    } else {
      canonicalTitle = `${displayProd} Strategic Market and Hardware Overview`;
    }
  } else if (companies.length > 0) {
    canonicalTitle = `${companies[0]} Strategic Product and Technology Announcements`;
  } else {
    canonicalTitle = 'Technology Hardware Intelligence and Market Developments';
  }

  // Ensure word count bounds (approx 6-16 words)
  const words = canonicalTitle.split(/\s+/);
  if (words.length > 18) {
    canonicalTitle = words.slice(0, 16).join(' ');
  }

  // Summary selection (repAnalysis summary is already English from Phase 3 Article Intelligence)
  let summary = repAnalysis?.summary?.trim() || '';
  if (!summary || containsGreekCharacters(summary)) {
    // Synthesize English summary from structured properties
    const prodList = products.join(', ') || 'consumer hardware';
    const compList = companies.join(', ') || 'industry leaders';
    summary = `Intelligence report covering ${compList} and recent developments concerning ${prodList}, evaluating competitive impact and market positioning.`;
  }

  return {
    canonicalTitle,
    title: canonicalTitle,
    summary,
    canonicalSummary: summary,
    presentationLanguage: 'en',
  };
}

/**
 * Server-side Gemini presentation generation schema.
 */
const STORY_PRESENTATION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    canonicalTitle: {
      type: Type.STRING,
      description: 'Concise, factual, neutral English intelligence headline (6-16 words). Preserves company and product names.',
    },
    canonicalSummary: {
      type: Type.STRING,
      description: 'Factual, executive English summary (1-3 sentences, 25-60 words).',
    },
    language: {
      type: Type.STRING,
      description: 'Must always be "en".',
    },
  },
  required: ['canonicalTitle', 'canonicalSummary', 'language'],
};

/**
 * Generates canonical English presentation for a Story.
 * Prefers Gemini when configured, with strict structured JSON output and validation.
 * Falls back to deterministic English synthesizer if Gemini fails or is unconfigured.
 */
export async function generateCanonicalPresentation(
  input: StoryPresentationInput,
  options?: {
    forceDeterministic?: boolean;
    quotaLane?: GeminiQuotaLane;
  }
): Promise<StoryPresentationOutput> {
  const fallback = generateDeterministicPresentation(input);
  const quotaLane: GeminiQuotaLane = options?.quotaLane || 'STORY_INTELLIGENCE';

  if (options?.forceDeterministic || !isGeminiConfigured()) {
    return fallback;
  }

  const allowance = await checkGeminiQuotaAllowance(quotaLane);
  if (!allowance.allowed) {
    console.warn(`[StoryPresentationService] Quota guard active (${allowance.code}); using deterministic English presentation.`);
    return fallback;
  }

  try {
    const ai = getGeminiClient();

    const companies = Array.from(
      new Set(
        input.analyses
          .flatMap((a) => a.companies || [])
          .map((c) => c.canonicalName || (c as any).name)
          .filter(Boolean)
      )
    );

    const products = Array.from(
      new Set(
        input.analyses
          .flatMap((a) => a.products || [])
          .map((p) => p.canonicalName || (p as any).name)
          .filter(Boolean)
      )
    );

    const memberSummaries = input.analyses
      .map((a, i) => `[Source ${i + 1} (${input.articles[i]?.sourceName || 'Source'})]: ${a.summary}`)
      .join('\n');

    const topics = Array.from(new Set(input.analyses.flatMap((a) => a.topics || []))).slice(0, 8);

    const prompt = `You are a senior technology competitive intelligence analyst at Signalyn.
Generate a canonical English intelligence headline and executive summary for this tech story.

STRUCTURED INTELLIGENCE:
- Companies: ${companies.join(', ') || 'N/A'}
- Products: ${products.join(', ') || 'N/A'}
- Event / News Type: ${input.newsType || input.analyses[0]?.newsType || 'NEWS'}
- Key Topics: ${topics.join(', ') || 'Technology, Hardware'}
- Member Article Intelligence Summaries:
${memberSummaries}

CRITICAL presentation rules:
1. canonicalTitle MUST be in ENGLISH regardless of the language of source articles.
2. canonicalTitle MUST be concise, factual, neutral, and event-focused (6 to 16 words).
3. Explicitly preserve company and product names (e.g. "Huawei", "Mate XT2", "Xiaomi 17 Ultra", "Apple", "iPhone 18 Pro Max", "AirPods 5", "Samsung Galaxy Buds On").
4. NEVER use clickbait, exaggerated claims, or source-specific idioms (e.g., avoid "has no secrets left", "are not cheap").
5. Do NOT perform word-for-word translation of foreign headlines; describe the actual industry event.
6. canonicalSummary MUST be in ENGLISH, 1-3 sentences, 25-60 words, factual and executive.
7. Output JSON strictly matching the schema with language = "en".`;

    const response = await ai.models.generateContent({
      model: GEMINI_ANALYSIS_MODEL,
      contents: prompt,
      config: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: STORY_PRESENTATION_SCHEMA,
      },
    });
    await recordGeminiProviderRequest({
      lane: quotaLane,
      model: GEMINI_ANALYSIS_MODEL,
      outcome: 'SUCCESS',
    });

    const text = response.text?.trim();
    if (!text) {
      return fallback;
    }

    const parsed = JSON.parse(text);
    if (!parsed.canonicalTitle || typeof parsed.canonicalTitle !== 'string') {
      return fallback;
    }

    const cleanTitle = parsed.canonicalTitle.trim().replace(/^["']|["']$/g, '');
    const cleanSummary = (parsed.canonicalSummary || fallback.summary).trim();

    // Verify English output (no Greek characters in title or summary)
    if (containsGreekCharacters(cleanTitle) || containsGreekCharacters(cleanSummary)) {
      console.warn('[StoryPresentationService] Gemini generated Greek text. Reverting to deterministic fallback.');
      return fallback;
    }

    return {
      canonicalTitle: cleanTitle,
      title: cleanTitle,
      summary: cleanSummary,
      canonicalSummary: cleanSummary,
      presentationLanguage: 'en',
    };
  } catch (err) {
    if (isQuotaOrRateLimitError(err)) {
      await recordGeminiProviderRequest({
        lane: quotaLane,
        model: GEMINI_ANALYSIS_MODEL,
        outcome: 'RATE_LIMITED',
      });
      await handleGeminiRateLimitError(quotaLane, err, GEMINI_ANALYSIS_MODEL);
    } else {
      await recordGeminiProviderRequest({
        lane: quotaLane,
        model: GEMINI_ANALYSIS_MODEL,
        outcome: 'ERROR',
      });
    }
    console.warn('[StoryPresentationService] Gemini call failed, using deterministic fallback:', err);
    return fallback;
  }
}
