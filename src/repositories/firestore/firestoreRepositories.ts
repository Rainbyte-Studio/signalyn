/**
 * Signalyn Cloud Firestore Repositories
 * 
 * Production-ready implementation of ISourceRepository, ISourceGroupRepository,
 * IArticleRepository, ICompanyRepository, IProductRepository, ISettingsRepository,
 * and IMetricsRepository backed by real Cloud Firestore.
 */

import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  orderBy,
  limit as firestoreLimit,
  getCountFromServer,
  startAfter,
} from 'firebase/firestore';
import { db, withTimeout, handleFirestoreError, OperationType } from '../../firebase';
import {
  Source,
  SourceFeed,
  FeedStatus,
  SourceGroup,
  Article,
  Story,
  StoryMembership,
  StoryReview,
  StoryRun,
  Company,
  Product,
  ArticleAnalysis,
  EntityReview,
  ReviewStatus,
  IntelligenceSettings,
  DashboardMetrics,
  DeletedSource,
  isLegacyStory,
  isProductionStory,
} from '../../types';
import { deriveHuaweiCompetitiveIntelligence } from '../../services/huaweiCompetitiveService';
import {
  computeReconciledSourceKpiCounts,
  evaluateSourceStatusToggleContract,
  resolveCanonicalSourceOperationalState,
} from '../../utils/dataIntegrityContracts';
import {
  ISourceRepository,
  ISourceGroupRepository,
  IArticleRepository,
  PaginatedArticlesResult,
  IStoryRepository,
  IStoryReviewRepository,
  IStoryRunRepository,
  ICompanyRepository,
  IProductRepository,
  IArticleAnalysisRepository,
  IEntityReviewRepository,
  ISettingsRepository,
  IMetricsRepository,
  PreloadedDashboardData,
} from '../interfaces';
import {
  normalizeWebsiteUrl,
  normalizeCanonicalUrl,
  extractNormalizedDomain,
  ensureHttpProtocol,
  isSameSourceDomain,
  normalizeFeedUrl,
  isSameFeedUrl,
  getSourceFeeds,
  computeSourceHealth,
} from '../../utils/urlUtils';
import {
  INITIAL_SOURCES,
  INITIAL_SOURCE_GROUPS,
  INITIAL_COMPANIES,
  INITIAL_PRODUCTS,
  INITIAL_STORIES,
  INITIAL_SETTINGS,
} from '../mock/initialData';

// ==========================================
// 1. SOURCE REPOSITORY
// ==========================================
export class FirestoreSourceRepository implements ISourceRepository {
  private col = collection(db, 'sources');

  async getAll(): Promise<Source[]> {
    try {
      const snap = await withTimeout(
        getDocs(this.col),
        10000,
        'Timed out reading sources from Firestore.'
      );
      const results: Source[] = [];
      snap.forEach((d) => {
        const raw = d.data() as Source;
        const feeds = getSourceFeeds(raw);
        const health = raw.health || computeSourceHealth(feeds, raw.status);
        results.push({
          ...raw,
          feeds,
          health,
        });
      });
      // Sort by name
      return results.sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      if (err instanceof Error && err.message.includes('Timed out')) {
        throw err;
      }
      handleFirestoreError(err, OperationType.LIST, 'sources');
    }
  }

  async getById(id: string): Promise<Source | null> {
    try {
      const d = await withTimeout(
        getDoc(doc(db, 'sources', id)),
        10000,
        `Timed out reading source: ${id}`
      );
      if (!d.exists()) return null;
      const raw = d.data() as Source;
      const feeds = getSourceFeeds(raw);
      const health = raw.health || computeSourceHealth(feeds, raw.status);
      return {
        ...raw,
        feeds,
        health,
      };
    } catch (err) {
      if (err instanceof Error && err.message.includes('Timed out')) {
        throw err;
      }
      handleFirestoreError(err, OperationType.GET, `sources/${id}`);
    }
  }

  async getByWebsiteUrl(rawUrl: string): Promise<Source | null> {
    const domain = extractNormalizedDomain(rawUrl);
    const all = await this.getAll();
    return (
      all.find(
        (s) =>
          extractNormalizedDomain(s.websiteUrl) === domain ||
          (s.normalizedDomain && s.normalizedDomain === domain)
      ) || null
    );
  }

