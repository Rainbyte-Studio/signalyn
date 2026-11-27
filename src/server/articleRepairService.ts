/**
 * Signalyn Article Text Normalization & Repair Service
 * 
 * Implements controlled one-time repair / migration for existing articles
 * where title, excerpt, author, or other textual fields contain raw HTML entities
 * (hexadecimal e.g. &#x3A4;, decimal e.g. &#932;, named e.g. &amp;, double-encoded e.g. &amp;#x3A4;).
 * 
 * Safely decodes text into native Unicode (NFC), recomputes contentHash,
 * preserves all original metadata (ID, sourceId, publishedAt, collectedAt),
 * avoids duplicates, and flags articles with existing AI analysis for re-analysis.
 */

import { getServerDb, cleanServerData } from './serverFirestoreAdapter';
import { Article, ArticleAnalysis } from '../types';
import { normalizeArticleText, decodeHtmlEntities } from '../utils/textNormalizer';
import { generateContentHash } from './urlNormalizer';

export function containsHtmlEntities(text: string | null | undefined): boolean {
  if (!text || typeof text !== 'string') return false;
  return text.includes('&#') || /&(?:amp|quot|apos|lt|gt|nbsp|[a-zA-Z]{2,12});/i.test(text);
}

export interface RepairArticlesReport {
  totalScanned: number;
  totalNeedingRepair: number;
  totalRepaired: number;
  totalFailed: number;
  totalAnalysesMarkedForReanalysis: number;
  repairedArticleIds: string[];
  errors: { articleId: string; error: string }[];
  durationMs: number;
}

/**
 * Executes a controlled batch repair of corrupted articles in Firestore.
 */
