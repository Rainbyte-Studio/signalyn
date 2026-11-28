/**
 * Signalyn Intelligence Analysis Engine (Phase 3)
 * 
 * Powered by Gemini (@google/genai: gemini-3.8-flash).
 * Transforms raw ingested articles into structured competitive intelligence:
 * 
 * ARTICLE → GEMINI ANALYSIS → STRUCTURED INTELLIGENCE → FIRESTORE
 * 
 * Key Principles:
 * 1. RAW DATA IS IMMUTABLE: Raw articles in /articles/{id} remain untouched
 *    except for processingStatus lifecycle tracking.
 * 2. SEPARATE STORAGE: Derived intelligence is written to /articleAnalysis/{id}.
 * 3. DYNAMIC CONFIGURATION: Reads My Company and competitor sets from /settings/intelligence.
 * 4. CANONICAL REGISTRY MATCHING: Resolves companies & products against canonical lists
 *    with case-insensitive alias support; unresolved entities are routed to /entityReview.
 * 5. SAFE RESILIENCY: Bounded exponential retry for transient errors, fail-safe status updates,
 *    and usage telemetry tracking in /system/aiRuns.
 */

import { Type } from '@google/genai';
import { getServerDb, cleanServerData } from './serverFirestoreAdapter';
import {
  Article,
  ArticleAnalysis,
  AnalyzedCompany,
  AnalyzedProduct,
  UnresolvedEntity,
  CompetitiveSignal,
  CompetitiveRelevance,
  NewsType,
  SentimentType,
  EntityReview,
  AIRun,
  Company,
  Product,
  IntelligenceSettings,
} from '../types';
import { normalizeArticleText } from '../utils/textNormalizer';
import {
  recordEntityReview,
  resolveCompanySafe,
  resolveProductSafe,
} from './entityResolution/entityReviewService';
import {
  CANONICAL_COMPANIES_REGISTRY,
  CANONICAL_PRODUCTS_REGISTRY,
  getMergedCanonicalCompanies,
  getMergedCanonicalProducts,
} from '../services/canonicalEntities';
import { getCanonicalContext } from './entityResolution/canonicalContextCache';
import { recordArticleContributionInFirestore } from './analytics/firestoreAggregationAdapter';
import {
  getGeminiClient,
  isGeminiConfigured,
  GEMINI_ANALYSIS_MODEL,
  GEMINI_FALLBACK_MODEL,
  SIGNALYN_ANALYSIS_VERSION,
} from './geminiClient';
import { processArticleForStory } from './clustering/incrementalStoryService';
import { classifyStrategicRelevance, RelevanceDecision } from './strategicRelevanceGate';
import {
  assertGeminiQuotaAllowance,
  GeminiQuotaExceededError,
  handleGeminiRateLimitError,
  isQuotaOrRateLimitError,
  recordGeminiProviderRequest,
  resolveArticleQuotaLane,
} from './geminiQuotaGuard';

export const CURRENT_RELEVANCE_GATE_VERSION = 'v1.1';

const cleanFirestoreData = cleanServerData;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Normalizes strings for robust matching.
 */