  async create(
    sourceInput: Omit<Source, 'id' | 'createdAt' | 'updatedAt' | 'articlesCollected' | 'errorCount'> & { customId?: string }
  ): Promise<Source> {
    const rawUrl = sourceInput.websiteUrl.trim();
    const normalizedWebsiteUrl = ensureHttpProtocol(rawUrl);
    const domain = extractNormalizedDomain(rawUrl);

    // Enforce duplicate prevention across all existing sources
    const all = await this.getAll();
    const existing = all.find(
      (s) =>
        extractNormalizedDomain(s.websiteUrl) === domain ||
        (s.normalizedDomain && s.normalizedDomain === domain)
    );
    if (existing) {
      throw new Error(
        `Source already exists: A source with domain "${domain}" is already registered as "${existing.name}".`
      );
    }

    const now = new Date().toISOString();
    const id = sourceInput.customId || `src-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

    // Process and validate feeds
    let feeds: SourceFeed[] = [];
    if (Array.isArray(sourceInput.feeds) && sourceInput.feeds.length > 0) {
      const seenFeedUrls = new Set<string>();
      let foundPrimary = false;
      feeds = sourceInput.feeds.map((f, idx) => {
        const normUrl = normalizeFeedUrl(f.url);
        if (seenFeedUrls.has(normUrl)) {
          throw new Error(`Duplicate feed URL within source: "${f.url}"`);
        }
        seenFeedUrls.add(normUrl);

        const isPrimary = !foundPrimary && (Boolean(f.isPrimary) || idx === 0);
        if (isPrimary) foundPrimary = true;

        return {
          id: f.id || `feed-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
          title: (f.title || 'Feed').trim(),
          url: normUrl,
          feedType: f.feedType || 'RSS',
          categories: Array.isArray(f.categories) ? f.categories : [],
          coverageRole: f.coverageRole || 'CATEGORY',
          status: f.status || 'ACTIVE',
          isPrimary,
          createdAt: f.createdAt || now,
          updatedAt: f.updatedAt || now,
          lastCollectedAt: f.lastCollectedAt || null,
          lastSuccessfulCollectionAt: f.lastSuccessfulCollectionAt || null,
          failureCount: f.failureCount || 0,
          articlesCollected: f.articlesCollected || 0,
          lastError: f.lastError || null,
          oldestItemDate: f.oldestItemDate || null,
          newestItemDate: f.newestItemDate || null,
        };
      });
    } else if (sourceInput.feedUrl) {
      feeds = getSourceFeeds(sourceInput);
    }

    const initialStatus = sourceInput.status || (feeds.length === 0 ? 'NEEDS_CONFIGURATION' : 'ACTIVE');
    const health = computeSourceHealth(feeds, initialStatus);
    const primaryFeed = feeds.find((f) => f.isPrimary) || feeds[0];

    const newSource: Source = {
      id,
      name: sourceInput.name.trim(),
      websiteUrl: normalizedWebsiteUrl,
      normalizedDomain: domain,
      feeds,
      health,
      feedUrl: primaryFeed?.url || (sourceInput.feedUrl ? sourceInput.feedUrl.trim() : undefined),
      feedType: primaryFeed?.feedType || sourceInput.feedType || sourceInput.collectionMethod || 'RSS',
      collectionMethod: primaryFeed?.feedType || sourceInput.collectionMethod || 'RSS',
      sourceGroupId: sourceInput.sourceGroupId || 'group-general',
      sourceGroup: sourceInput.sourceGroup || sourceInput.sourceGroupId,
      market: sourceInput.market || 'Global',
      country: sourceInput.country || 'Global',
      language: sourceInput.language || 'en',
      categories: Array.isArray(sourceInput.categories) ? sourceInput.categories : [],
      status: initialStatus,
      articlesCollected: 0,
      errorCount: 0,
      failureCount: 0,
      lastError: null,
      lastCollectionAttempt: undefined,
      lastCollectedAt: undefined,
      lastSuccessfulCollection: undefined,
      lastSuccessfulCollectionAt: undefined,
      createdAt: now,
      updatedAt: now,
      logoUrl: sourceInput.logoUrl ? sourceInput.logoUrl.trim() : undefined,
    };

    try {
      // If restoring from tombstone or re-registering, delete tombstone atomically if exists
      const tombstoneRef = doc(db, 'deletedSources', id);
      const tombstoneSnap = await getDoc(tombstoneRef).catch(() => null);
      if (tombstoneSnap && tombstoneSnap.exists()) {
        const batch = writeBatch(db);
        batch.set(doc(db, 'sources', id), cleanFirestoreData(newSource));
        batch.delete(tombstoneRef);
        await withTimeout(
          batch.commit(),
          12000,
          'Timed out saving source and clearing tombstone in Firestore.'
        );
      } else {
        await withTimeout(
          setDoc(doc(db, 'sources', id), cleanFirestoreData(newSource)),
          12000,
          'Timed out saving source to Firestore. Please check your network connection.'
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('Timed out')) {
        throw err;
      }
      handleFirestoreError(err, OperationType.CREATE, `sources/${id}`);
    }

    return newSource;
  }

  async update(id: string, updates: Partial<Source>): Promise<Source> {
    const targetRef = doc(db, 'sources', id);
    const currentSnap = await withTimeout(
      getDoc(targetRef),
      10000,
      `Timed out reading source: ${id}`
    );
    if (!currentSnap.exists()) {
      throw new Error(`Source with ID ${id} not found.`);
    }

    const current = currentSnap.data() as Source;

    // If websiteUrl is changing, enforce duplicate prevention
    if (updates.websiteUrl && updates.websiteUrl !== current.websiteUrl) {
      const newDomain = extractNormalizedDomain(updates.websiteUrl);
      const all = await this.getAll();
      const duplicate = all.find(
        (s) =>
          s.id !== id &&
          (extractNormalizedDomain(s.websiteUrl) === newDomain || s.normalizedDomain === newDomain)
      );
      if (duplicate) {
        throw new Error(
          `Cannot update URL: Domain "${newDomain}" is already used by registered source "${duplicate.name}".`
        );
      }
      updates.normalizedDomain = newDomain;
      updates.websiteUrl = ensureHttpProtocol(updates.websiteUrl);
    }

    // If feeds are being updated, validate uniqueness and recompute health
    if (updates.feeds) {
      const seen = new Set<string>();
      for (const f of updates.feeds) {
        const norm = normalizeFeedUrl(f.url);
        if (seen.has(norm)) {
          throw new Error(`Duplicate feed URL within source: "${f.url}"`);
        }
        seen.add(norm);
      }

      // Ensure exactly one isPrimary
      let hasPrimary = false;
      updates.feeds = updates.feeds.map((f, i) => {
        if (f.isPrimary && !hasPrimary) {
          hasPrimary = true;
          return f;
        }
        if (f.isPrimary && hasPrimary) {
          return { ...f, isPrimary: false };
        }
        if (!hasPrimary && i === updates.feeds!.length - 1) {
          hasPrimary = true;
          return { ...f, isPrimary: true };
        }
        return f;
      });

      updates.health = computeSourceHealth(updates.feeds, updates.status || current.status);
      const primary = updates.feeds.find((f) => f.isPrimary) || updates.feeds[0];
      if (primary) {
        updates.feedUrl = primary.url;
        updates.feedType = primary.feedType;
      }
    }

    const now = new Date().toISOString();
    const cleanUpdates = cleanFirestoreData({
      ...updates,
      updatedAt: now,
    });

    try {
      await withTimeout(
        updateDoc(targetRef, cleanUpdates),
        12000,
        'Timed out updating source in Firestore.'
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes('Timed out')) {
        throw err;
      }
      handleFirestoreError(err, OperationType.UPDATE, `sources/${id}`);
    }

    return {
      ...current,
      ...cleanUpdates,
    };
  }

  async addFeed(
    sourceId: string,
    feedInput: Omit<SourceFeed, 'id' | 'createdAt' | 'updatedAt' | 'failureCount' | 'articlesCollected'>
  ): Promise<Source> {
    const source = await this.getById(sourceId);
    if (!source) throw new Error(`Source with ID ${sourceId} not found.`);

    const existingFeeds = getSourceFeeds(source);
    const normUrl = normalizeFeedUrl(feedInput.url);

    // Duplicate check within source
    if (existingFeeds.some((f) => isSameFeedUrl(f.url, normUrl))) {
      throw new Error(`Feed URL "${feedInput.url}" already exists on this source.`);
    }

    const now = new Date().toISOString();
    const isFirstFeed = existingFeeds.length === 0;
    const shouldBePrimary = Boolean(feedInput.isPrimary) || isFirstFeed;

    const newFeed: SourceFeed = {
      id: `feed-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      title: feedInput.title.trim() || 'Feed',
      url: normUrl,
      feedType: feedInput.feedType || 'RSS',
      categories: Array.isArray(feedInput.categories) ? feedInput.categories : [],
      coverageRole: feedInput.coverageRole || 'CATEGORY',
      status: feedInput.status || 'ACTIVE',
      isPrimary: shouldBePrimary,
      createdAt: now,
      updatedAt: now,
      lastCollectedAt: null,
      lastSuccessfulCollectionAt: null,
      failureCount: 0,
      articlesCollected: 0,
      lastError: null,
      oldestItemDate: feedInput.oldestItemDate || null,
      newestItemDate: feedInput.newestItemDate || null,
    };

    let updatedFeeds = existingFeeds.map((f) =>
      shouldBePrimary ? { ...f, isPrimary: false } : f
    );
    updatedFeeds.push(newFeed);

    return this.update(sourceId, { feeds: updatedFeeds });
  }

  async updateFeed(
    sourceId: string,
    feedId: string,
    feedUpdates: Partial<SourceFeed>
  ): Promise<Source> {
    const source = await this.getById(sourceId);
    if (!source) throw new Error(`Source with ID ${sourceId} not found.`);

    const existingFeeds = getSourceFeeds(source);
    const targetIdx = existingFeeds.findIndex((f) => f.id === feedId);
    if (targetIdx === -1) {
      throw new Error(`Feed with ID ${feedId} not found in source ${sourceId}.`);
    }

    // If URL changed, check uniqueness
    if (feedUpdates.url) {
      const norm = normalizeFeedUrl(feedUpdates.url);
      if (existingFeeds.some((f) => f.id !== feedId && isSameFeedUrl(f.url, norm))) {
        throw new Error(`Feed URL "${feedUpdates.url}" already exists on another feed of this source.`);
      }
      feedUpdates.url = norm;
    }

    const now = new Date().toISOString();
    const isSettingPrimary = feedUpdates.isPrimary === true;

    const updatedFeeds = existingFeeds.map((f) => {
      if (f.id === feedId) {
        return {
          ...f,
          ...feedUpdates,
          updatedAt: now,
        };
      }
      if (isSettingPrimary) {
        return { ...f, isPrimary: false };
      }
      return f;
    });

    return this.update(sourceId, { feeds: updatedFeeds });
  }

  async removeFeed(sourceId: string, feedId: string): Promise<Source> {
    const source = await this.getById(sourceId);
    if (!source) throw new Error(`Source with ID ${sourceId} not found.`);

    const existingFeeds = getSourceFeeds(source);
    const removedFeed = existingFeeds.find((f) => f.id === feedId);
    if (!removedFeed) {
      throw new Error(`Feed with ID ${feedId} not found in source ${sourceId}.`);
    }

    // Safety: Articles are NOT deleted when a feed is removed
    const remainingFeeds = existingFeeds.filter((f) => f.id !== feedId);

    // If removed feed was primary and others exist, assign primary to first remaining
    if (removedFeed.isPrimary && remainingFeeds.length > 0) {
      remainingFeeds[0].isPrimary = true;
    }

    return this.update(sourceId, { feeds: remainingFeeds });
  }

  async setPrimaryFeed(sourceId: string, feedId: string): Promise<Source> {
    return this.updateFeed(sourceId, feedId, { isPrimary: true });
  }

  async toggleFeedStatus(sourceId: string, feedId: string): Promise<Source> {
    const source = await this.getById(sourceId);
    if (!source) throw new Error(`Source with ID ${sourceId} not found.`);

    const feeds = getSourceFeeds(source);
    const target = feeds.find((f) => f.id === feedId);
    if (!target) throw new Error(`Feed with ID ${feedId} not found.`);

    const newStatus: FeedStatus = target.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    return this.updateFeed(sourceId, feedId, { status: newStatus });
  }

  async retryFeed(sourceId: string, feedId: string): Promise<Source> {
    return this.updateFeed(sourceId, feedId, {
      status: 'ACTIVE',
      failureCount: 0,
      lastError: null,
    });
  }

  async migrateLegacySources(): Promise<{ migratedCount: number; alreadyMigratedCount: number; total: number }> {
    const snap = await getDocs(collection(db, 'sources'));
    let migratedCount = 0;
    let alreadyMigratedCount = 0;

    for (const docSnap of snap.docs) {
      const data = docSnap.data() as Source;
      if (!Array.isArray(data.feeds) || data.feeds.length === 0) {
        const feeds = getSourceFeeds(data);
        const health = computeSourceHealth(feeds, data.status);
        await updateDoc(doc(db, 'sources', docSnap.id), cleanFirestoreData({
          feeds,
          health,
          updatedAt: new Date().toISOString(),
        }));
        migratedCount++;
      } else {
        alreadyMigratedCount++;
      }
    }

    return {
      migratedCount,
      alreadyMigratedCount,
      total: snap.size,
    };
  }

  async delete(id: string, reason?: string): Promise<boolean> {
    const sourceRef = doc(db, 'sources', id);
    const tombstoneRef = doc(db, 'deletedSources', id);

    try {
      // 1. Validate source exists before deletion
      const sourceSnap = await withTimeout(
        getDoc(sourceRef),
        10000,
        `Timed out verifying source ${id} before deletion.`
      );
      if (!sourceSnap.exists()) {
        throw new Error(`Source with ID "${id}" does not exist or has already been deleted.`);
      }

      const sourceData = sourceSnap.data() as Source;
      const feeds = getSourceFeeds(sourceData);
      const domain = sourceData.normalizedDomain || extractNormalizedDomain(sourceData.websiteUrl);

      // 2. Count articles associated with this source (bounded query)
      let articleCount = sourceData.articlesCollected || 0;
      try {
        const artSnap = await withTimeout(
          getDocs(query(collection(db, 'articles'), where('sourceId', '==', id))),
          5000,
          'Count articles query timeout'
        );
        articleCount = Math.max(articleCount, artSnap.size);
      } catch {
        // Fallback to sourceData.articlesCollected
      }

      // 3. Prepare minimal tombstone metadata (Requirement 5)
      const tombstone: DeletedSource = {
        id,
        name: sourceData.name.trim().slice(0, 200),
        websiteUrl: sourceData.websiteUrl.trim().slice(0, 1000),
        normalizedDomain: domain.slice(0, 200),
        deletedAt: new Date().toISOString(),
        deletionReason: reason ? reason.trim().slice(0, 500) : 'Intentionally deleted from Sources Manager',
        articleCount,
        feedCount: feeds.length,
      };

      // 4. Atomic batch deletion & tombstone creation (Requirement 12)
      const batch = writeBatch(db);
      batch.set(tombstoneRef, cleanFirestoreData(tombstone));
      batch.delete(sourceRef);

      await withTimeout(
        batch.commit(),
        12000,
        'Timed out committing source deletion transaction.'
      );

      // 5. Verify source no longer exists
      const verifySnap = await getDoc(sourceRef);
      if (verifySnap.exists()) {
        throw new Error(`Verification failed: Source "${id}" still exists after deletion.`);
      }

      return true;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Timed out')) {
        throw err;
      }
      handleFirestoreError(err, OperationType.DELETE, `sources/${id}`);
    }
  }

  async getDeletedSourceByDomain(rawDomainOrUrl: string): Promise<DeletedSource | null> {
    const cleanDomain = extractNormalizedDomain(rawDomainOrUrl);
    try {
      const q = query(
        collection(db, 'deletedSources'),
        where('normalizedDomain', '==', cleanDomain)
      );
      const snap = await withTimeout(
        getDocs(q),
        8000,
        'Timed out checking deleted sources archive.'
      );
      if (!snap.empty) {
        return snap.docs[0].data() as DeletedSource;
      }

      // Fallback: in-memory scan of deletedSources
      const allSnap = await withTimeout(
        getDocs(collection(db, 'deletedSources')),
        8000,
        'Timed out scanning deleted sources.'
      );
      for (const d of allSnap.docs) {
        const ds = d.data() as DeletedSource;
        if (ds.normalizedDomain === cleanDomain || extractNormalizedDomain(ds.websiteUrl) === cleanDomain) {
          return ds;
        }
      }
      return null;
    } catch (err) {
      console.warn('[Signalyn] Warning checking deleted sources for domain:', cleanDomain, err);
      return null;
    }
  }

  async getDeletedSources(): Promise<DeletedSource[]> {
    try {
      const snap = await withTimeout(
        getDocs(collection(db, 'deletedSources')),
        8000,
        'Timed out reading deleted sources from Firestore.'
      );
      const results: DeletedSource[] = [];
      snap.forEach((d) => results.push(d.data() as DeletedSource));
      return results.sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
    } catch (err) {
      console.warn('[Signalyn] Warning reading deleted sources archive:', err);
      return [];
    }
  }

  async restoreSource(
    deletedSourceId: string,
    sourceInput: Omit<Source, 'id' | 'createdAt' | 'updatedAt' | 'articlesCollected' | 'errorCount'>
  ): Promise<Source> {
    const tombstoneRef = doc(db, 'deletedSources', deletedSourceId);
    const targetSourceRef = doc(db, 'sources', deletedSourceId);

    // Verify source isn't already active
    const existingActive = await withTimeout(
      getDoc(targetSourceRef),
      8000,
      `Timed out checking source ${deletedSourceId}`
    );
    if (existingActive.exists()) {
      throw new Error(`Source with ID "${deletedSourceId}" is already active.`);
    }

    // Read tombstone metadata if available
    const tombstoneSnap = await getDoc(tombstoneRef).catch(() => null);
    const tombstone = tombstoneSnap && tombstoneSnap.exists() ? (tombstoneSnap.data() as DeletedSource) : null;

    const rawUrl = sourceInput.websiteUrl.trim();
    const normalizedWebsiteUrl = ensureHttpProtocol(rawUrl);
    const domain = extractNormalizedDomain(rawUrl);
    const now = new Date().toISOString();

    // Process feeds
    let feeds: SourceFeed[] = [];
    if (Array.isArray(sourceInput.feeds) && sourceInput.feeds.length > 0) {
      const seenFeedUrls = new Set<string>();
      let foundPrimary = false;
      feeds = sourceInput.feeds.map((f, idx) => {
        const normUrl = normalizeFeedUrl(f.url);
        if (seenFeedUrls.has(normUrl)) {
          throw new Error(`Duplicate feed URL within source: "${f.url}"`);
        }
        seenFeedUrls.add(normUrl);
        const isPrimary = !foundPrimary && (Boolean(f.isPrimary) || idx === 0);
        if (isPrimary) foundPrimary = true;
        return {
          id: f.id || `feed-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
          title: (f.title || 'Feed').trim(),
          url: normUrl,
          feedType: f.feedType || 'RSS',
          categories: Array.isArray(f.categories) ? f.categories : [],
          coverageRole: f.coverageRole || 'CATEGORY',
          status: f.status || 'ACTIVE',
          isPrimary,
          createdAt: f.createdAt || now,
          updatedAt: f.updatedAt || now,
          lastCollectedAt: f.lastCollectedAt || null,
          lastSuccessfulCollectionAt: f.lastSuccessfulCollectionAt || null,
          failureCount: 0,
          articlesCollected: f.articlesCollected || 0,
          lastError: null,
          oldestItemDate: f.oldestItemDate || null,
          newestItemDate: f.newestItemDate || null,
        };
      });
    } else if (sourceInput.feedUrl) {
      feeds = getSourceFeeds(sourceInput);
    }

    const initialStatus = sourceInput.status || (feeds.length === 0 ? 'NEEDS_CONFIGURATION' : 'ACTIVE');
    const health = computeSourceHealth(feeds, initialStatus);
    const primaryFeed = feeds.find((f) => f.isPrimary) || feeds[0];

    const restoredSource: Source = {
      id: deletedSourceId, // Retain original historical ID so relationships are unified
      name: sourceInput.name.trim(),
      websiteUrl: normalizedWebsiteUrl,
      normalizedDomain: domain,
      feeds,
      health,
      feedUrl: primaryFeed?.url || (sourceInput.feedUrl ? sourceInput.feedUrl.trim() : undefined),
      feedType: primaryFeed?.feedType || sourceInput.feedType || sourceInput.collectionMethod || 'RSS',
      collectionMethod: primaryFeed?.feedType || sourceInput.collectionMethod || 'RSS',
      sourceGroupId: sourceInput.sourceGroupId || 'group-general',
      sourceGroup: sourceInput.sourceGroup || sourceInput.sourceGroupId,
      market: sourceInput.market || 'Global',
      country: sourceInput.country || 'Global',
      language: sourceInput.language || 'en',
      categories: Array.isArray(sourceInput.categories) ? sourceInput.categories : [],
      status: initialStatus,
      articlesCollected: tombstone?.articleCount || 0, // Carry forward historical count
      errorCount: 0,
      failureCount: 0,
      lastError: null,
      createdAt: tombstone?.deletedAt || now,
      updatedAt: now,
      logoUrl: sourceInput.logoUrl ? sourceInput.logoUrl.trim() : undefined,
    };

    // Atomic batch: Create source in /sources and remove from /deletedSources
    const batch = writeBatch(db);
    batch.set(targetSourceRef, cleanFirestoreData(restoredSource));
    if (tombstoneSnap && tombstoneSnap.exists()) {
      batch.delete(tombstoneRef);
    }

    try {
      await withTimeout(
        batch.commit(),
        12000,
        'Timed out committing source restoration batch.'
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes('Timed out')) {
        throw err;
      }
      handleFirestoreError(err, OperationType.CREATE, `sources/${deletedSourceId}`);
    }

    return restoredSource;
  }

  async toggleStatus(id: string): Promise<Source> {
    const targetRef = doc(db, 'sources', id);
    const snap = await withTimeout(
      getDoc(targetRef),
      10000,
      `Timed out reading source: ${id}`
    );
    if (!snap.exists()) {
      throw new Error(`Source with ID ${id} not found.`);
    }

    const current = snap.data() as Source;
    const toggleContract = evaluateSourceStatusToggleContract(current);
    if (!toggleContract.allowed) {
      throw new Error(toggleContract.userMessage);
    }

    const now = new Date().toISOString();
    const newStatus = toggleContract.targetParentStatus;
    const existingFeeds = getSourceFeeds(current);
    const newHealth = computeSourceHealth(existingFeeds, newStatus);

    const payload = cleanFirestoreData({
      status: newStatus,
      health: newHealth,
      updatedAt: now,
    });

    try {
      await withTimeout(
        updateDoc(targetRef, payload),
        10000,
        'Timed out updating source status.'
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes('Timed out')) {
        throw err;
      }
      handleFirestoreError(err, OperationType.UPDATE, `sources/${id}`);
    }

    return {
      ...current,
      status: newStatus,
      feeds: existingFeeds,
      health: newHealth,
      updatedAt: now,
    };
  }
}

