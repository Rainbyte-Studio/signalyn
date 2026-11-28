/**
 * Signalyn Phase 4A.2: Gemini Ambiguous-Edge Adjudicator
 * 
 * Invoked ONLY for article pairs classified as AMBIGUOUS by the Stage 1 deterministic engine.
 * CLEAR_MATCH and CLEAR_SEPARATE pairs are strictly bypassed.
 * Evaluates event identity vs related/distinct threads using structured Gemini output.
 */

import { Type } from '@google/genai';
import { Article, ArticleAnalysis } from '../../types';
import {
  MappedSemanticDecision,
  PairwiseMatchResult,
  SemanticAdjudicationRaw,
  SemanticAdjudicationResult,
  SemanticDecision,
} from './types';
import {
  getGeminiClient,
  isGeminiConfigured,
  GEMINI_ANALYSIS_MODEL,
  GEMINI_FALLBACK_MODEL,
} from '../geminiClient';
import {
  handleGeminiRateLimitError,
  isQuotaOrRateLimitError,
  reserveGeminiProviderRequest,
} from '../geminiQuotaGuard';
import { GeminiQuotaLane } from '../../types';

export const SEMANTIC_ADJUDICATION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    decision: {
      type: Type.STRING,
      enum: ['SAME_EVENT', 'RELATED_BUT_DISTINCT', 'DIFFERENT_EVENT', 'UNCERTAIN'],
    },
    confidence: {
      type: Type.NUMBER,
    },
    rationale: {
      type: Type.STRING,
    },
    sharedEventSignals: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    distinctEventSignals: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: [
    'decision',
    'confidence',
    'rationale',
    'sharedEventSignals',
    'distinctEventSignals',
  ],
};

/**
 * Maps raw semantic decision and confidence to Stage 2 clustering action.
 * Enforces strict 0.80 confidence threshold for automated action.
 */
export function mapSemanticDecision(
  rawDecision: SemanticDecision,
  confidence: number
): MappedSemanticDecision {
  if (confidence < 0.80) {
    return 'REVIEW_REQUIRED';
  }

  switch (rawDecision) {
    case 'SAME_EVENT':
      return 'SEMANTIC_MATCH';
    case 'RELATED_BUT_DISTINCT':
    case 'DIFFERENT_EVENT':
      return 'SEMANTIC_SEPARATE';
    case 'UNCERTAIN':
    default:
      return 'REVIEW_REQUIRED';
  }
}

/**
 * Formats concise, structured metadata for an article to send to Gemini.
 * Strictly avoids full article HTML or unstructured body text.
 */
function formatArticleMetadata(art: Article, an: ArticleAnalysis): Record<string, any> {
  return {
    articleId: art.id,
    title: art.title,
    source: art.sourceName || art.sourceId,
    publishedAt: art.publishedAt,
    market: art.market || an.market || 'Global',
    newsType: an.newsType,
    secondaryNewsTypes: an.secondaryNewsTypes || [],
    importanceScore: an.importanceScore,
    summary: an.summary,
    keyPoints: an.keyPoints || [],
    companies: (an.companies || []).map((c) => ({
      name: c.canonicalName,
      relevance: c.relevance,
    })),
    products: (an.products || []).map((p) => ({
      name: p.canonicalName,
      category: p.category,
      relevance: p.relevance,
    })),
    topics: an.topics || [],
    competitiveSignals: (an.competitiveSignals || []).map((s) => ({
      type: s.type,
      company: s.company,
      description: s.description,
    })),
  };
}

/**
 * Adjudicates an AMBIGUOUS pair using Gemini.
 */