function normalizeEntityText(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Resolves a detected company name against canonical registered companies & aliases.
 */
function resolveCompany(
  detectedName: string,
  canonicalCompanies: Company[]
): { matchedCompany?: Company; matchedAlias?: string } {
  const normDetected = normalizeEntityText(detectedName);
  if (!normDetected) return {};

  for (const company of canonicalCompanies) {
    if (normalizeEntityText(company.name) === normDetected) {
      return { matchedCompany: company, matchedAlias: company.name };
    }
    for (const alias of company.aliases || []) {
      if (normalizeEntityText(alias) === normDetected) {
        return { matchedCompany: company, matchedAlias: alias };
      }
    }
  }

  // Substring / word boundary fallback for common corporate suffixes (e.g., "Huawei Technologies", "Apple Inc.")
  for (const company of canonicalCompanies) {
    const normName = normalizeEntityText(company.name);
    if (normDetected.includes(normName) || normName.includes(normDetected)) {
      return { matchedCompany: company, matchedAlias: company.name };
    }
  }

  return {};
}

/**
 * Resolves a detected product name against canonical registered products & aliases.
 */
function resolveProduct(
  detectedName: string,
  canonicalProducts: Product[]
): { matchedProduct?: Product; matchedAlias?: string } {
  const normDetected = normalizeEntityText(detectedName);
  if (!normDetected) return {};

  for (const product of canonicalProducts) {
    if (normalizeEntityText(product.name) === normDetected) {
      return { matchedProduct: product, matchedAlias: product.name };
    }
    for (const alias of product.aliases || []) {
      if (normalizeEntityText(alias) === normDetected) {
        return { matchedProduct: product, matchedAlias: alias };
      }
    }
  }

  // Infix / contains check
  for (const product of canonicalProducts) {
    const normName = normalizeEntityText(product.name);
    if (normDetected.includes(normName) || normName.includes(normDetected)) {
      return { matchedProduct: product, matchedAlias: product.name };
    }
  }

  return {};
}

// ---------------------------------------------------------------------------
// Structured JSON Output Schema for Gemini
// ---------------------------------------------------------------------------

const ARTICLE_ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    newsType: {
      type: Type.STRING,
      description:
        'Primary category: NEWS, PRODUCT_LAUNCH, PRODUCT_LEAK, RUMOR, REVIEW, HANDS_ON, SOFTWARE_UPDATE, NEW_FEATURE, PRICE_CHANGE, PARTNERSHIP, MARKETING_CAMPAIGN, MARKET_EXPANSION, BUSINESS, LEGAL_REGULATORY, AWARD, or OTHER',
    },
    secondaryNewsTypes: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Secondary classifications if relevant (e.g. REVIEW and PRODUCT_LAUNCH)',
    },
    summary: {
      type: Type.STRING,
      description:
        'Concise, factual intelligence summary answering what happened, who is involved, product affected, and why it matters. 2-4 sentences without marketing fluff.',
    },
    keyPoints: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '2 to 6 concrete factual takeaways or clearly grounded interpretations',
    },
    topics: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        'Concise canonical tags from list: AI, Camera, Battery, Display, Design, Health, Fitness, Software, HarmonyOS, Android, iOS, Wearables, Smartphones, Foldables, Tablets, Laptops, Audio, Chipsets, 5G, Telecom, Pricing, Retail, Security, Automotive',
    },
    sentiment: {
      type: Type.STRING,
      description: 'Editorial tone toward the PRIMARY subject/company: POSITIVE, NEUTRAL, NEGATIVE, or MIXED',
    },
    sentimentConfidence: {
      type: Type.NUMBER,
      description: 'Confidence in sentiment from 0.0 to 1.0',
    },
    importanceScore: {
      type: Type.INTEGER,
      description:
        '0 to 100 importance score based on event significance (0-19 Very Low, 20-39 Low, 40-59 Moderate, 60-79 High, 80-100 Critical)',
    },
    companies: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: 'Detected company name' },
          relevance: { type: Type.STRING, description: 'PRIMARY, SECONDARY, or MENTION' },
          confidence: { type: Type.NUMBER, description: 'Confidence between 0.0 and 1.0' },
        },
        required: ['name', 'relevance', 'confidence'],
      },
    },
    products: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: 'Product or model name' },
          companyName: { type: Type.STRING, description: 'Associated manufacturer/brand' },
          category: {
            type: Type.STRING,
            description:
              'SMARTPHONES, WEARABLES, TABLETS, LAPTOPS, AUDIO, AI, SOFTWARE, CHIPSETS, TELECOM, SMART_HOME, AUTOMOTIVE, or OTHER',
          },
          subcategory: { type: Type.STRING, description: 'e.g. Flagship Smartphone, Foldable, Smartwatch, ANC Earbuds' },
          relevance: { type: Type.STRING, description: 'PRIMARY, SECONDARY, or MENTION' },
          confidence: { type: Type.NUMBER, description: 'Confidence between 0.0 and 1.0' },
        },
        required: ['name', 'category', 'relevance', 'confidence'],
      },
    },
    competitiveRelevance: {
      type: Type.OBJECT,
      properties: {
        score: {
          type: Type.INTEGER,
          description:
            '0 to 100 score indicating competitive utility to the configured target company and its competitor landscape',
        },
        reasons: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Bullet points explaining why this affects the primary company or rival balance',
        },
        categories: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Specific hardware/software categories contested in this news',
        },
        relatedCompanies: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Companies that compete in this space',
        },
      },
      required: ['score', 'reasons', 'categories', 'relatedCompanies'],
    },
    competitiveSignals: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: {
            type: Type.STRING,
            description:
              'Signal category: PRODUCT_LAUNCH, FEATURE_ADVANTAGE, FEATURE_GAP, PRICING_MOVE, MARKET_EXPANSION, PARTNERSHIP, SOFTWARE_STRATEGY, AI_STRATEGY, CAMERA_STRATEGY, BATTERY_STRATEGY, CHIPSET_STRATEGY, SUPPLY_CHAIN, REGULATORY_EVENT, or OTHER',
          },
          company: { type: Type.STRING, description: 'Company executing or impacted by the move' },
          product: { type: Type.STRING, description: 'Specific product if applicable' },
          description: { type: Type.STRING, description: 'Factual description of the move and strategic intent' },
          confidence: { type: Type.NUMBER, description: 'Confidence 0.0 to 1.0' },
          evidence: {
            type: Type.STRING,
            description: 'Short verbatim or near-verbatim quote from the article supporting this signal',
          },
        },
        required: ['type', 'company', 'description', 'confidence', 'evidence'],
      },
    },
    overallConfidence: {
      type: Type.NUMBER,
      description: 'Overall confidence in the extraction between 0.0 and 1.0',
    },
  },
  required: [
    'newsType',
    'summary',
    'keyPoints',
    'topics',
    'sentiment',
    'sentimentConfidence',
    'importanceScore',
    'companies',
    'products',
    'competitiveRelevance',
    'competitiveSignals',
    'overallConfidence',
  ],
};

// ---------------------------------------------------------------------------
// Core Analysis Method
// ---------------------------------------------------------------------------

export interface AnalysisExecutionResult {
  success: boolean;
  articleId: string;
  analysis?: ArticleAnalysis;
  error?: string;
  durationMs: number;
  skipped?: boolean;
  skipReason?: string;
  relevanceDecision?: RelevanceDecision;
  quotaSuspended?: boolean;
  quotaCode?: string;
}

/**
 * Analyzes a single article with Gemini, writes results to /articleAnalysis,
 * and maintains the article processing lifecycle.
 */