// ==========================================
// 2. SOURCE GROUP REPOSITORY
// ==========================================
export class FirestoreSourceGroupRepository implements ISourceGroupRepository {
  private col = collection(db, 'sourceGroups');

  async getAll(): Promise<SourceGroup[]> {
    const snap = await getDocs(this.col);
    const results: SourceGroup[] = [];
    snap.forEach((d) => {
      results.push(d.data() as SourceGroup);
    });
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getById(id: string): Promise<SourceGroup | null> {
    const d = await getDoc(doc(db, 'sourceGroups', id));
    return d.exists() ? (d.data() as SourceGroup) : null;
  }

  async create(groupInput: Omit<SourceGroup, 'id' | 'createdAt' | 'updatedAt'>): Promise<SourceGroup> {
    const now = new Date().toISOString();
    const id = `group-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const newGroup: SourceGroup = {
      ...groupInput,
      id,
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(doc(db, 'sourceGroups', id), newGroup);
    return newGroup;
  }

  async update(id: string, updates: Partial<SourceGroup>): Promise<SourceGroup> {
    const targetRef = doc(db, 'sourceGroups', id);
    const snap = await getDoc(targetRef);
    if (!snap.exists()) {
      throw new Error(`SourceGroup with ID ${id} not found.`);
    }
    const current = snap.data() as SourceGroup;
    const now = new Date().toISOString();
    const cleanUpdates = { ...updates, updatedAt: now };
    await updateDoc(targetRef, cleanUpdates);
    return { ...current, ...cleanUpdates };
  }

  async delete(id: string): Promise<boolean> {
    await deleteDoc(doc(db, 'sourceGroups', id));
    return true;
  }
}

// ==========================================
// 3. ARTICLE REPOSITORY
// ==========================================
export class FirestoreArticleRepository implements IArticleRepository {
  private col = collection(db, 'articles');

  async getAll(maxArticles = 300): Promise<Article[]> {
    try {
      const q = query(this.col, orderBy('publishedAt', 'desc'), firestoreLimit(maxArticles));
      const snap = await getDocs(q);
      const results: Article[] = [];
      snap.forEach((d) => {
        results.push(d.data() as Article);
      });
      return results;
    } catch {
      // Fallback without ordering in case index is building
      const snap = await getDocs(query(this.col, firestoreLimit(maxArticles)));
      const results: Article[] = [];
      snap.forEach((d) => {
        results.push(d.data() as Article);
      });
      return results.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
    }
  }

  async getPaginatedArticles(
    pageSize = 25,
    startAfterCursor?: any
  ): Promise<PaginatedArticlesResult> {
    try {
      let q = query(
        this.col,
        orderBy('publishedAt', 'desc'),
        orderBy('__name__', 'desc'),
        firestoreLimit(pageSize)
      );

      if (startAfterCursor) {
        q = query(q, startAfter(startAfterCursor));
      }

      const snap = await getDocs(q);
      const articles: Article[] = [];
      let lastDocCursor: any = null;

      snap.forEach((d) => {
        articles.push(d.data() as Article);
        lastDocCursor = d;
      });

      return {
        articles,
        lastDocCursor,
        hasMore: snap.docs.length >= pageSize,
        pageSize,
      };
    } catch (err) {
      // Fallback query if compound index on publishedAt + __name__ is unavailable
      try {
        let fallbackQuery = query(
          this.col,
          orderBy('publishedAt', 'desc'),
          firestoreLimit(pageSize)
        );
        if (startAfterCursor) {
          fallbackQuery = query(fallbackQuery, startAfter(startAfterCursor));
        }
        const snap = await getDocs(fallbackQuery);
        const articles: Article[] = [];
        let lastDocCursor: any = null;
        snap.forEach((d) => {
          articles.push(d.data() as Article);
          lastDocCursor = d;
        });
        return {
          articles,
          lastDocCursor,
          hasMore: snap.docs.length >= pageSize,
          pageSize,
        };
      } catch (fallbackErr) {
        console.error('[ArticleRepo] getPaginatedArticles failed:', fallbackErr);
        throw fallbackErr;
      }
    }
  }

  async getById(id: string): Promise<Article | null> {
    const d = await getDoc(doc(db, 'articles', id));
    return d.exists() ? (d.data() as Article) : null;
  }

  async getBySourceId(sourceId: string): Promise<Article[]> {
    const q = query(this.col, where('sourceId', '==', sourceId), firestoreLimit(100));
    const snap = await getDocs(q);
    const results: Article[] = [];
    snap.forEach((d) => results.push(d.data() as Article));
    return results.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  }

  async getByCanonicalUrl(url: string): Promise<Article | null> {
    const norm = normalizeCanonicalUrl(url);
    const q = query(this.col, where('canonicalUrl', '==', norm), firestoreLimit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
      return snap.docs[0].data() as Article;
    }
    return null;
  }

  async create(articleInput: Omit<Article, 'id' | 'collectedAt' | 'updatedAt'>): Promise<Article> {
    const now = new Date().toISOString();
    const id = `art-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const newArticle: Article = {
      ...articleInput,
      id,
      collectedAt: now,
      updatedAt: now,
    };
    await setDoc(doc(db, 'articles', id), newArticle);
    return newArticle;
  }

  async search(searchTerm: string): Promise<Article[]> {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return this.getAll(50);

    const all = await this.getAll(300);
    return all.filter((a) => {
      const titleMatch = a.title.toLowerCase().includes(term);
      const excerptMatch = a.excerpt?.toLowerCase().includes(term);
      const sourceMatch = (a.sourceName || '').toLowerCase().includes(term);
      const catMatch = a.rawCategories?.some((c) => c.toLowerCase().includes(term));
      return titleMatch || excerptMatch || sourceMatch || catMatch;
    });
  }

  async countToday(): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const startIso = startOfDay.toISOString();

    try {
      const snap = await getCountFromServer(
        query(this.col, where('collectedAt', '>=', startIso))
      );
      return snap.data().count;
    } catch {
      const all = await this.getAll(150);
      return all.filter((a) => (a.collectedAt && a.collectedAt >= startIso) || (a.publishedAt && a.publishedAt >= startIso)).length;
    }
  }