export async function adjudicateAmbiguousPair(
  articleA: Article,
  analysisA: ArticleAnalysis,
  articleB: Article,
  analysisB: ArticleAnalysis,
  stage1Result: PairwiseMatchResult,
  options?: { model?: string; quotaLane?: GeminiQuotaLane }
): Promise<SemanticAdjudicationResult> {
  const startTime = Date.now();
  const quotaLane: GeminiQuotaLane = options?.quotaLane || 'STORY_INTELLIGENCE';

  if (!isGeminiConfigured()) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  const ai = getGeminiClient();
  const effectiveModel = options?.model || GEMINI_ANALYSIS_MODEL;

  const systemInstruction = `You are a Senior Editorial Intelligence Adjudicator for technology media and market events.
Your task is to evaluate two technology articles and determine whether they describe the SAME underlying news event or editorial story thread, or if they represent distinct events or narrative threads.

The narrow question you must answer:
"Do these two articles primarily describe the same underlying news event or editorial story thread?"

Explicitly distinguish:
1. SAME_EVENT: Both articles directly cover the same specific news occurrence, product launch wave, or simultaneous review cycle for the same release.
2. RELATED_BUT_DISTINCT: Articles share companies or products, but describe distinct events (e.g. an initial product launch vs a later review, or a technical hardware benchmark vs a lifestyle/wellbeing personal narrative). Product identity alone is NEVER sufficient for SAME_EVENT.
3. DIFFERENT_EVENT: Articles describe completely unrelated occurrences, different product announcements, or distant timeframes.
4. UNCERTAIN: Evidence is genuinely ambiguous, contradictory, or insufficient to reach a decisive conclusion.

Ground your rationale strictly in the provided metadata. Be concise and precise.`;

  const userPrompt = `Compare these two articles that were classified as AMBIGUOUS by the Stage 1 deterministic clustering engine:

--- ARTICLE A ---
${JSON.stringify(formatArticleMetadata(articleA, analysisA), null, 2)}

--- ARTICLE B ---
${JSON.stringify(formatArticleMetadata(articleB, analysisB), null, 2)}

--- STAGE 1 DETERMINISTIC EVIDENCE ---
- Stage 1 Decision: ${stage1Result.decision}
- Stage 1 Total Score: ${stage1Result.totalScore}
- Stage 1 Component Scores: ${JSON.stringify(stage1Result.scores)}
- Ambiguity Reason: ${stage1Result.explanation}

Provide your structured adjudication decision according to the schema.`;

  let responseText = '';
  let modelUsed = effectiveModel;

  // Atomically reserve 1 provider request slot BEFORE sending primary Gemini call
  await reserveGeminiProviderRequest({
    lane: quotaLane,
    model: effectiveModel,
  });

  try {
    const res = await ai.models.generateContent({
      model: effectiveModel,
      contents: userPrompt,
      config: {
        systemInstruction,
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: SEMANTIC_ADJUDICATION_SCHEMA,
      },
    });
    responseText = res.text?.trim() || '';
  } catch (err: any) {
    if (isQuotaOrRateLimitError(err)) {
      throw await handleGeminiRateLimitError(quotaLane, err, effectiveModel);
    }

    const errMsg = err?.message || String(err);
    console.warn(`[Ambiguous Adjudicator] Model ${effectiveModel} failed: ${errMsg}. Trying fallback: ${GEMINI_FALLBACK_MODEL}`);

    // Atomically reserve 1 provider request slot BEFORE sending fallback Gemini call
    modelUsed = GEMINI_FALLBACK_MODEL;
    await reserveGeminiProviderRequest({
      lane: quotaLane,
      model: GEMINI_FALLBACK_MODEL,
      isRetry: true,
      isFallback: true,
    });

    try {
      const fallbackRes = await ai.models.generateContent({
        model: GEMINI_FALLBACK_MODEL,
        contents: userPrompt,
        config: {
          systemInstruction,
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseSchema: SEMANTIC_ADJUDICATION_SCHEMA,
        },
      });
      responseText = fallbackRes.text?.trim() || '';
    } catch (fallbackErr: any) {
      if (isQuotaOrRateLimitError(fallbackErr)) {
        throw await handleGeminiRateLimitError(quotaLane, fallbackErr, GEMINI_FALLBACK_MODEL);
      }
      throw fallbackErr;
    }
  }

  const durationMs = Date.now() - startTime;

  let parsed: SemanticAdjudicationRaw;
  try {
    parsed = JSON.parse(responseText);
  } catch (parseErr) {
    console.error('[Ambiguous Adjudicator] Failed to parse JSON response:', responseText);
    return {
      articleAId: articleA.id,
      articleBId: articleB.id,
      rawDecision: 'UNCERTAIN',
      confidence: 0.0,
      mappedDecision: 'REVIEW_REQUIRED',
      rationale: 'Malformed JSON response from semantic adjudicator model.',
      sharedEventSignals: [],
      distinctEventSignals: [],
      modelUsed,
      durationMs,
    };
  }

  // Schema Invariant Validation
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !parsed.decision ||
    typeof parsed.confidence !== 'number'
  ) {
    return {
      articleAId: articleA.id,
      articleBId: articleB.id,
      rawDecision: 'UNCERTAIN',
      confidence: 0.0,
      mappedDecision: 'REVIEW_REQUIRED',
      rationale: 'Invalid schema returned by semantic adjudicator model.',
      sharedEventSignals: [],
      distinctEventSignals: [],
      modelUsed,
      durationMs,
    };
  }

  const confidence = Math.min(Math.max(parsed.confidence, 0.0), 1.0);
  const rawDecision = parsed.decision;
  const mappedDecision = mapSemanticDecision(rawDecision, confidence);

  return {
    articleAId: articleA.id,
    articleBId: articleB.id,
    rawDecision,
    confidence,
    mappedDecision,
    rationale: parsed.rationale || 'No rationale provided by model.',
    sharedEventSignals: Array.isArray(parsed.sharedEventSignals) ? parsed.sharedEventSignals : [],
    distinctEventSignals: Array.isArray(parsed.distinctEventSignals) ? parsed.distinctEventSignals : [],
    modelUsed,
    durationMs,
  };
}