export async function analyzeArticle(
  articleId: string,
  options?: { forceReanalyze?: boolean; trigger?: string; autoCluster?: boolean }
): Promise<AnalysisExecutionResult> {
  const startTime = Date.now();
  const trigger = options?.trigger || 'MANUAL';

  // 1. Fetch raw article
  const db = getServerDb();
  const articleRef = db.collection('articles').doc(articleId);
  const articleSnap = await articleRef.get();
  const isArticleExists = typeof articleSnap.exists === 'function'
    ? (articleSnap as any).exists()
    : Boolean(articleSnap.exists);

  if (!isArticleExists) {
    throw new Error(`Article not found: ${articleId}`);
  }

  const article = articleSnap.data() as Article;

  // 1a. Reversible skip check: if already skipped and gate version matches, avoid repeating work
  if (article.processingStatus === 'SKIPPED_STRATEGIC_SCOPE' && !options?.forceReanalyze) {
    if (article.relevanceGateVersion === CURRENT_RELEVANCE_GATE_VERSION) {
      return {
        success: true,
        articleId,
        skipped: true,
        skipReason: article.relevanceReason || 'Skipped due to strategic scope',
        relevanceDecision: 'OUT_OF_SCOPE',
        durationMs: Date.now() - startTime,
      };
    }
  }

  // Prevent duplicate concurrent work unless forced
  if (article.processingStatus === 'PROCESSING' && !options?.forceReanalyze) {
    const lastAttempt = article.lastAnalysisAttemptAt
      ? new Date(article.lastAnalysisAttemptAt).getTime()
      : 0;
    // Allow re-attempt if stuck for more than 3 minutes
    if (Date.now() - lastAttempt < 180000) {
      throw new Error(`Article ${articleId} is currently being processed by another worker.`);
    }
  }

  if (article.processingStatus === 'ANALYZED' && !options?.forceReanalyze) {
    // Return existing analysis
    const existingAnalysisSnap = await db.collection('articleAnalysis').doc(articleId).get();
    const isExistingAnalysisExists = typeof existingAnalysisSnap.exists === 'function'
      ? (existingAnalysisSnap as any).exists()
      : Boolean(existingAnalysisSnap.exists);

    if (isExistingAnalysisExists) {
      return {
        success: true,
        articleId,
        analysis: existingAnalysisSnap.data() as ArticleAnalysis,
        durationMs: Date.now() - startTime,
      };
    }
  }

  // 1b. Strategic Relevance Gate Evaluation (LAST SAFE POINT BEFORE GEMINI)
  const relevance = classifyStrategicRelevance({
    title: article.title,
    excerpt: article.excerpt,
    rawCategories: article.rawCategories,
    sourceName: article.sourceName,
    canonicalUrl: article.canonicalUrl,
  });

  // OUT_OF_SCOPE: Mark as SKIPPED_STRATEGIC_SCOPE and strictly do NOT call Gemini!
  if (relevance.decision === 'OUT_OF_SCOPE' && !options?.forceReanalyze) {
    const evaluatedAt = new Date().toISOString();
    await articleRef.update(cleanServerData({
      processingStatus: 'SKIPPED_STRATEGIC_SCOPE',
      relevanceDecision: 'OUT_OF_SCOPE',
      relevanceCategory: relevance.category,
      relevanceReason: relevance.reason,
      relevanceEvaluatedAt: evaluatedAt,
      relevanceGateVersion: CURRENT_RELEVANCE_GATE_VERSION,
      relevanceMatchedKeywords: relevance.matchedKeywords,
      relevanceMatchedCompanies: relevance.matchedCompanies,
      needsReanalysis: false,
    })).catch((e) => console.warn(`Could not update article ${articleId} to SKIPPED_STRATEGIC_SCOPE:`, e));

    return {
      success: true,
      articleId,
      skipped: true,
      skipReason: relevance.reason,
      relevanceDecision: 'OUT_OF_SCOPE',
      durationMs: Date.now() - startTime,
    };
  }

  // IN_SCOPE or UNCERTAIN: Proceed to Gemini intelligence analysis
  if (!isGeminiConfigured()) {
    throw new Error(
      'Gemini API is not configured on the server. Please ensure the GEMINI_API_KEY environment variable is set.'
    );
  }

  // 2. Transition state: PENDING / FAILED / RECONSIDERED → PROCESSING
  const attemptCount = (article.analysisAttemptCount || 0) + 1;
  await articleRef.update(cleanServerData({
    processingStatus: 'PROCESSING',
    lastAnalysisAttemptAt: new Date().toISOString(),
    analysisAttemptCount: attemptCount,
  })).catch((e) => console.warn('Could not update article to PROCESSING:', e));

  try {
    // 3. Load Context from Cached Canonical Intelligence Context (P0.2)
    const context = await getCanonicalContext();
    const { canonicalCompanies, canonicalProducts, settings } = context;

    const myCompany = settings.myCompanyName || 'HUAWEI';
    const myCompanyId = settings.myCompanyId || 'comp-huawei';
    const competitorSets = settings.competitorSets || {};

    // 4. Construct Prompt
    const systemInstruction = `You are a Principal Competitive Intelligence Analyst for global technology markets.
Your task is to analyze raw technology news articles and extract structured, actionable intelligence.
Ground all conclusions and extracted signals strictly in the provided article text. Do not invent rumors, product launches, or quotes not present in the article.

Configured Primary Entity (My Company): ${myCompany} (ID: ${myCompanyId}).
Configured Competitor Landscape: ${JSON.stringify(competitorSets)}.

Canonical Company Registry includes: ${canonicalCompanies.map((c) => `${c.name} (aliases: ${(c.aliases || []).join(', ')})`).join('; ')}.

Canonical Products include: ${canonicalProducts.slice(0, 30).map((p) => `${p.name} (${p.category})`).join('; ')}.

Important Guidelines:
1. NewsType: Distinguish leaks/rumors (PRODUCT_LEAK, RUMOR) from confirmed events (PRODUCT_LAUNCH, SOFTWARE_UPDATE).
2. Importance Score (0-100): 0-19 Very Low (minor mention), 20-39 Low, 40-59 Moderate (standard review/update), 60-79 High (major flagship announcement), 80-100 Critical (industry-shifting move).
3. Competitive Relevance: Evaluate how directly this impacts ${myCompany} and its primary rivals.
4. Competitive Signals: For any detected strategic move, extract the signal type, company, clear description, confidence, and a short verbatim excerpt from the article as proof.
5. Topics: Produce concise canonical tags (e.g. AI, Camera, Battery, Display, HarmonyOS, Android, Foldables, Chipsets, 5G).
6. Sentiment: Evaluate editorial sentiment towards the PRIMARY company or product discussed.`;

    const cleanArticleTitle = normalizeArticleText(article.title);
    const cleanArticleExcerpt = normalizeArticleText(article.excerpt || article.title);

    const userPrompt = `Analyze this technology article:

TITLE: ${cleanArticleTitle}
SOURCE: ${article.sourceName || article.sourceId}
PUBLISHED AT: ${article.publishedAt}
CANONICAL URL: ${article.canonicalUrl}
TEXT / EXCERPT:
${cleanArticleExcerpt}`;

    // 5. Call Gemini API with centralized quota protection, true provider-request accounting,
    // and immediate retry-stop on HTTP 429 / RESOURCE_EXHAUSTED
    const quotaLane = resolveArticleQuotaLane(trigger);
    await assertGeminiQuotaAllowance(quotaLane);

    const ai = getGeminiClient();
    let geminiResponse: any = null;
    let lastError: any = null;
    let effectiveModel = GEMINI_ANALYSIS_MODEL;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Re-check quota before any retry or fallback provider request
      if (attempt > 1) {
        await assertGeminiQuotaAllowance(quotaLane);
      }

      const isFallback = effectiveModel !== GEMINI_ANALYSIS_MODEL;
      const isRetry = attempt > 1;

      try {
        geminiResponse = await ai.models.generateContent({
          model: effectiveModel,
          contents: userPrompt,
          config: {
            systemInstruction,
            temperature: 0.1, // Low temperature for high factual precision
            responseMimeType: 'application/json',
            responseSchema: ARTICLE_ANALYSIS_SCHEMA,
          },
        });
        await recordGeminiProviderRequest({
          lane: quotaLane,
          model: effectiveModel,
          isRetry,
          isFallback,
          outcome: 'SUCCESS',
        });
        break; // Success!
      } catch (err: any) {
        lastError = err;
        const errMsg = err?.message || String(err);

        // Immediately detect HTTP 429 / RESOURCE_EXHAUSTED: stop retries and suspend historical lane
        if (isQuotaOrRateLimitError(err)) {
          await recordGeminiProviderRequest({
            lane: quotaLane,
            model: effectiveModel,
            isRetry,
            isFallback,
            outcome: 'RATE_LIMITED',
          });
          throw await handleGeminiRateLimitError(quotaLane, err, effectiveModel);
        }

        await recordGeminiProviderRequest({
          lane: quotaLane,
          model: effectiveModel,
          isRetry,
          isFallback,
          outcome: 'ERROR',
        });

        console.warn(
          `[Gemini Analysis] Attempt ${attempt} with model ${effectiveModel} failed for article ${articleId}: ${errMsg}`
        );

        // If 503 high demand or overloaded, switch to fallback model
        if (
          (errMsg.includes('503') ||
            errMsg.includes('high demand') ||
            errMsg.includes('overloaded') ||
            errMsg.includes('UNAVAILABLE')) &&
          effectiveModel !== GEMINI_FALLBACK_MODEL
        ) {
          console.log(
            `[Gemini Analysis] Model ${effectiveModel} is experiencing peak load. Switching to resilient fallback model: ${GEMINI_FALLBACK_MODEL}`
          );
          effectiveModel = GEMINI_FALLBACK_MODEL;
          continue;
        }

        // Check for non-retryable errors (e.g. invalid argument, bad key)
        if (errMsg.includes('API key') || errMsg.includes('PERMISSION_DENIED')) {
          throw err;
        }

        if (attempt < maxRetries) {
          const backoff = Math.pow(2, attempt) * 1000;
          await sleep(backoff);
        }
      }
    }

    if (!geminiResponse || !geminiResponse.text) {
      throw new Error(`Gemini response was empty or failed after retries: ${lastError?.message || 'Unknown error'}`);
    }

    // 6. Parse and Validate Response
    let rawJson: any;
    try {
      rawJson = JSON.parse(geminiResponse.text.trim());
    } catch (parseErr) {
      throw new Error(`Failed to parse structured JSON from Gemini: ${(parseErr as Error).message}`);
    }

    // Strict Schema Invariant Validation
    if (!rawJson || typeof rawJson !== 'object') {
      throw new Error('Malformed Gemini response: Root output is not an object.');
    }
    if (!rawJson.summary || typeof rawJson.summary !== 'string') {
      throw new Error('Schema validation error: Missing required summary string.');
    }
    if (rawJson.importanceScore === undefined || isNaN(Number(rawJson.importanceScore))) {
      throw new Error('Schema validation error: Missing valid numerical importanceScore.');
    }
    if (!rawJson.newsType || typeof rawJson.newsType !== 'string') {
      throw new Error('Schema validation error: Missing required newsType classification.');
    }
    if (!Array.isArray(rawJson.companies)) {
      rawJson.companies = [];
    }
    if (!Array.isArray(rawJson.products)) {
      rawJson.products = [];
    }
    if (!rawJson.competitiveRelevance || typeof rawJson.competitiveRelevance !== 'object') {
      rawJson.competitiveRelevance = { score: 30, reasons: [], categories: [], relatedCompanies: [] };
    }

    // 7. Entity Resolution against Canonical Registries
    const resolvedCompanies: AnalyzedCompany[] = [];
    const unresolvedCompanies: UnresolvedEntity[] = [];
    const entityReviewsToRecord: Array<{
      type: 'COMPANY' | 'PRODUCT';
      detectedName: string;
      category?: string;
      confidence: number;
      reason: string;
    }> = [];

    const now = new Date().toISOString();

    for (const c of rawJson.companies || []) {
      const compRes = resolveCompanySafe(c.name, canonicalCompanies);
      const relevance = (c.relevance || 'MENTION').toUpperCase() as AnalyzedCompany['relevance'];
      const confidence = typeof c.confidence === 'number' ? Math.min(Math.max(c.confidence, 0), 1) : 0.85;

      if (compRes.matchedCompany) {
        resolvedCompanies.push({
          companyId: compRes.matchedCompany.id,
          canonicalName: compRes.matchedCompany.name,
          matchedAlias: compRes.matchedAlias || c.name,
          relevance,
          confidence,
        });
      } else if (compRes.isRecognizedEcosystem) {
        // Recognized ecosystem/component/platform partner (Qualcomm, MediaTek, NVIDIA, Intel, AMD, Microsoft, Amazon, Netflix)
        // Suppress from EntityReview queue: keep in resolved companies without triggering review spam
        resolvedCompanies.push({
          canonicalName: c.name,
          matchedAlias: compRes.matchedAlias || c.name,
          relevance,
          confidence,
        });
      } else {
        // Unknown or unregistered OEM company: route to EntityReview
        resolvedCompanies.push({
          canonicalName: c.name,
          matchedAlias: c.name,
          relevance,
          confidence,
        });
        unresolvedCompanies.push({
          detectedName: c.name,
          confidence,
        });

        entityReviewsToRecord.push({
          type: 'COMPANY',
          detectedName: c.name,
          confidence,
          reason: 'UNRESOLVED_COMPANY',
        });
      }
    }

    const resolvedProducts: AnalyzedProduct[] = [];
    const unresolvedProducts: UnresolvedEntity[] = [];

    for (const p of rawJson.products || []) {
      const category = (p.category || 'OTHER').toUpperCase();
      const prodRes = resolveProductSafe(p.name, category, canonicalProducts);
      const relevance = (p.relevance || 'MENTION').toUpperCase() as AnalyzedProduct['relevance'];
      const confidence = typeof p.confidence === 'number' ? Math.min(Math.max(p.confidence, 0), 1) : 0.8;

      if (prodRes.matchedProduct) {
        resolvedProducts.push({
          productId: prodRes.matchedProduct.id,
          canonicalName: prodRes.matchedProduct.name,
          companyId: prodRes.matchedProduct.companyId,
          matchedText: prodRes.matchedAlias || p.name,
          category: prodRes.matchedProduct.category || category,
          subcategory: prodRes.matchedProduct.subcategory || p.subcategory,
          relevance,
          confidence,
        });
      } else if (prodRes.isNonDeviceConcept) {
        // Non-hardware concept (AI Software, Chipsets/Silicon, OS, non-tracked PC components)
        // Suppress from EntityReview queue: keep in analyzed products without triggering review spam
        resolvedProducts.push({
          canonicalName: p.name,
          companyId: undefined,
          matchedText: p.name,
          category: prodRes.nonDeviceCategory || category,
          subcategory: p.subcategory,
          relevance,
          confidence,
        });
      } else {
        // Genuinely unresolved strategic hardware product: route to EntityReview
        resolvedProducts.push({
          canonicalName: p.name,
          companyId: undefined,
          matchedText: p.name,
          category,
          subcategory: p.subcategory,
          relevance,
          confidence,
        });
        unresolvedProducts.push({
          detectedName: p.name,
          category,
          confidence,
        });

        entityReviewsToRecord.push({
          type: 'PRODUCT',
          detectedName: p.name,
          category,
          confidence,
          reason: 'UNRESOLVED_PRODUCT',
        });
      }
    }

    // 8. Construct Final ArticleAnalysis Object
    const analysis: ArticleAnalysis = {
      articleId,
      sourceId: article.sourceId,
      analysisVersion: SIGNALYN_ANALYSIS_VERSION,
      model: effectiveModel,
      analyzedAt: now,
      publishedAt: article.publishedAt || undefined,
      hasReliablePublishedAt: Boolean(article.publishedAt && !isNaN(new Date(article.publishedAt).getTime())),
      strategicCategory: relevance.category || undefined,
      language: article.language || 'en',
      market: article.market || 'Global',
      companies: resolvedCompanies,
      unresolvedCompanies: unresolvedCompanies.length > 0 ? unresolvedCompanies : undefined,
      products: resolvedProducts,
      unresolvedProducts: unresolvedProducts.length > 0 ? unresolvedProducts : undefined,
      topics: Array.isArray(rawJson.topics) ? rawJson.topics.slice(0, 12) : [],
      newsType: (rawJson.newsType || 'NEWS').toUpperCase() as NewsType,
      secondaryNewsTypes: Array.isArray(rawJson.secondaryNewsTypes)
        ? rawJson.secondaryNewsTypes.map((t: string) => t.toUpperCase() as NewsType)
        : undefined,
      sentiment: (rawJson.sentiment || 'NEUTRAL').toUpperCase() as SentimentType,
      sentimentConfidence:
        typeof rawJson.sentimentConfidence === 'number'
          ? Math.min(Math.max(rawJson.sentimentConfidence, 0), 1)
          : 0.8,
      importanceScore:
        typeof rawJson.importanceScore === 'number'
          ? Math.min(Math.max(Math.round(rawJson.importanceScore), 0), 100)
          : 50,
      summary: rawJson.summary || article.excerpt || article.title,
      keyPoints: Array.isArray(rawJson.keyPoints) && rawJson.keyPoints.length > 0
        ? rawJson.keyPoints.slice(0, 6)
        : [article.title],
      competitiveRelevance: {
        score:
          typeof rawJson.competitiveRelevance?.score === 'number'
            ? Math.min(Math.max(Math.round(rawJson.competitiveRelevance.score), 0), 100)
            : 40,
        reasons: Array.isArray(rawJson.competitiveRelevance?.reasons)
          ? rawJson.competitiveRelevance.reasons
          : [],
        categories: Array.isArray(rawJson.competitiveRelevance?.categories)
          ? rawJson.competitiveRelevance.categories
          : [],
        relatedCompanies: Array.isArray(rawJson.competitiveRelevance?.relatedCompanies)
          ? rawJson.competitiveRelevance.relatedCompanies
          : [],
      },
      competitiveSignals: Array.isArray(rawJson.competitiveSignals)
        ? rawJson.competitiveSignals.map((sig: any) => ({
            type: (sig.type || 'OTHER').toUpperCase(),
            company: sig.company || 'Unknown',
            product: sig.product || undefined,
            description: sig.description || '',
            confidence: typeof sig.confidence === 'number' ? sig.confidence : 0.8,
            evidence: sig.evidence ? String(sig.evidence).slice(0, 400) : undefined,
          }))
        : [],
      confidence:
        typeof rawJson.overallConfidence === 'number'
          ? Math.min(Math.max(rawJson.overallConfidence, 0), 1)
          : 0.85,
      processingMetadata: {
        executionTimeMs: Date.now() - startTime,
        inputTokens: geminiResponse.usageMetadata?.promptTokenCount,
        outputTokens: geminiResponse.usageMetadata?.candidatesTokenCount,
      },
    };

    // 9. Persist to Cloud Firestore in signalyn-5406e
    // A. Write /articleAnalysis/{articleId}
    await db.collection('articleAnalysis').doc(articleId).set(cleanServerData(analysis));

    // B. Write any unresolved entity reviews to /entityReview/{reviewId} (deduplicated)
    for (const rev of entityReviewsToRecord) {
      await recordEntityReview({
        entityType: rev.type,
        detectedName: rev.detectedName,
        category: rev.category,
        confidence: rev.confidence,
        articleId,
        articleTitle: article.title,
        reason: rev.reason,
      }).catch((e) => console.warn('Could not record entity review:', e));
    }

    // C. Update raw article processing lifecycle: PROCESSING → ANALYZED
    const attemptCount = (article.analysisAttemptCount || 0) + 1;
    await articleRef.update(cleanServerData({
      processingStatus: 'ANALYZED',
      analysisAttemptCount: attemptCount,
      retryEligible: false,
      lastAnalysisAttemptAt: now,
      analysisError: null,
      updatedAt: now,
      relevanceDecision: relevance.decision,
      relevanceCategory: relevance.category,
      relevanceReason: relevance.reason,
      relevanceEvaluatedAt: now,
      relevanceGateVersion: CURRENT_RELEVANCE_GATE_VERSION,
      relevanceMatchedKeywords: relevance.matchedKeywords,
      relevanceMatchedCompanies: relevance.matchedCompanies,
    }));

    // D. Incremental Story Assignment (Phase 4B.1)
    if (options?.autoCluster !== false) {
      try {
        await processArticleForStory(articleId);
      } catch (clusteringErr) {
        console.error(
          `[Incremental Story] Failed for article ${articleId} (isolated from Phase 3 success):`,
          clusteringErr
        );
      }
    }

    // E. Idempotent Historical Analytics Aggregate Update (Phase 5B)
    try {
      await recordArticleContributionInFirestore(analysis, article.publishedAt);
    } catch (aggErr) {
      console.warn(
        `[Historical Aggregation] Non-fatal aggregate contribution update failed for ${articleId}:`,
        aggErr
      );
    }

    const durationMs = Date.now() - startTime;
    console.log(
      `[Gemini Analysis] Successfully analyzed article ${articleId} in ${durationMs}ms (NewsType: ${analysis.newsType}, Score: ${analysis.importanceScore})`
    );

    return {
      success: true,
      articleId,
      analysis,
      durationMs,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startTime;

    // Quota protection block or 429 cooldown: keep article safely PENDING & retryEligible
    // without burning its attempt counter or marking it as a permanent failure.
    if (err instanceof GeminiQuotaExceededError) {
      console.warn(`[Gemini Analysis] Quota protection suspended article ${articleId}: ${err.userMessage}`);
      await articleRef.update(cleanServerData({
        processingStatus: 'PENDING',
        retryEligible: true,
        analysisError: err.userMessage.slice(0, 500),
        updatedAt: new Date().toISOString(),
      })).catch((e) => console.error('Failed to restore article to PENDING after quota suspension:', e));

      return {
        success: false,
        articleId,
        error: err.userMessage,
        quotaSuspended: true,
        quotaCode: err.code,
        durationMs,
      };
    }

    console.error(`[Gemini Analysis] Failed for article ${articleId}:`, errorMsg);

    // Classify transient vs permanent error
    const isTransient = /429|resource_exhausted|quota|rate limit|timeout|timed out|503|500|network|econnreset|etimedout/i.test(errorMsg);
    const isPermanent = /400|invalid_argument|safety|bad request|unsupported format|malformed/i.test(errorMsg);

    const attemptCount = (article.analysisAttemptCount || 0) + 1;
    const retryEligible = isTransient && !isPermanent && attemptCount < 3;

    // Fail-safe: Update article status to FAILED with attempt count and retry eligibility
    await articleRef.update(cleanServerData({
      processingStatus: 'FAILED',
      analysisError: errorMsg.slice(0, 500),
      analysisAttemptCount: attemptCount,
      retryEligible,
      lastAnalysisAttemptAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })).catch((e) => console.error('Failed to update article to FAILED state:', e));

    return {
      success: false,
      articleId,
      error: errorMsg,
      durationMs,
    };
  }
}