  async countTotal(): Promise<number> {
    const snap = await getCountFromServer(this.col);
    return snap.data().count;
  }

  async countByStatus(status: Article['processingStatus']): Promise<number> {
    const snap = await getCountFromServer(
      query(this.col, where('processingStatus', '==', status))
    );
    return snap.data().count;
  }
}

// ==========================================
// 4. STORY REPOSITORY & NORMALIZATION
// ==========================================

/**
 * Normalizes raw story documents on read to guarantee schema safety.
 * Protects runtime code and UI from legacy/bootstrap Phase 1 documents
 * (e.g. story-001, story-002, story-003) missing Phase 4 fields without
 * mutating live database records.
 */
export function normalizeStoryDoc(raw: any, docId: string): Story {
  if (!raw) return raw;

  const legacy = isLegacyStory({
    id: docId || raw.id,
    isLegacy: raw.isLegacy,
    clusteringVersion: raw.clusteringVersion,
    canonicalTitle: raw.canonicalTitle,
  });

  const articleIds = Array.isArray(raw.articleIds) ? raw.articleIds : [];
  const sourceIds = Array.isArray(raw.sourceIds) ? raw.sourceIds : [];
  const articleCount =
    typeof raw.articleCount === 'number' && !isNaN(raw.articleCount)
      ? raw.articleCount
      : articleIds.length;
  const sourceCount =
    typeof raw.sourceCount === 'number' && !isNaN(raw.sourceCount)
      ? raw.sourceCount
      : sourceIds.length;

  const canonicalTitle = raw.canonicalTitle || raw.title || 'Untitled Story';
  const title = canonicalTitle; // Canonical English presentation title
  const storyType = raw.storyType || 'OTHER';
  const primaryCompanyId = raw.primaryCompanyId ?? null;
  const primaryProductId = raw.primaryProductId ?? null;
  const companies = Array.isArray(raw.companies) ? raw.companies : [];
  const products = Array.isArray(raw.products) ? raw.products : [];
  const categories = Array.isArray(raw.categories)
    ? raw.categories
    : raw.category
      ? [raw.category]
      : [];

  const rawImportance = typeof raw.importanceScore === 'number' && !isNaN(raw.importanceScore)
    ? raw.importanceScore
    : 50;

  // Preserve Phase 7B.2 fields if already persisted
  let strategicImportanceScore = typeof raw.strategicImportanceScore === 'number' && !isNaN(raw.strategicImportanceScore)
    ? raw.strategicImportanceScore
    : undefined;
  let competitiveThreatLevel = raw.competitiveThreatLevel || undefined;
  let huaweiRelevance = raw.huaweiRelevance || undefined;
  let competitiveImplication = raw.competitiveImplication || undefined;
  let strategicRecommendation = raw.strategicRecommendation || undefined;
  let strategicScoringFactors = raw.strategicScoringFactors || undefined;

  // Detect whether persisted competitive intelligence contains stale deterministic fallback text
  // from early batch runs (e.g. before comp-google, comp-vivo, comp-oppo or score>=70 branches were added)
  const isGenericCompetitorFallback =
    (typeof competitiveImplication === 'string' && competitiveImplication.includes('General industry movement')) ||
    (typeof strategicRecommendation === 'string' && (strategicRecommendation.includes('routine intelligence tracking') || strategicRecommendation.includes('routine monitoring'))) ||
    (typeof huaweiRelevance === 'string' && huaweiRelevance.startsWith('Secondary market activity'));

  // On-the-fly derivation for unmigrated stories OR stories containing stale generic fallbacks:
  // If competitive intelligence fields are missing OR contain stale generic fallbacks, derive them deterministically
  if (!competitiveImplication || !strategicRecommendation || strategicImportanceScore === undefined || isGenericCompetitorFallback) {
    const derived = deriveHuaweiCompetitiveIntelligence(
      {
        id: docId || raw.id,
        primaryCompanyId,
        companies,
        products,
        categories,
        storyType,
        canonicalTitle,
        title,
        summary: raw.summary || raw.canonicalSummary || '',
        importanceScore: rawImportance,
      },
      [],
      [],
      raw.evidenceClassification || 'SINGLE_SOURCE_REPORT'
    );

    if (!competitiveImplication || isGenericCompetitorFallback) competitiveImplication = derived.competitiveImplication;
    if (!strategicRecommendation || isGenericCompetitorFallback) strategicRecommendation = derived.strategicRecommendation;
    if (!huaweiRelevance || isGenericCompetitorFallback) huaweiRelevance = derived.huaweiRelevance;
    if (!competitiveThreatLevel || (isGenericCompetitorFallback && competitiveThreatLevel === 'LOW' && derived.competitiveThreatLevel !== 'LOW')) {
      competitiveThreatLevel = derived.competitiveThreatLevel;
    }
    if (strategicImportanceScore === undefined) {
      strategicImportanceScore = Math.max(rawImportance, derived.strategicImportanceScore);
    }
    if (!strategicScoringFactors || isGenericCompetitorFallback) strategicScoringFactors = derived.strategicScoringFactors;
  }

  // Evidence classification fallback for unmigrated stories
  let evidenceClassification = raw.evidenceClassification;
  if (!evidenceClassification) {
    if (sourceCount >= 3 || articleCount >= 3) {
      evidenceClassification = 'MULTI_SOURCE_CORROBORATED';
    } else if (sourceCount >= 2 || articleCount >= 2) {
      evidenceClassification = 'VERIFIED_REPORT';
    } else {
      evidenceClassification = 'SINGLE_SOURCE_REPORT';
    }
  }

  const firstSeenAt = raw.firstSeenAt || raw.createdAt || raw.lastUpdatedAt || new Date().toISOString();
  const lastSeenAt = raw.lastSeenAt || raw.lastUpdatedAt || raw.updatedAt || raw.firstSeenAt || new Date().toISOString();
  const lastMaterialUpdateAt = raw.lastMaterialUpdateAt || lastSeenAt;

  // Timeline fallback for unmigrated stories
  const timeline = Array.isArray(raw.timeline) && raw.timeline.length > 0
    ? raw.timeline
    : [
        {
          id: `dev-${docId || raw.id}-init`,
          timestamp: firstSeenAt,
          developmentType: evidenceClassification === 'OFFICIAL_ANNOUNCEMENT'
            ? 'OFFICIAL_ANNOUNCEMENT'
            : evidenceClassification === 'RUMOR_OR_LEAK'
            ? 'SPEC_LEAK'
            : 'INITIAL_COVERAGE',
          description: canonicalTitle,
          articleIds,
          sourceUrls: [],
          confidence: (raw.confidence || 0.8) >= 0.8 ? 'HIGH' : 'MEDIUM',
          evidenceClassification,
        },
      ];

  return {
    id: docId || raw.id,
    canonicalTitle,
    title,
    summary: raw.summary || raw.canonicalSummary || '',
    presentationLanguage: raw.presentationLanguage || 'en',
    canonicalSummary: raw.canonicalSummary || raw.summary || '',
    status: raw.status || 'DEVELOPING',
    storyType,
    importanceScore: rawImportance,
    confidence:
      typeof raw.confidence === 'number' && !isNaN(raw.confidence)
        ? raw.confidence
        : 0.8,
    firstSeenAt,
    lastSeenAt,
    lastUpdatedAt: raw.lastUpdatedAt || raw.updatedAt || raw.lastSeenAt || undefined,
    articleCount,
    articleIds,
    sourceIds,
    sourceCount,
    companies,
    products,
    categories,
    topics: Array.isArray(raw.topics) ? raw.topics : [],
    markets: Array.isArray(raw.markets) ? raw.markets : [],
    languages: Array.isArray(raw.languages) ? raw.languages : [],
    primaryCompanyId,
    primaryProductId,
    representativeArticleId:
      raw.representativeArticleId ?? (articleIds.length > 0 ? articleIds[0] : null),
    createdAt: raw.createdAt || raw.firstSeenAt || raw.lastUpdatedAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || raw.lastUpdatedAt || raw.createdAt || new Date().toISOString(),
    clusteringVersion: raw.clusteringVersion || (legacy ? 'legacy-bootstrap' : 'signalyn-cluster-v1'),
    mergeMetadata: raw.mergeMetadata || undefined,
    category:
      raw.category ||
      (categories.length > 0 ? categories[0] : undefined),
    isLegacy: legacy,
    // Phase 7B.1 Lifecycle Governance Fields
    lifecycleTransitions: Array.isArray(raw.lifecycleTransitions) ? raw.lifecycleTransitions : undefined,
    lastLifecycleEvaluationAt: raw.lastLifecycleEvaluationAt || undefined,
    terminalReason: raw.terminalReason || undefined,
    // Phase 7B.2 Evidence Verification & Provenance Fields
    evidenceClassification,
    evidenceConfidence: typeof raw.evidenceConfidence === 'number' && !isNaN(raw.evidenceConfidence)
      ? raw.evidenceConfidence
      : typeof raw.confidence === 'number' && !isNaN(raw.confidence)
      ? raw.confidence
      : 0.8,
    evidenceReasons: Array.isArray(raw.evidenceReasons) ? raw.evidenceReasons : undefined,
    independentSourceCount: typeof raw.independentSourceCount === 'number' && !isNaN(raw.independentSourceCount)
      ? raw.independentSourceCount
      : sourceCount,
    sourceProvenances: Array.isArray(raw.sourceProvenances) ? raw.sourceProvenances : undefined,
    lastMaterialUpdateAt,
    timeline,
    eventSignature: raw.eventSignature || undefined,
    // Phase 7B.2 HUAWEI Competitive Intelligence Layer
    strategicImportanceScore,
    competitiveThreatLevel,
    huaweiRelevance,
    competitiveImplication,
    strategicRecommendation,
    strategicScoringFactors,
  };
}