export async function repairCorruptedArticles(options: { maxArticles?: number } = {}): Promise<RepairArticlesReport> {
  const startTime = Date.now();
  const maxArticles = options.maxArticles || 500;

  const report: RepairArticlesReport = {
    totalScanned: 0,
    totalNeedingRepair: 0,
    totalRepaired: 0,
    totalFailed: 0,
    totalAnalysesMarkedForReanalysis: 0,
    repairedArticleIds: [],
    errors: [],
    durationMs: 0,
  };

  try {
    const db = getServerDb();
    console.log('[Article Repair] Scanning Firestore articles collection with cursor pagination (P1.4)...');
    const PAGE_SIZE = 150;
    let lastVisible: any = null;
    let totalScanned = 0;
    const candidateDocs: { id: string; data: Article }[] = [];

    while (totalScanned < maxArticles) {
      const pageLimit = Math.min(PAGE_SIZE, maxArticles - totalScanned);
      let pageQuery = db.collection('articles')
        .orderBy('collectedAt', 'desc')
        .limit(pageLimit);
      if (lastVisible) {
        pageQuery = pageQuery.startAfter(lastVisible);
      }

      let pageSnap;
      try {
        pageSnap = await pageQuery.get();
      } catch {
        // Fallback without ordering in case index is not ready
        let fallbackQuery = db.collection('articles').limit(pageLimit);
        if (lastVisible) {
          fallbackQuery = fallbackQuery.startAfter(lastVisible);
        }
        pageSnap = await fallbackQuery.get();
      }

      if (pageSnap.empty) break;

      totalScanned += pageSnap.size;
      lastVisible = pageSnap.docs[pageSnap.docs.length - 1];

      pageSnap.forEach((docSnap) => {
        const data = docSnap.data() as Article;
        const titleCorrupted = containsHtmlEntities(data.title);
        const excerptCorrupted = containsHtmlEntities(data.excerpt);
        const authorCorrupted = containsHtmlEntities(data.author);
        const sourceNameCorrupted = containsHtmlEntities(data.sourceName);

        if (titleCorrupted || excerptCorrupted || authorCorrupted || sourceNameCorrupted) {
          candidateDocs.push({ id: docSnap.id, data });
        }
      });

      if (pageSnap.size < pageLimit) break;
    }

    report.totalScanned = totalScanned;
    report.totalNeedingRepair = candidateDocs.length;
    console.log(`[Article Repair] Found ${report.totalNeedingRepair} articles requiring text normalization.`);

    if (candidateDocs.length === 0) {
      report.durationMs = Date.now() - startTime;
      return report;
    }

    const toProcess = candidateDocs.slice(0, maxArticles);

    // Load existing analyses only for affected candidate articles (bounded point reads, P1.4)
    const analysisMap = new Map<string, ArticleAnalysis>();
    for (const item of toProcess) {
      try {
        const anSnap = await db.collection('articleAnalysis').doc(item.id).get();
        if (anSnap.exists) {
          analysisMap.set(item.id, anSnap.data() as ArticleAnalysis);
        }
      } catch {
        // non-fatal
      }
    }

    // Process in batches of 50 using Firestore writeBatch
    const BATCH_SIZE = 50;
    for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
      const chunk = toProcess.slice(i, i + BATCH_SIZE);
      const batch = db.batch();

      for (const item of chunk) {
        const article = item.data;
        const articleId = item.id;

        try {
          // 1. Decode & normalize text fields
          const cleanTitle = normalizeArticleText(article.title, { maxLength: 500 });
          const cleanExcerpt = normalizeArticleText(article.excerpt, { maxLength: 5000 });
          const cleanAuthor = article.author
            ? normalizeArticleText(article.author, { maxLength: 200 })
            : undefined;
          const cleanSourceName = article.sourceName
            ? normalizeArticleText(article.sourceName, { maxLength: 200 })
            : undefined;

          // 2. Language detection / verification:
          // If Greek characters are present in title or excerpt, ensure language is 'el'
          let language = article.language || 'en';
          const hasGreekCharacters = /[\u0370-\u03FF]/.test(cleanTitle) || /[\u0370-\u03FF]/.test(cleanExcerpt);
          if (hasGreekCharacters || article.sourceId.includes('insomnia') || article.market === 'Greece') {
            language = 'el';
          }

          // 3. Recompute contentHash using canonical normalization
          const newContentHash = generateContentHash(
            article.canonicalUrl,
            cleanTitle,
            article.publishedAt,
            cleanExcerpt
          );

          // 4. Check if existing AI Analysis exists for this article
          let needsReanalysis = false;
          const existingAnalysis = analysisMap.get(articleId);
          if (existingAnalysis) {
            if (
              containsHtmlEntities(existingAnalysis.summary) ||
              containsHtmlEntities(JSON.stringify(existingAnalysis.topics || [])) ||
              containsHtmlEntities(JSON.stringify(existingAnalysis.companies || []))
            ) {
              needsReanalysis = true;
              report.totalAnalysesMarkedForReanalysis++;
              console.log(`[Article Repair] Flagged article ${articleId} analysis for re-analysis.`);
            }
          }

          // 5. Build clean update payload (strictly preserving original ID, sourceId, publishedAt, collectedAt)
          const updates: Partial<Article> & Record<string, any> = {
            title: cleanTitle,
            excerpt: cleanExcerpt,
            contentHash: newContentHash,
            language,
            updatedAt: new Date().toISOString(),
            sourceId: article.sourceId,
            canonicalUrl: article.canonicalUrl,
            publishedAt: article.publishedAt,
            collectedAt: article.collectedAt,
          };

          if (cleanAuthor !== undefined) updates.author = cleanAuthor;
          if (cleanSourceName !== undefined) updates.sourceName = cleanSourceName;
          if (needsReanalysis) {
            updates.processingStatus = 'PENDING';
            updates.needsReanalysis = true;
          }

          batch.update(db.collection('articles').doc(articleId), cleanServerData(updates));
          report.totalRepaired++;
          report.repairedArticleIds.push(articleId);
        } catch (itemErr: unknown) {
          const msg = itemErr instanceof Error ? itemErr.message : 'Unknown repair error';
          report.totalFailed++;
          report.errors.push({ articleId, error: msg });
        }
      }

      await batch.commit();
      console.log(`[Article Repair] Committed batch ${Math.floor(i / BATCH_SIZE) + 1} (${chunk.length} articles).`);
    }

    console.log(
      `[Article Repair] Completed. Repaired ${report.totalRepaired}/${report.totalNeedingRepair} articles in ${Date.now() - startTime}ms.`
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Fatal repair scan failure';
    console.error('[Article Repair] Fatal error during scan:', errorMsg);
  }

  report.durationMs = Date.now() - startTime;
  return report;
}