// ---------------------------------------------------------------------------
// Batch & Queue Processing
// ---------------------------------------------------------------------------

export interface BatchAnalysisResult {
  runId: string;
  totalAttempted: number;
  succeeded: number;
  skipped: number;
  failed: number;
  durationMs: number;
  results: AnalysisExecutionResult[];
  breakdown?: {
    pendingCandidates: number;
    recentCandidates: number;
    backlogCandidates: number;
    retriedCandidates: number;
    outOfScopeSkipped?: number;
    remainingPending: number;
  };
}

/**
 * Analyzes multiple articles with bounded concurrency (2 workers) to respect rate limits.
 */
export async function analyzeArticlesBatch(
  articleIds: string[],
  options?: { forceReanalyze?: boolean; trigger?: string }
): Promise<BatchAnalysisResult> {
  const startTime = Date.now();
  const runId = `airun-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
  const trigger = options?.trigger || 'BATCH';
  const results: AnalysisExecutionResult[] = [];

  console.log(`[Gemini Batch] Starting analysis for ${articleIds.length} articles (Run ID: ${runId})`);

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const errors: Array<{ articleId?: string; error: string }> = [];

  // Bounded concurrency pool: 2 at a time
  const concurrency = 2;
  const queue = [...articleIds];

  async function worker() {
    while (queue.length > 0) {
      const nextId = queue.shift();
      if (!nextId) break;

      try {
        const res = await analyzeArticle(nextId, {
          forceReanalyze: options?.forceReanalyze,
          trigger,
        });
        results.push(res);
        if (res.success) {
          if (res.skipped) {
            skipped++;
          } else {
            succeeded++;
            if (res.analysis?.processingMetadata?.inputTokens) {
              totalInputTokens += res.analysis.processingMetadata.inputTokens;
            }
            if (res.analysis?.processingMetadata?.outputTokens) {
              totalOutputTokens += res.analysis.processingMetadata.outputTokens;
            }
          }
        } else {
          failed++;
          errors.push({ articleId: nextId, error: res.error || 'Unknown analysis error' });
        }
      } catch (err: unknown) {
        failed++;
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push({ articleId: nextId, error: errMsg });
        results.push({
          success: false,
          articleId: nextId,
          error: errMsg,
          durationMs: 0,
        });
      }

      // Small 300ms pause between sequential worker calls to avoid tight burst loops
      await sleep(300);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, articleIds.length) }, () => worker());
  await Promise.all(workers);

  const durationMs = Date.now() - startTime;
  const completedAt = new Date().toISOString();

  // Persist AI run telemetry in /system/aiRuns/{runId}
  const aiRunRecord: AIRun = {
    id: runId,
    runId,
    startedAt: new Date(startTime).toISOString(),
    completedAt,
    model: GEMINI_ANALYSIS_MODEL,
    articlesAttempted: articleIds.length,
    articlesSucceeded: succeeded,
    articlesFailed: failed,
    estimatedInputTokens: totalInputTokens > 0 ? totalInputTokens : undefined,
    estimatedOutputTokens: totalOutputTokens > 0 ? totalOutputTokens : undefined,
    errors,
    triggeredBy: trigger,
  };

  const db = getServerDb();
  await db.collection('system').doc('aiRuns').collection('runs').doc(runId).set(cleanServerData(aiRunRecord)).catch(() => {
    return db.collection('system').doc(`aiRun-${runId}`).set(cleanServerData(aiRunRecord)).catch(() => {});
  });

  console.log(
    `[Gemini Batch] Completed batch run ${runId}: ${succeeded} succeeded, ${failed} failed in ${durationMs}ms`
  );

  return {
    runId,
    totalAttempted: articleIds.length,
    succeeded,
    skipped,
    failed,
    durationMs,
    results,
  };
}

/**
 * Finds, prioritizes, and analyzes articles needing intelligence processing.
 *
 * Implements Phase 6B backlog handling & strategic prioritization:
 * 1. Distinguishes new articles (published within last 48h) from historical backlog.
 * 2. Prioritizes recent strategically relevant articles to feed today's executive briefing.
 * 3. Prevents historical backlog from monopolizing per-run limits or delaying today's briefing.
 * 4. Selects candidate transient FAILED articles for controlled retry (backoff > 5m, attempts < 3).
 * 5. Strictly limits total analysis batch size to maxCount to respect bounded cost and token budgets.
 */
export async function analyzePendingArticles(
  maxCount = 10,
  options?: { trigger?: string; referenceDateIso?: string }
): Promise<BatchAnalysisResult> {
  const db = getServerDb();
  const nowMs = Date.now();
  const recentThresholdMs = nowMs - 48 * 60 * 60 * 1000; // 48 hours

  // Keywords that signal high strategic hardware relevance across 4 canonical domains (No PC/Macbook)
  const STRATEGIC_KEYWORDS_REGEX =
    /huawei|harmonyos|kirin|pura|matepad|freebuds|freeclip|apple|iphone|ipad|airpods|apple watch|samsung|galaxy|galaxy buds|galaxy watch|galaxy tab|galaxy ring|xiaomi|hyperos|redmi|poco|honor|magic|google pixel|pixel watch|pixel buds|pixel tablet|garmin|sony|bose|nothing|lenovo|oppo|vivo|motorola|foldable|wearable|smartwatch|smart ring|earbuds|tws|headphones|tablet|flagship/i;

  // 1. Fetch pending articles pool, prioritizing freshest items
  let candidateArticles: Article[] = [];
  try {
    const pendingSnap = await db.collection('articles')
      .where('processingStatus', '==', 'PENDING')
      .orderBy('publishedAt', 'desc')
      .limit(80)
      .get();
    pendingSnap.forEach((doc) => {
      candidateArticles.push(doc.data() as Article);
    });
  } catch {
    // Graceful fallback if composite index is pending: sort in memory
    const pendingSnap = await db.collection('articles')
      .where('processingStatus', '==', 'PENDING')
      .limit(80)
      .get();
    pendingSnap.forEach((doc) => {
      candidateArticles.push(doc.data() as Article);
    });
    candidateArticles.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  }

  const totalPendingInPool = candidateArticles.length;

  // 2. Fetch retry-eligible failed articles (controlled retry queue)
  const retryCandidates: Article[] = [];
  try {
    const failedSnap = await db.collection('articles')
      .where('processingStatus', '==', 'FAILED')
      .where('retryEligible', '==', true)
      .limit(10)
      .get();

    failedSnap.forEach((doc) => {
      const art = doc.data() as Article;
      const lastAttemptMs = art.lastAnalysisAttemptAt ? new Date(art.lastAnalysisAttemptAt).getTime() : 0;
      // Enforce at least 5 minutes backoff and strictly fewer than 3 attempts
      if (nowMs - lastAttemptMs > 5 * 60 * 1000 && (art.analysisAttemptCount || 0) < 3) {
        retryCandidates.push(art);
      }
    });
  } catch (err) {
    console.warn('[Gemini Analysis] Notice querying retry-eligible failed articles:', err);
  }

  // 3. Triage pending articles & score genuinely in-scope candidates
  interface ScoredCandidate {
    article: Article;
    score: number;
    isRecent: boolean;
    isRetry: boolean;
  }

  const scored: ScoredCandidate[] = [];
  let outOfScopeFilteredCount = 0;

  for (const art of candidateArticles) {
    // Fast deterministic strategic relevance evaluation (P0.3)
    const rel = classifyStrategicRelevance({
      title: art.title,
      excerpt: art.excerpt,
      rawCategories: art.rawCategories,
      sourceName: art.sourceName,
      canonicalUrl: art.canonicalUrl,
    });

    if (rel.decision === 'OUT_OF_SCOPE') {
      // Transition out-of-scope article to SKIPPED_STRATEGIC_SCOPE so it leaves PENDING queue permanently
      db.collection('articles').doc(art.id).update(cleanServerData({
        processingStatus: 'SKIPPED_STRATEGIC_SCOPE',
        relevanceDecision: 'OUT_OF_SCOPE',
        relevanceCategory: rel.category,
        relevanceReason: rel.reason,
        relevanceEvaluatedAt: new Date().toISOString(),
        relevanceGateVersion: CURRENT_RELEVANCE_GATE_VERSION,
        relevanceMatchedKeywords: rel.matchedKeywords,
        relevanceMatchedCompanies: rel.matchedCompanies,
        needsReanalysis: false,
      })).catch((e) => console.warn(`Notice updating out-of-scope article ${art.id}:`, e));
      outOfScopeFilteredCount++;
      continue;
    }

    const pubMs = art.publishedAt ? new Date(art.publishedAt).getTime() : 0;
    const isRecent = pubMs >= recentThresholdMs;
    const hasKeywords = STRATEGIC_KEYWORDS_REGEX.test(art.title) || STRATEGIC_KEYWORDS_REGEX.test(art.excerpt || '');
    const isHuawei = /huawei|harmonyos|kirin|pura|matepad|freebuds|freeclip/i.test(art.title);

    let score = 20; // baseline in-scope backlog
    if (isRecent && hasKeywords) {
      score = 100; // top priority: fresh + strategic
    } else if (isRecent) {
      score = 80; // high priority: fresh in-scope
    } else if (hasKeywords) {
      score = 50; // medium priority: backlog with strategic keywords
    }

    // Extra prioritization for primary target HUAWEI
    if (isHuawei) {
      score += 40;
    }

    scored.push({ article: art, score, isRecent, isRetry: false });
  }

  // Add retry candidates (limited to max 2 retries per run to preserve budget)
  for (const art of retryCandidates.slice(0, 2)) {
    const pubMs = art.publishedAt ? new Date(art.publishedAt).getTime() : 0;
    const isRecent = pubMs >= recentThresholdMs;
    scored.push({
      article: art,
      score: isRecent ? 60 : 30,
      isRecent,
      isRetry: true,
    });
  }

  // Sort: highest score first, then newest publishedAt
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aTime = a.article.publishedAt ? new Date(a.article.publishedAt).getTime() : 0;
    const bTime = b.article.publishedAt ? new Date(b.article.publishedAt).getTime() : 0;
    return bTime - aTime;
  });

  const selectedCandidates = scored.slice(0, maxCount);
  const selectedIds = selectedCandidates.map((s) => s.article.id);

  const recentCount = selectedCandidates.filter((s) => s.isRecent && !s.isRetry).length;
  const backlogCount = selectedCandidates.filter((s) => !s.isRecent && !s.isRetry).length;
  const retriedCount = selectedCandidates.filter((s) => s.isRetry).length;
  const remainingPending = Math.max(0, scored.length - (selectedCandidates.length - retriedCount));

  if (selectedIds.length === 0) {
    return {
      runId: 'none',
      totalAttempted: 0,
      succeeded: 0,
      skipped: outOfScopeFilteredCount,
      failed: 0,
      durationMs: 0,
      results: [],
      breakdown: {
        pendingCandidates: totalPendingInPool,
        recentCandidates: 0,
        backlogCandidates: 0,
        retriedCandidates: 0,
        outOfScopeSkipped: outOfScopeFilteredCount,
        remainingPending: 0,
      },
    };
  }

  console.log(
    `[Gemini Analysis Prioritization] Selected ${selectedIds.length}/${maxCount} articles (Recent: ${recentCount}, Backlog: ${backlogCount}, Retries: ${retriedCount}, Out-of-Scope Filtered: ${outOfScopeFilteredCount}, Remaining Pending: ${remainingPending})`
  );

  const batchResult = await analyzeArticlesBatch(selectedIds, {
    forceReanalyze: false,
    trigger: options?.trigger || 'PRIORITIZED_QUEUE',
  });

  batchResult.breakdown = {
    pendingCandidates: totalPendingInPool,
    recentCandidates: recentCount,
    backlogCandidates: backlogCount,
    retriedCandidates: retriedCount,
    outOfScopeSkipped: outOfScopeFilteredCount,
    remainingPending,
  };

  return batchResult;
}