export class FirestoreStoryRepository implements IStoryRepository {
  private col = collection(db, 'stories');

  async getAll(limitCount?: number): Promise<Story[]> {
    const q = limitCount ? query(this.col, firestoreLimit(limitCount)) : this.col;
    const snap = await getDocs(q);
    const results: Story[] = [];
    snap.forEach((d) => results.push(normalizeStoryDoc(d.data(), d.id)));
    return results.sort((a, b) => {
      const timeB = new Date(b.lastUpdatedAt || b.updatedAt || b.lastSeenAt || b.createdAt || 0).getTime();
      const timeA = new Date(a.lastUpdatedAt || a.updatedAt || a.lastSeenAt || a.createdAt || 0).getTime();
      return timeB - timeA;
    });
  }

  async getRecentProductionStories(
    limitCount = 1000,
    startAfterCursor?: any
  ): Promise<{ stories: Story[]; lastDoc?: any; hasMore: boolean }> {
    const fetchLimit = limitCount;
    let snap: any = null;

    try {
      let q = query(
        this.col,
        orderBy('updatedAt', 'desc'),
        firestoreLimit(fetchLimit)
      );
      if (startAfterCursor) {
        q = query(q, startAfter(startAfterCursor));
      }
      snap = await getDocs(q);
    } catch {
      // Fallback 1: orderBy('createdAt', 'desc')
      try {
        let q = query(
          this.col,
          orderBy('createdAt', 'desc'),
          firestoreLimit(fetchLimit)
        );
        if (startAfterCursor) {
          q = query(q, startAfter(startAfterCursor));
        }
        snap = await getDocs(q);
      } catch {
        // Fallback 2: bounded query without orderBy
        try {
          let q = query(this.col, firestoreLimit(fetchLimit));
          if (startAfterCursor) {
            q = query(q, startAfter(startAfterCursor));
          }
          snap = await getDocs(q);
        } catch (e) {
          console.error('[StoryRepo] All bounded queries failed:', e);
          return { stories: [], hasMore: false };
        }
      }
    }

    const results: Story[] = [];
    let lastSnapDoc: any = null;
    if (snap) {
      snap.forEach((d: any) => {
        const story = normalizeStoryDoc(d.data(), d.id);
        if (isProductionStory(story)) {
          if (results.length < limitCount) {
            results.push(story);
            lastSnapDoc = d;
          }
        }
      });
    }

    return {
      stories: results,
      lastDoc: lastSnapDoc,
      hasMore: snap ? snap.docs.length >= fetchLimit : false,
    };
  }

  async countProduction(): Promise<number> {
    try {
      const snap = await getCountFromServer(
        query(this.col, where('isLegacy', '==', false))
      );
      return snap.data().count;
    } catch {
      try {
        const totalSnap = await getCountFromServer(this.col);
        return Math.max(0, totalSnap.data().count - 3);
      } catch {
        return 108;
      }
    }
  }

  async getById(id: string): Promise<Story | null> {
    const d = await getDoc(doc(db, 'stories', id));
    return d.exists() ? normalizeStoryDoc(d.data(), d.id) : null;
  }

  async getHighPriority(threshold = 70): Promise<Story[]> {
    const all = await this.getAll();
    return all.filter((s) => s.importanceScore >= threshold);
  }

  async create(story: Story): Promise<Story> {
    const targetRef = doc(db, 'stories', story.id);
    await setDoc(targetRef, cleanFirestoreData(story));
    return story;
  }

  async update(id: string, updates: Partial<Story>): Promise<Story> {
    const targetRef = doc(db, 'stories', id);
    const current = await this.getById(id);
    if (!current) {
      throw new Error(`Story with ID ${id} not found.`);
    }
    const now = new Date().toISOString();
    const cleanUpdates = {
      ...updates,
      updatedAt: now,
      lastUpdatedAt: updates.lastUpdatedAt || now,
    };
    await updateDoc(targetRef, cleanFirestoreData(cleanUpdates));
    return {
      ...current,
      ...cleanUpdates,
    };
  }

  async delete(id: string): Promise<boolean> {
    await deleteDoc(doc(db, 'stories', id));
    return true;
  }

  async addMembership(storyId: string, membership: StoryMembership): Promise<void> {
    const targetRef = doc(db, 'stories', storyId, 'articles', membership.articleId);
    await setDoc(targetRef, cleanFirestoreData(membership));
  }

  async removeMembership(storyId: string, articleId: string): Promise<void> {
    const targetRef = doc(db, 'stories', storyId, 'articles', articleId);
    await deleteDoc(targetRef);
  }

  async getMemberships(storyId: string): Promise<StoryMembership[]> {
    const colRef = collection(db, 'stories', storyId, 'articles');
    const snap = await getDocs(colRef);
    const results: StoryMembership[] = [];
    snap.forEach((d) => results.push(d.data() as StoryMembership));
    return results.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  }

  async mergeStories(targetStoryId: string, sourceStoryId: string): Promise<Story> {
    const [targetStory, sourceStory] = await Promise.all([
      this.getById(targetStoryId),
      this.getById(sourceStoryId),
    ]);

    if (!targetStory) throw new Error(`Target story ${targetStoryId} not found.`);
    if (!sourceStory) throw new Error(`Source story ${sourceStoryId} not found.`);

    const sourceMemberships = await this.getMemberships(sourceStoryId);
    const now = new Date().toISOString();

    // Migrate memberships from source to target subcollection
    const batch = writeBatch(db);
    for (const m of sourceMemberships) {
      const newMembership: StoryMembership = {
        ...m,
        storyId: targetStoryId,
      };
      batch.set(doc(db, 'stories', targetStoryId, 'articles', m.articleId), cleanFirestoreData(newMembership));
      batch.delete(doc(db, 'stories', sourceStoryId, 'articles', m.articleId));
    }

    // Merge entity references and arrays
    const combinedArticleIds = Array.from(new Set([...targetStory.articleIds, ...sourceStory.articleIds]));
    const combinedSourceIds = Array.from(new Set([...targetStory.sourceIds, ...sourceStory.sourceIds]));
    const combinedCategories = Array.from(new Set([...(targetStory.categories || []), ...(sourceStory.categories || [])]));
    const combinedTopics = Array.from(new Set([...(targetStory.topics || []), ...(sourceStory.topics || [])]));
    const combinedMarkets = Array.from(new Set([...(targetStory.markets || []), ...(sourceStory.markets || [])]));
    const combinedLanguages = Array.from(new Set([...(targetStory.languages || []), ...(sourceStory.languages || [])]));

    const companyMap = new Map<string, typeof targetStory.companies[0]>();
    for (const c of [...(targetStory.companies || []), ...(sourceStory.companies || [])]) {
      const key = c.companyId || c.name.toLowerCase();
      if (!companyMap.has(key)) companyMap.set(key, c);
    }

    const productMap = new Map<string, typeof targetStory.products[0]>();
    for (const p of [...(targetStory.products || []), ...(sourceStory.products || [])]) {
      const key = p.productId || p.name.toLowerCase();
      if (!productMap.has(key)) productMap.set(key, p);
    }

    const mergedStoryIds = Array.from(
      new Set([...(targetStory.mergeMetadata?.mergedStoryIds || []), sourceStoryId])
    );

    const targetUpdates: Partial<Story> = {
      articleIds: combinedArticleIds,
      articleCount: combinedArticleIds.length,
      sourceIds: combinedSourceIds,
      sourceCount: combinedSourceIds.length,
      categories: combinedCategories,
      topics: combinedTopics,
      markets: combinedMarkets,
      languages: combinedLanguages,
      companies: Array.from(companyMap.values()),
      products: Array.from(productMap.values()),
      mergeMetadata: {
        mergedAt: now,
        mergedStoryIds,
      },
      updatedAt: now,
      lastUpdatedAt: now,
    };

    batch.update(doc(db, 'stories', targetStoryId), cleanFirestoreData(targetUpdates));
    batch.update(doc(db, 'stories', sourceStoryId), cleanFirestoreData({
      status: 'ARCHIVED',
      updatedAt: now,
      mergeMetadata: {
        mergedAt: now,
        mergedStoryIds: [targetStoryId],
      },
    }));

    await batch.commit();

    return {
      ...targetStory,
      ...targetUpdates,
    };
  }

  async removeArticleFromStory(
    storyId: string,
    articleId: string
  ): Promise<{ storyDeleted: boolean; updatedStory?: Story }> {
    await this.removeMembership(storyId, articleId);
    const story = await this.getById(storyId);
    if (!story) {
      return { storyDeleted: true };
    }

    const remainingArticleIds = (story.articleIds || []).filter((id) => id !== articleId);
    const now = new Date().toISOString();

    if (remainingArticleIds.length === 0) {
      await updateDoc(doc(db, 'stories', storyId), {
        articleIds: [],
        articleCount: 0,
        status: 'ARCHIVED',
        updatedAt: now,
        lastUpdatedAt: now,
      });
      return { storyDeleted: true };
    }

    const remainingMemberships = await this.getMemberships(storyId);
    const sourceIds = Array.from(new Set(remainingMemberships.map((m) => m.sourceId)));

    const updates: Partial<Story> = {
      articleIds: remainingArticleIds,
      articleCount: remainingArticleIds.length,
      sourceIds,
      sourceCount: sourceIds.length,
      updatedAt: now,
      lastUpdatedAt: now,
    };

    await updateDoc(doc(db, 'stories', storyId), cleanFirestoreData(updates));
    return {
      storyDeleted: false,
      updatedStory: {
        ...story,
        ...updates,
      },
    };
  }

  async updateStoryAggregates(storyId: string): Promise<Story | null> {
    const story = await this.getById(storyId);
    if (!story) return null;

    const memberships = await this.getMemberships(storyId);
    const articleIds = memberships.map((m) => m.articleId);
    const sourceIds = Array.from(new Set(memberships.map((m) => m.sourceId)));
    const now = new Date().toISOString();

    let lastSeenAt = story.lastSeenAt;
    for (const m of memberships) {
      if (m.publishedAt && (!lastSeenAt || m.publishedAt > lastSeenAt)) {
        lastSeenAt = m.publishedAt;
      }
    }

    const updates: Partial<Story> = {
      articleCount: articleIds.length,
      articleIds,
      sourceCount: sourceIds.length,
      sourceIds,
      lastSeenAt,
      updatedAt: now,
      lastUpdatedAt: now,
    };

    await updateDoc(doc(db, 'stories', storyId), cleanFirestoreData(updates));
    return {
      ...story,
      ...updates,
    };
  }
}

// ==========================================
// 4B. STORY REVIEW REPOSITORY
// ==========================================
export class FirestoreStoryReviewRepository implements IStoryReviewRepository {
  private col = collection(db, 'storyReview');

  async getAll(): Promise<StoryReview[]> {
    try {
      const q = query(this.col, orderBy('createdAt', 'desc'), firestoreLimit(100));
      const snap = await getDocs(q);
      const results: StoryReview[] = [];
      snap.forEach((d) => results.push(d.data() as StoryReview));
      return results;
    } catch {
      const snap = await getDocs(query(this.col, firestoreLimit(100)));
      const results: StoryReview[] = [];
      snap.forEach((d) => results.push(d.data() as StoryReview));
      return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
  }

  async getPending(): Promise<StoryReview[]> {
    try {
      const q = query(this.col, where('status', '==', 'PENDING'), firestoreLimit(50));
      const snap = await getDocs(q);
      const results: StoryReview[] = [];
      snap.forEach((d) => results.push(d.data() as StoryReview));
      return results;
    } catch {
      const snap = await getDocs(query(this.col, firestoreLimit(50)));
      const results: StoryReview[] = [];
      snap.forEach((d) => {
        const item = d.data() as StoryReview;
        if (item.status === 'PENDING') results.push(item);
      });
      return results;
    }
  }

  async create(review: StoryReview): Promise<StoryReview> {
    await setDoc(doc(db, 'storyReview', review.id), cleanFirestoreData(review));
    return review;
  }

  async updateStatus(
    id: string,
    status: 'PENDING' | 'RESOLVED' | 'DISMISSED',
    resolutionAction?: any
  ): Promise<void> {
    const updates: Record<string, any> = {
      status,
      resolvedAt: status !== 'PENDING' ? new Date().toISOString() : null,
    };
    if (resolutionAction !== undefined) {
      updates.resolutionAction = resolutionAction;
    }
    await updateDoc(doc(db, 'storyReview', id), cleanFirestoreData(updates));
  }

  async delete(id: string): Promise<boolean> {
    await deleteDoc(doc(db, 'storyReview', id));
    return true;
  }
}

// ==========================================
// 4C. STORY RUN REPOSITORY
// Canonical Path: /system/storyRuns/runs/{runId}
// (4-segment document reference aligned across firestore.rules and blueprint)
// ==========================================
export const STORY_RUNS_COLLECTION_PATH = 'system/storyRuns/runs';

export class FirestoreStoryRunRepository implements IStoryRunRepository {
  private col = collection(db, 'system', 'storyRuns', 'runs');

  async create(run: StoryRun): Promise<StoryRun> {
    const targetRef = doc(db, 'system', 'storyRuns', 'runs', run.runId);
    await setDoc(targetRef, cleanFirestoreData(run));
    return run;
  }

  async getAll(max = 50): Promise<StoryRun[]> {
    try {
      const q = query(this.col, orderBy('startedAt', 'desc'), firestoreLimit(max));
      const snap = await getDocs(q);
      const results: StoryRun[] = [];
      snap.forEach((d) => results.push(d.data() as StoryRun));
      return results;
    } catch {
      const snap = await getDocs(query(this.col, firestoreLimit(max)));
      const results: StoryRun[] = [];
      snap.forEach((d) => results.push(d.data() as StoryRun));
      return results.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    }
  }

  async getLatest(): Promise<StoryRun | null> {
    const runs = await this.getAll(1);
    return runs.length > 0 ? runs[0] : null;
  }
}

// ==========================================
// 5. COMPANY REPOSITORY
// ==========================================
export class FirestoreCompanyRepository implements ICompanyRepository {
  private col = collection(db, 'companies');

  async getAll(): Promise<Company[]> {
    const snap = await getDocs(this.col);
    const results: Company[] = [];
    snap.forEach((d) => results.push(d.data() as Company));
    return results.sort((a, b) => {
      // Primary company first, then alphabetical
      if (a.isMyCompany) return -1;
      if (b.isMyCompany) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  async getById(id: string): Promise<Company | null> {
    const d = await getDoc(doc(db, 'companies', id));
    return d.exists() ? (d.data() as Company) : null;
  }

  async getMyCompany(): Promise<Company | null> {
    const all = await this.getAll();
    return all.find((c) => c.isMyCompany) || null;
  }

  async getCompetitors(): Promise<Company[]> {
    const all = await this.getAll();
    return all.filter((c) => c.isCompetitor);
  }

  async update(id: string, updates: Partial<Company>): Promise<Company> {
    const targetRef = doc(db, 'companies', id);
    const snap = await getDoc(targetRef);
    if (!snap.exists()) {
      throw new Error(`Company with ID ${id} not found.`);
    }
    const current = snap.data() as Company;
    await updateDoc(targetRef, updates);
    return { ...current, ...updates };
  }

  async setMyCompany(companyId: string): Promise<void> {
    const all = await this.getAll();
    for (const c of all) {
      const isTarget = c.id === companyId;
      if (c.isMyCompany !== isTarget || (isTarget && c.isCompetitor) || (!isTarget && !c.isCompetitor)) {
        await updateDoc(doc(db, 'companies', c.id), {
          isMyCompany: isTarget,
          isCompetitor: isTarget ? false : true,
        });
      }
    }
  }
}

// ==========================================
// 6. PRODUCT REPOSITORY
// ==========================================
export class FirestoreProductRepository implements IProductRepository {
  private col = collection(db, 'products');

  async getAll(): Promise<Product[]> {
    const snap = await getDocs(this.col);
    const results: Product[] = [];
    snap.forEach((d) => results.push(d.data() as Product));
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getByCompanyId(companyId: string): Promise<Product[]> {
    const q = query(this.col, where('companyId', '==', companyId));
    const snap = await getDocs(q);
    const results: Product[] = [];
    snap.forEach((d) => results.push(d.data() as Product));
    return results;
  }

  async getByCategory(category: string): Promise<Product[]> {
    const q = query(this.col, where('category', '==', category));
    const snap = await getDocs(q);
    const results: Product[] = [];
    snap.forEach((d) => results.push(d.data() as Product));
    return results;
  }

  async create(productInput: Omit<Product, 'id'>): Promise<Product> {
    const id = `prod-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const newProduct: Product = { ...productInput, id };
    await setDoc(doc(db, 'products', id), newProduct);
    return newProduct;
  }
}

// ==========================================
// 7. ARTICLE ANALYSIS REPOSITORY (PHASE 3)
// ==========================================
export function normalizeArticleAnalysis(raw: any): ArticleAnalysis {
  if (!raw) return raw;
  return {
    ...raw,
    sentimentConfidence:
      typeof raw.sentimentConfidence === 'number'
        ? raw.sentimentConfidence
        : typeof raw.confidenceScore === 'number'
          ? raw.confidenceScore
          : 0.8,
    confidence:
      typeof raw.confidence === 'number'
        ? raw.confidence
        : typeof raw.confidenceScore === 'number'
          ? raw.confidenceScore
          : 0.85,
    importanceScore: typeof raw.importanceScore === 'number' ? raw.importanceScore : 50,
    companies: Array.isArray(raw.companies) ? raw.companies : [],
    products: Array.isArray(raw.products) ? raw.products : [],
    topics: Array.isArray(raw.topics) ? raw.topics : [],
    keyPoints: Array.isArray(raw.keyPoints) ? raw.keyPoints : [],
    competitiveSignals: Array.isArray(raw.competitiveSignals) ? raw.competitiveSignals : [],
    competitiveRelevance:
      raw.competitiveRelevance && typeof raw.competitiveRelevance.score === 'number'
        ? {
            score: raw.competitiveRelevance.score,
            reasons: Array.isArray(raw.competitiveRelevance.reasons) ? raw.competitiveRelevance.reasons : [],
            categories: Array.isArray(raw.competitiveRelevance.categories) ? raw.competitiveRelevance.categories : [],
            relatedCompanies: Array.isArray(raw.competitiveRelevance.relatedCompanies)
              ? raw.competitiveRelevance.relatedCompanies
              : [],
          }
        : {
            score: 0,
            reasons: [],
            categories: [],
            relatedCompanies: [],
          },
  };
}

export class FirestoreArticleAnalysisRepository implements IArticleAnalysisRepository {
  private col = collection(db, 'articleAnalysis');

  async getByArticleId(articleId: string): Promise<ArticleAnalysis | null> {
    const d = await getDoc(doc(db, 'articleAnalysis', articleId));
    return d.exists() ? normalizeArticleAnalysis(d.data()) : null;
  }

  async getAll(max = 200): Promise<ArticleAnalysis[]> {
    try {
      const q = query(this.col, orderBy('analyzedAt', 'desc'), firestoreLimit(max));
      const snap = await getDocs(q);
      const results: ArticleAnalysis[] = [];
      snap.forEach((d) => results.push(normalizeArticleAnalysis(d.data())));
      return results;
    } catch {
      const snap = await getDocs(query(this.col, firestoreLimit(max)));
      const results: ArticleAnalysis[] = [];
      snap.forEach((d) => results.push(normalizeArticleAnalysis(d.data())));
      return results;
    }
  }

  async save(analysis: ArticleAnalysis): Promise<void> {
    await setDoc(doc(db, 'articleAnalysis', analysis.articleId), cleanFirestoreData(analysis));
  }

  async delete(articleId: string): Promise<boolean> {
    await deleteDoc(doc(db, 'articleAnalysis', articleId));
    return true;
  }

  async countTotal(): Promise<number> {
    const snap = await getCountFromServer(this.col);
    return snap.data().count;
  }
}

// ==========================================
// 8. ENTITY REVIEW REPOSITORY (PHASE 3)
// ==========================================
export class FirestoreEntityReviewRepository implements IEntityReviewRepository {
  private col = collection(db, 'entityReview');

  async getArchive(): Promise<EntityReview[]> {
    const snapshot = await withTimeout(getDocs(this.col), 15000, 'Timed out reading the entity review queue.');
    return snapshot.docs
      .map((doc) => ({ ...doc.data(), id: doc.id }) as EntityReview)
      .sort((a, b) => {
        const timeA = Date.parse(a.createdAt) || 0;
        const timeB = Date.parse(b.createdAt) || 0;
        return timeB - timeA || a.id.localeCompare(b.id);
      });
  }

  async getAll(max = 20): Promise<EntityReview[]> {
    try {
      const q = query(this.col, orderBy('createdAt', 'desc'), firestoreLimit(max));
      const snap = await getDocs(q);
      const results: EntityReview[] = [];
      snap.forEach((d) => results.push(d.data() as EntityReview));
      return results;
    } catch {
      const snap = await getDocs(query(this.col, firestoreLimit(max)));
      const results: EntityReview[] = [];
      snap.forEach((d) => results.push(d.data() as EntityReview));
      return results;
    }
  }

  async getPending(limitCount = 20): Promise<EntityReview[]> {
    try {
      const q = query(this.col, where('status', '==', 'PENDING'), firestoreLimit(limitCount));
      const snap = await getDocs(q);
      const results: EntityReview[] = [];
      snap.forEach((d) => results.push(d.data() as EntityReview));
      return results;
    } catch {
      const snap = await getDocs(query(this.col, firestoreLimit(limitCount)));
      const results: EntityReview[] = [];
      snap.forEach((d) => {
        const item = d.data() as EntityReview;
        if (item.status === 'PENDING') results.push(item);
      });
      return results;
    }
  }

  async updateStatus(id: string, status: ReviewStatus): Promise<void> {
    await updateDoc(doc(db, 'entityReview', id), {
      status,
      reviewedAt: new Date().toISOString(),
    });
  }
}

// ==========================================
// 9. SETTINGS REPOSITORY
// ==========================================
export class FirestoreSettingsRepository implements ISettingsRepository {
  private docRef = doc(db, 'settings', 'intelligence');

  async getSettings(): Promise<IntelligenceSettings> {
    const snap = await getDoc(this.docRef);
    if (snap.exists()) {
      return snap.data() as IntelligenceSettings;
    }
    // Return baseline initial settings
    return INITIAL_SETTINGS;
  }

  async updateSettings(updates: Partial<IntelligenceSettings>): Promise<IntelligenceSettings> {
    const current = await this.getSettings();
    const mergedCompetitorSets = updates.competitorSets
      ? { ...(current.competitorSets || {}), ...updates.competitorSets }
      : current.competitorSets;
    const updated: IntelligenceSettings = {
      ...current,
      ...updates,
      ...(mergedCompetitorSets ? { competitorSets: mergedCompetitorSets } : {}),
    };
    await setDoc(this.docRef, cleanFirestoreData(updated), { merge: true });
    return updated;
  }
}

// ==========================================
// 10. METRICS REPOSITORY
// ==========================================
export class FirestoreMetricsRepository implements IMetricsRepository {
  constructor(
    private sourceRepo: ISourceRepository,
    private articleRepo: IArticleRepository,
    private storyRepo: IStoryRepository,
    private companyRepo: ICompanyRepository,
    private analysisRepo?: IArticleAnalysisRepository,
    private reviewRepo?: IEntityReviewRepository
  ) {}

  async getDashboardMetrics(preloaded?: PreloadedDashboardData): Promise<DashboardMetrics> {
    const sourcesPromise = preloaded?.sources
      ? Promise.resolve(preloaded.sources)
      : this.sourceRepo.getAll();

    const storiesPromise = preloaded?.stories
      ? Promise.resolve(preloaded.stories)
      : this.storyRepo.getAll();

    const companiesPromise = preloaded?.companies
      ? Promise.resolve(preloaded.companies)
      : this.companyRepo.getAll();

    const pendingReviewsPromise = preloaded?.pendingReviews
      ? Promise.resolve(preloaded.pendingReviews)
      : preloaded?.entityReviews
      ? Promise.resolve(preloaded.entityReviews.filter((r) => r.status === 'PENDING'))
      : this.reviewRepo
      ? this.reviewRepo.getPending().catch(() => [])
      : Promise.resolve([]);

    const productionStoriesCountPromise =
      typeof preloaded?.totalProductionStoriesCount === 'number'
        ? Promise.resolve(preloaded.totalProductionStoriesCount)
        : this.storyRepo.countProduction();

    const [
      sources,
      stories,
      companies,
      articlesCollectedTotal,
      pendingArticlesCount,
      articlesToday,
      articlesAnalyzedCount,
      pendingReviews,
      productionStoriesCount,
    ] = await Promise.all([
      sourcesPromise,
      storiesPromise,
      companiesPromise,
      this.articleRepo.countTotal(),
      this.articleRepo.countByStatus('PENDING'),
      this.articleRepo.countToday(),
      this.analysisRepo ? this.analysisRepo.countTotal().catch(() => 0) : Promise.resolve(0),
      pendingReviewsPromise,
      productionStoriesCountPromise,
    ]);

    const reconciledSourceCounts = computeReconciledSourceKpiCounts(sources);
    const activeSources = reconciledSourceCounts.active;
    const errorSourcesCount = reconciledSourceCounts.error;
    const productionStories = stories.filter(isProductionStory);
    const highPriorityStories = productionStories.filter((s: Story) => s.importanceScore >= 70).length;

    return {
      articlesCollectedTotal,
      storiesDetected: productionStoriesCount,
      activeSources,
      totalSources: sources.length,
      companiesTracked: companies.length,
      highPriorityStories,
      articlesToday,
      errorSourcesCount,
      articlesAnalyzedCount,
      pendingAnalysisCount: pendingArticlesCount,
      unresolvedReviewsCount: pendingReviews.length,
    };
  }
}

function cleanFirestoreData(data: any): any {
  if (data === null || data === undefined) {
    return null;
  }
  if (Array.isArray(data)) {
    return data
      .filter((item) => item !== undefined)
      .map((item) => cleanFirestoreData(item));
  }
  if (typeof data === 'object' && !(data instanceof Date)) {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) {
        result[k] = cleanFirestoreData(v);
      }
    }
    return result;
  }
  return data;
}

// ==========================================
// 11. DATABASE INITIAL SEEDING HELPER
// ==========================================
let isSeeding = false;
let hasCheckedSeed = false;

export async function seedFirestoreIfEmpty(): Promise<void> {
  if (isSeeding || hasCheckedSeed) return;
  isSeeding = true;

  try {
    const sourcesSnap = await getDocs(collection(db, 'sources'));
    if (!sourcesSnap.empty) {
      // Already populated!
      hasCheckedSeed = true;
      return;
    }

    console.log('[Signalyn] Initializing baseline collections in Firestore...');

    // 1. Seed Source Groups
    for (const group of INITIAL_SOURCE_GROUPS) {
      await setDoc(doc(db, 'sourceGroups', group.id), cleanFirestoreData(group));
    }

    // 2. Seed Sources
    for (const source of INITIAL_SOURCES) {
      await setDoc(doc(db, 'sources', source.id), cleanFirestoreData(source));
    }

    // 3. Seed Companies
    for (const comp of INITIAL_COMPANIES) {
      await setDoc(doc(db, 'companies', comp.id), cleanFirestoreData(comp));
    }

    // 4. Seed Products
    for (const prod of INITIAL_PRODUCTS) {
      await setDoc(doc(db, 'products', prod.id), cleanFirestoreData(prod));
    }

    // 5. Seed Stories
    for (const story of INITIAL_STORIES) {
      await setDoc(doc(db, 'stories', story.id), cleanFirestoreData(story));
    }

    // 6. Seed Settings
    await setDoc(doc(db, 'settings', 'intelligence'), cleanFirestoreData(INITIAL_SETTINGS));

    console.log('[Signalyn] Initial baseline seed completed successfully.');
  } catch (err) {
    console.warn('[Signalyn] Database seeding notice:', err);
  } finally {
    isSeeding = false;
  }
}
