/**
 * Mock Repositories Implementation
 * 
 * Provides an asynchronous, contract-compliant data layer.
 * Persists modifications in localStorage so the user can add/edit/delete sources,
 * groups, and settings during testing.
 * 
 * Ready to be swapped with FirestoreRepository in Phase 2 without altering UI components.
 */

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
  IntelligenceSettings,
  DashboardMetrics,
  DeletedSource,
  isProductionStory,
  EntityReview,
  ReviewStatus,
} from '../../types';
import {
  getSourceFeeds,
  computeSourceHealth,
  normalizeFeedUrl,
  isSameFeedUrl,
  extractNormalizedDomain,
  ensureHttpProtocol,
} from '../../utils/urlUtils';
import {
  INITIAL_SOURCES,
  INITIAL_SOURCE_GROUPS,
  INITIAL_ARTICLES,
  INITIAL_STORIES,
  INITIAL_COMPANIES,
  INITIAL_PRODUCTS,
  INITIAL_ANALYSES,
  INITIAL_SETTINGS,
} from './initialData';
import { normalizeStoryDoc } from '../firestore/firestoreRepositories';

const STORAGE_KEYS = {
  SOURCES: 'signalyn_sources_v1',
  DELETED_SOURCES: 'signalyn_deleted_sources_v1',
  GROUPS: 'signalyn_groups_v1',
  ARTICLES: 'signalyn_articles_v1',
  STORIES: 'signalyn_stories_v1',
  STORY_MEMBERSHIPS: 'signalyn_story_memberships_v1',
  STORY_REVIEWS: 'signalyn_story_reviews_v1',
  STORY_RUNS: 'signalyn_story_runs_v1',
  COMPANIES: 'signalyn_companies_v1',
  PRODUCTS: 'signalyn_products_v1',
  ANALYSES: 'signalyn_analyses_v1',
  SETTINGS: 'signalyn_settings_v1',
};

const memoryFallbackStore = new Map<string, string>();

function getStored<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    }
  } catch {}
  const mem = memoryFallbackStore.get(key);
  if (mem) return JSON.parse(mem);
  return fallback;
}

function setStored<T>(key: string, value: T): void {
  const json = JSON.stringify(value);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, json);
      return;
    }
  } catch (err) {
    console.warn(`Signalyn localStorage write failed for ${key}`, err);
  }
  memoryFallbackStore.set(key, json);
}

// ---------------------------------------------------------------------------
// Source Repository
// ---------------------------------------------------------------------------
export class MockSourceRepository implements ISourceRepository {
  private async load(): Promise<Source[]> {
    return getStored<Source[]>(STORAGE_KEYS.SOURCES, INITIAL_SOURCES);
  }

  private async save(sources: Source[]): Promise<void> {
    setStored(STORAGE_KEYS.SOURCES, sources);
  }

  async getAll(): Promise<Source[]> {
    return this.load();
  }

  async getById(id: string): Promise<Source | null> {
    const sources = await this.load();
    return sources.find((s) => s.id === id) || null;
  }

  async getByWebsiteUrl(url: string): Promise<Source | null> {
    const sources = await this.load();
    const cleanUrl = url.trim().toLowerCase().replace(/\/+$/, '');
    return (
      sources.find((s) => s.websiteUrl.trim().toLowerCase().replace(/\/+$/, '') === cleanUrl) ||
      null
    );
  }

  async create(
    sourceInput: Omit<Source, 'id' | 'createdAt' | 'updatedAt' | 'articlesCollected' | 'errorCount'>
  ): Promise<Source> {
    const sources = await this.load();

    // Check duplicate websiteUrl
    const cleanTarget = sourceInput.websiteUrl.trim().toLowerCase().replace(/\/+$/, '');
    const duplicate = sources.find(
      (s) => s.websiteUrl.trim().toLowerCase().replace(/\/+$/, '') === cleanTarget
    );
    if (duplicate) {
      throw new Error(`A source with website URL "${sourceInput.websiteUrl}" already exists.`);
    }

    const now = new Date().toISOString();
    const newSource: Source = {
      ...sourceInput,
      id: `src-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      articlesCollected: 0,
      errorCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    sources.unshift(newSource);
    await this.save(sources);
    return newSource;
  }

  async update(id: string, updates: Partial<Source>): Promise<Source> {
    const sources = await this.load();
    const index = sources.findIndex((s) => s.id === id);
    if (index === -1) {
      throw new Error(`Source not found with id: ${id}`);
    }

    // Check website URL collision if changed
    if (updates.websiteUrl) {
      const cleanTarget = updates.websiteUrl.trim().toLowerCase().replace(/\/+$/, '');
      const duplicate = sources.find(
        (s) => s.id !== id && s.websiteUrl.trim().toLowerCase().replace(/\/+$/, '') === cleanTarget
      );
      if (duplicate) {
        throw new Error(`Another source with website URL "${updates.websiteUrl}" already exists.`);
      }
    }

    const updatedSource: Source = {
      ...sources[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    sources[index] = updatedSource;
    await this.save(sources);
    return updatedSource;
  }

  async delete(id: string, reason?: string): Promise<boolean> {
    const sources = await this.load();
    const target = sources.find((s) => s.id === id);
    if (!target) return false;

    const filtered = sources.filter((s) => s.id !== id);
    await this.save(filtered);

    // Save tombstone
    const deletedSources = getStored<DeletedSource[]>(STORAGE_KEYS.DELETED_SOURCES, []);
    const feeds = getSourceFeeds(target);
    const domain = target.normalizedDomain || extractNormalizedDomain(target.websiteUrl);
    const tombstone: DeletedSource = {
      id: target.id,
      name: target.name,
      websiteUrl: target.websiteUrl,
      normalizedDomain: domain,
      deletedAt: new Date().toISOString(),
      deletionReason: reason || 'Intentionally deleted from Sources Manager',
      articleCount: target.articlesCollected || 0,
      feedCount: feeds.length,
    };
    deletedSources.unshift(tombstone);
    setStored(STORAGE_KEYS.DELETED_SOURCES, deletedSources);

    return true;
  }

  async getDeletedSourceByDomain(rawDomainOrUrl: string): Promise<DeletedSource | null> {
    const domain = extractNormalizedDomain(rawDomainOrUrl);
    const deletedSources = getStored<DeletedSource[]>(STORAGE_KEYS.DELETED_SOURCES, []);
    return deletedSources.find((d) => d.normalizedDomain === domain) || null;
  }

  async getDeletedSources(): Promise<DeletedSource[]> {
    return getStored<DeletedSource[]>(STORAGE_KEYS.DELETED_SOURCES, []);
  }

  async restoreSource(
    deletedSourceId: string,
    sourceInput: Omit<Source, 'id' | 'createdAt' | 'updatedAt' | 'articlesCollected' | 'errorCount'>
  ): Promise<Source> {
    const deletedSources = getStored<DeletedSource[]>(STORAGE_KEYS.DELETED_SOURCES, []);
    const tombstone = deletedSources.find((d) => d.id === deletedSourceId);

    // Remove tombstone
    setStored(
      STORAGE_KEYS.DELETED_SOURCES,
      deletedSources.filter((d) => d.id !== deletedSourceId)
    );

    const now = new Date().toISOString();
    const restoredSource: Source = {
      ...sourceInput,
      id: deletedSourceId,
      articlesCollected: tombstone?.articleCount || 0,
      errorCount: 0,
      failureCount: 0,
      createdAt: tombstone?.deletedAt || now,
      updatedAt: now,
    };

    const sources = await this.load();
    sources.unshift(restoredSource);
    await this.save(sources);
    return restoredSource;
  }

  async toggleStatus(id: string): Promise<Source> {
    const sources = await this.load();
    const source = sources.find((s) => s.id === id);
    if (!source) throw new Error(`Source not found: ${id}`);

    const newStatus = source.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    return this.update(id, { status: newStatus });
  }

  async addFeed(
    sourceId: string,
    feedInput: Omit<SourceFeed, 'id' | 'createdAt' | 'updatedAt' | 'failureCount' | 'articlesCollected'>
  ): Promise<Source> {
    const source = await this.getById(sourceId);
    if (!source) throw new Error(`Source not found: ${sourceId}`);
    const feeds = getSourceFeeds(source);
    const norm = normalizeFeedUrl(feedInput.url);
    if (feeds.some((f) => isSameFeedUrl(f.url, norm))) {
      throw new Error(`Feed URL already exists on this source.`);
    }
    const now = new Date().toISOString();
    const shouldBePrimary = Boolean(feedInput.isPrimary) || feeds.length === 0;
    const newFeed: SourceFeed = {
      id: `feed-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      title: feedInput.title.trim() || 'Feed',
      url: norm,
      feedType: feedInput.feedType || 'RSS',
      categories: feedInput.categories || [],
      status: feedInput.status || 'ACTIVE',
      isPrimary: shouldBePrimary,
      createdAt: now,
      updatedAt: now,
      lastCollectedAt: null,
      lastSuccessfulCollectionAt: null,
      failureCount: 0,
      articlesCollected: 0,
      lastError: null,
    };
    const updatedFeeds = feeds.map((f) => shouldBePrimary ? { ...f, isPrimary: false } : f);
    updatedFeeds.push(newFeed);
    return this.update(sourceId, { feeds: updatedFeeds });
  }

  async updateFeed(sourceId: string, feedId: string, updates: Partial<SourceFeed>): Promise<Source> {
    const source = await this.getById(sourceId);
    if (!source) throw new Error(`Source not found: ${sourceId}`);
    const feeds = getSourceFeeds(source);
    const updatedFeeds = feeds.map((f) => {
      if (f.id === feedId) {
        return { ...f, ...updates, updatedAt: new Date().toISOString() };
      }
      if (updates.isPrimary) {
        return { ...f, isPrimary: false };
      }
      return f;
    });
    return this.update(sourceId, { feeds: updatedFeeds });
  }

  async removeFeed(sourceId: string, feedId: string): Promise<Source> {
    const source = await this.getById(sourceId);
    if (!source) throw new Error(`Source not found: ${sourceId}`);
    const feeds = getSourceFeeds(source);
    const remaining = feeds.filter((f) => f.id !== feedId);
    if (remaining.length > 0 && !remaining.some((f) => f.isPrimary)) {
      remaining[0].isPrimary = true;
    }
    return this.update(sourceId, { feeds: remaining });
  }

  async setPrimaryFeed(sourceId: string, feedId: string): Promise<Source> {
    return this.updateFeed(sourceId, feedId, { isPrimary: true });
  }

  async toggleFeedStatus(sourceId: string, feedId: string): Promise<Source> {
    const source = await this.getById(sourceId);
    if (!source) throw new Error(`Source not found: ${sourceId}`);
    const feeds = getSourceFeeds(source);
    const target = feeds.find((f) => f.id === feedId);
    if (!target) throw new Error(`Feed not found: ${feedId}`);
    const newStatus: FeedStatus = target.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    return this.updateFeed(sourceId, feedId, { status: newStatus });
  }

  async retryFeed(sourceId: string, feedId: string): Promise<Source> {
    return this.updateFeed(sourceId, feedId, { status: 'ACTIVE', failureCount: 0, lastError: null });
  }
}

// ---------------------------------------------------------------------------
// Source Group Repository
// ---------------------------------------------------------------------------
export class MockSourceGroupRepository implements ISourceGroupRepository {
  private async load(): Promise<SourceGroup[]> {
    return getStored<SourceGroup[]>(STORAGE_KEYS.GROUPS, INITIAL_SOURCE_GROUPS);
  }

  private async save(groups: SourceGroup[]): Promise<void> {
    setStored(STORAGE_KEYS.GROUPS, groups);
  }

  async getAll(): Promise<SourceGroup[]> {
    return this.load();
  }

  async getById(id: string): Promise<SourceGroup | null> {
    const groups = await this.load();
    return groups.find((g) => g.id === id) || null;
  }

  async create(group: Omit<SourceGroup, 'id' | 'createdAt' | 'updatedAt'>): Promise<SourceGroup> {
    const groups = await this.load();
    const trimmed = group.name.trim();
    if (groups.some((g) => g.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error(`A source group named "${trimmed}" already exists.`);
    }

    const now = new Date().toISOString();
    const newGroup: SourceGroup = {
      ...group,
      id: `group-${Date.now().toString(36)}`,
      createdAt: now,
      updatedAt: now,
    };

    groups.push(newGroup);
    await this.save(groups);
    return newGroup;
  }

  async update(id: string, updates: Partial<SourceGroup>): Promise<SourceGroup> {
    const groups = await this.load();
    const index = groups.findIndex((g) => g.id === id);
    if (index === -1) throw new Error(`Group not found with id: ${id}`);

    const updated: SourceGroup = {
      ...groups[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    groups[index] = updated;
    await this.save(groups);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const groups = await this.load();
    const filtered = groups.filter((g) => g.id !== id);
    if (filtered.length === groups.length) return false;
    await this.save(filtered);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Article Repository
// ---------------------------------------------------------------------------
export class MockArticleRepository implements IArticleRepository {
  private async load(): Promise<Article[]> {
    return getStored<Article[]>(STORAGE_KEYS.ARTICLES, INITIAL_ARTICLES);
  }

  async getAll(limit = 100): Promise<Article[]> {
    const articles = await this.load();
    return articles.slice(0, limit);
  }

  async getPaginatedArticles(
    pageSize = 25,
    startAfterCursor?: any
  ): Promise<PaginatedArticlesResult> {
    const all = await this.load();
    // Deterministic sort: publishedAt desc, id desc
    const sorted = [...all].sort((a, b) => {
      const timeDiff = new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.id.localeCompare(a.id);
    });

    let startIndex = 0;
    if (startAfterCursor && typeof startAfterCursor === 'string') {
      const idx = sorted.findIndex((a) => a.id === startAfterCursor);
      if (idx !== -1) {
        startIndex = idx + 1;
      }
    } else if (startAfterCursor && startAfterCursor.id) {
      const idx = sorted.findIndex((a) => a.id === startAfterCursor.id);
      if (idx !== -1) {
        startIndex = idx + 1;
      }
    }

    const paged = sorted.slice(startIndex, startIndex + pageSize);
    const lastDocCursor = paged.length > 0 ? paged[paged.length - 1].id : null;
    const hasMore = startIndex + paged.length < sorted.length;

    return {
      articles: paged,
      lastDocCursor,
      hasMore,
      pageSize,
    };
  }

  async getById(id: string): Promise<Article | null> {
    const articles = await this.load();
    return articles.find((a) => a.id === id) || null;
  }

  async getBySourceId(sourceId: string): Promise<Article[]> {
    const articles = await this.load();
    return articles.filter((a) => a.sourceId === sourceId);
  }

  async getByCanonicalUrl(url: string): Promise<Article | null> {
    const articles = await this.load();
    return articles.find((a) => a.canonicalUrl === url) || null;
  }

  async create(articleInput: Omit<Article, 'id' | 'collectedAt' | 'updatedAt'>): Promise<Article> {
    const articles = await this.load();
    const now = new Date().toISOString();
    const newArticle: Article = {
      ...articleInput,
      id: `art-${Date.now().toString(36)}`,
      collectedAt: now,
      updatedAt: now,
    };
    articles.unshift(newArticle);
    setStored(STORAGE_KEYS.ARTICLES, articles);
    return newArticle;
  }

  async search(query: string): Promise<Article[]> {
    const articles = await this.load();
    const q = query.toLowerCase().trim();
    if (!q) return articles;
    return articles.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.excerpt.toLowerCase().includes(q) ||
        a.rawCategories.some((c) => c.toLowerCase().includes(q))
    );
  }

  async countToday(): Promise<number> {
    const articles = await this.load();
    const today = new Date().toISOString().slice(0, 10);
    return articles.filter((a) => a.publishedAt.slice(0, 10) === today).length;
  }

  async countTotal(): Promise<number> {
    const articles = await this.load();
    return articles.length;
  }

  async countByStatus(status: Article['processingStatus']): Promise<number> {
    const articles = await this.load();
    return articles.filter((a) => a.processingStatus === status).length;
  }
}

// ---------------------------------------------------------------------------
// Story Repository
// ---------------------------------------------------------------------------
export class MockStoryRepository implements IStoryRepository {
  private async load(): Promise<Story[]> {
    const raw = getStored<Story[]>(STORAGE_KEYS.STORIES, INITIAL_STORIES);
    return raw.map((s) => normalizeStoryDoc(s, s.id));
  }

  private async save(stories: Story[]): Promise<void> {
    setStored(STORAGE_KEYS.STORIES, stories);
  }

  private loadMemberships(): Record<string, StoryMembership[]> {
    return getStored<Record<string, StoryMembership[]>>(STORAGE_KEYS.STORY_MEMBERSHIPS, {});
  }

  private saveMemberships(memberships: Record<string, StoryMembership[]>): void {
    setStored(STORAGE_KEYS.STORY_MEMBERSHIPS, memberships);
  }

  async getAll(limitCount?: number): Promise<Story[]> {
    const stories = await this.load();
    const sorted = stories.sort((a, b) => {
      const timeB = new Date(b.lastUpdatedAt || b.updatedAt || b.lastSeenAt || b.createdAt || 0).getTime();
      const timeA = new Date(a.lastUpdatedAt || a.updatedAt || a.lastSeenAt || a.createdAt || 0).getTime();
      return timeB - timeA;
    });
    return limitCount ? sorted.slice(0, limitCount) : sorted;
  }

  async getById(id: string): Promise<Story | null> {
    const stories = await this.load();
    return stories.find((s) => s.id === id) || null;
  }

  async getHighPriority(threshold = 80): Promise<Story[]> {
    const stories = await this.getAll();
    return stories.filter((s) => s.importanceScore >= threshold);
  }

  async create(story: Story): Promise<Story> {
    const stories = await this.load();
    stories.unshift(story);
    await this.save(stories);
    return story;
  }

  async update(id: string, updates: Partial<Story>): Promise<Story> {
    const stories = await this.load();
    const idx = stories.findIndex((s) => s.id === id);
    if (idx === -1) throw new Error(`Story not found: ${id}`);

    const now = new Date().toISOString();
    const updated: Story = {
      ...stories[idx],
      ...updates,
      updatedAt: now,
      lastUpdatedAt: updates.lastUpdatedAt || now,
    };
    stories[idx] = updated;
    await this.save(stories);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const stories = await this.load();
    const filtered = stories.filter((s) => s.id !== id);
    if (filtered.length === stories.length) return false;
    await this.save(filtered);

    // Clean memberships
    const allMemberships = this.loadMemberships();
    delete allMemberships[id];
    this.saveMemberships(allMemberships);

    return true;
  }

  async addMembership(storyId: string, membership: StoryMembership): Promise<void> {
    const allMemberships = this.loadMemberships();
    const list = allMemberships[storyId] || [];
    const filtered = list.filter((m) => m.articleId !== membership.articleId);
    filtered.push(membership);
    allMemberships[storyId] = filtered;
    this.saveMemberships(allMemberships);
  }

  async removeMembership(storyId: string, articleId: string): Promise<void> {
    const allMemberships = this.loadMemberships();
    const list = allMemberships[storyId] || [];
    allMemberships[storyId] = list.filter((m) => m.articleId !== articleId);
    this.saveMemberships(allMemberships);
  }

  async getMemberships(storyId: string): Promise<StoryMembership[]> {
    const allMemberships = this.loadMemberships();
    return (allMemberships[storyId] || []).sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
  }

  async mergeStories(targetStoryId: string, sourceStoryId: string): Promise<Story> {
    const target = await this.getById(targetStoryId);
    const source = await this.getById(sourceStoryId);
    if (!target) throw new Error(`Target story not found: ${targetStoryId}`);
    if (!source) throw new Error(`Source story not found: ${sourceStoryId}`);

    const sourceMemberships = await this.getMemberships(sourceStoryId);
    for (const m of sourceMemberships) {
      await this.addMembership(targetStoryId, { ...m, storyId: targetStoryId });
    }

    const allMemberships = this.loadMemberships();
    delete allMemberships[sourceStoryId];
    this.saveMemberships(allMemberships);

    const now = new Date().toISOString();
    const combinedArticles = Array.from(new Set([...target.articleIds, ...source.articleIds]));
    const combinedSources = Array.from(new Set([...target.sourceIds, ...source.sourceIds]));

    const mergedStoryIds = Array.from(
      new Set([...(target.mergeMetadata?.mergedStoryIds || []), sourceStoryId])
    );

    const updatedTarget: Story = {
      ...target,
      articleIds: combinedArticles,
      articleCount: combinedArticles.length,
      sourceIds: combinedSources,
      sourceCount: combinedSources.length,
      mergeMetadata: {
        mergedAt: now,
        mergedStoryIds,
      },
      updatedAt: now,
      lastUpdatedAt: now,
    };

    await this.update(targetStoryId, updatedTarget);
    await this.update(sourceStoryId, {
      status: 'ARCHIVED',
      mergeMetadata: {
        mergedAt: now,
        mergedStoryIds: [targetStoryId],
      },
    });

    return updatedTarget;
  }

  async removeArticleFromStory(
    storyId: string,
    articleId: string
  ): Promise<{ storyDeleted: boolean; updatedStory?: Story }> {
    await this.removeMembership(storyId, articleId);
    const story = await this.getById(storyId);
    if (!story) return { storyDeleted: true };

    const remaining = (story.articleIds || []).filter((id) => id !== articleId);
    if (remaining.length === 0) {
      await this.update(storyId, {
        articleIds: [],
        articleCount: 0,
        status: 'ARCHIVED',
      });
      return { storyDeleted: true };
    }

    const memberships = await this.getMemberships(storyId);
    const sourceIds = Array.from(new Set(memberships.map((m) => m.sourceId)));

    const updatedStory = await this.update(storyId, {
      articleIds: remaining,
      articleCount: remaining.length,
      sourceIds,
      sourceCount: sourceIds.length,
    });

    return { storyDeleted: false, updatedStory };
  }

  async updateStoryAggregates(storyId: string): Promise<Story | null> {
    const story = await this.getById(storyId);
    if (!story) return null;

    const memberships = await this.getMemberships(storyId);
    const articleIds = memberships.map((m) => m.articleId);
    const sourceIds = Array.from(new Set(memberships.map((m) => m.sourceId)));

    return this.update(storyId, {
      articleIds,
      articleCount: articleIds.length,
      sourceIds,
      sourceCount: sourceIds.length,
    });
  }

  async getRecentProductionStories(
    limitCount = 1000
  ): Promise<{ stories: Story[]; lastDoc?: any; hasMore: boolean }> {
    const all = await this.getAll();
    const prod = all.filter(isProductionStory);
    return {
      stories: prod.slice(0, limitCount),
      hasMore: prod.length > limitCount,
    };
  }

  async countProduction(): Promise<number> {
    const all = await this.getAll();
    return all.filter(isProductionStory).length;
  }
}

// ---------------------------------------------------------------------------
// Story Review Repository
// ---------------------------------------------------------------------------
export class MockStoryReviewRepository implements IStoryReviewRepository {
  private async load(): Promise<StoryReview[]> {
    return getStored<StoryReview[]>(STORAGE_KEYS.STORY_REVIEWS, []);
  }

  private async save(reviews: StoryReview[]): Promise<void> {
    setStored(STORAGE_KEYS.STORY_REVIEWS, reviews);
  }

  async getAll(): Promise<StoryReview[]> {
    const reviews = await this.load();
    return reviews.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getPending(): Promise<StoryReview[]> {
    const reviews = await this.load();
    return reviews.filter((r) => r.status === 'PENDING');
  }

  async create(review: StoryReview): Promise<StoryReview> {
    const reviews = await this.load();
    reviews.unshift(review);
    await this.save(reviews);
    return review;
  }

  async updateStatus(
    id: string,
    status: 'PENDING' | 'RESOLVED' | 'DISMISSED',
    resolutionAction?: any
  ): Promise<void> {
    const reviews = await this.load();
    const idx = reviews.findIndex((r) => r.id === id);
    if (idx !== -1) {
      reviews[idx] = {
        ...reviews[idx],
        status,
        resolvedAt: status !== 'PENDING' ? new Date().toISOString() : undefined,
        ...(resolutionAction !== undefined ? { resolutionAction } : {}),
      };
      await this.save(reviews);
    }
  }

  async delete(id: string): Promise<boolean> {
    const reviews = await this.load();
    const filtered = reviews.filter((r) => r.id !== id);
    if (filtered.length === reviews.length) return false;
    await this.save(filtered);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Story Run Repository
// ---------------------------------------------------------------------------
export class MockStoryRunRepository implements IStoryRunRepository {
  private async load(): Promise<StoryRun[]> {
    return getStored<StoryRun[]>(STORAGE_KEYS.STORY_RUNS, []);
  }

  private async save(runs: StoryRun[]): Promise<void> {
    setStored(STORAGE_KEYS.STORY_RUNS, runs);
  }

  async create(run: StoryRun): Promise<StoryRun> {
    const runs = await this.load();
    runs.unshift(run);
    await this.save(runs);
    return run;
  }

  async getAll(max = 50): Promise<StoryRun[]> {
    const runs = await this.load();
    return runs.slice(0, max);
  }

  async getLatest(): Promise<StoryRun | null> {
    const runs = await this.load();
    return runs.length > 0 ? runs[0] : null;
  }
}

// ---------------------------------------------------------------------------
// Company Repository
// ---------------------------------------------------------------------------
export class MockCompanyRepository implements ICompanyRepository {
  private async load(): Promise<Company[]> {
    return getStored<Company[]>(STORAGE_KEYS.COMPANIES, INITIAL_COMPANIES);
  }

  private async save(companies: Company[]): Promise<void> {
    setStored(STORAGE_KEYS.COMPANIES, companies);
  }

  async getAll(): Promise<Company[]> {
    return this.load();
  }

  async getById(id: string): Promise<Company | null> {
    const companies = await this.load();
    return companies.find((c) => c.id === id) || null;
  }

  async getMyCompany(): Promise<Company | null> {
    const companies = await this.load();
    return companies.find((c) => c.isMyCompany) || null;
  }

  async getCompetitors(): Promise<Company[]> {
    const companies = await this.load();
    return companies.filter((c) => c.isCompetitor);
  }

  async update(id: string, updates: Partial<Company>): Promise<Company> {
    const companies = await this.load();
    const index = companies.findIndex((c) => c.id === id);
    if (index === -1) throw new Error(`Company not found with id: ${id}`);
    companies[index] = { ...companies[index], ...updates };
    await this.save(companies);
    return companies[index];
  }

  async setMyCompany(companyId: string): Promise<void> {
    const companies = await this.load();
    const updated = companies.map((c) => ({
      ...c,
      isMyCompany: c.id === companyId,
      isCompetitor: c.id === companyId ? false : true,
    }));
    await this.save(updated);
  }
}

// ---------------------------------------------------------------------------
// Product Repository
// ---------------------------------------------------------------------------
export class MockProductRepository implements IProductRepository {
  private async load(): Promise<Product[]> {
    return getStored<Product[]>(STORAGE_KEYS.PRODUCTS, INITIAL_PRODUCTS);
  }

  async getAll(): Promise<Product[]> {
    return this.load();
  }

  async getByCompanyId(companyId: string): Promise<Product[]> {
    const products = await this.load();
    return products.filter((p) => p.companyId === companyId);
  }

  async getByCategory(category: string): Promise<Product[]> {
    const products = await this.load();
    return products.filter((p) => p.category.toLowerCase() === category.toLowerCase());
  }

  async create(product: Omit<Product, 'id'>): Promise<Product> {
    const products = await this.load();
    const newProduct: Product = {
      ...product,
      id: `prod-${Date.now().toString(36)}`,
    };
    products.push(newProduct);
    setStored(STORAGE_KEYS.PRODUCTS, products);
    return newProduct;
  }
}

// ---------------------------------------------------------------------------
// Article Analysis Repository
// ---------------------------------------------------------------------------
export class MockArticleAnalysisRepository implements IArticleAnalysisRepository {
  async getByArticleId(articleId: string): Promise<ArticleAnalysis | null> {
    const analyses = getStored<ArticleAnalysis[]>(STORAGE_KEYS.ANALYSES, INITIAL_ANALYSES);
    return analyses.find((a) => a.articleId === articleId) || null;
  }

  async getAll(): Promise<ArticleAnalysis[]> {
    return getStored<ArticleAnalysis[]>(STORAGE_KEYS.ANALYSES, INITIAL_ANALYSES);
  }

  async save(analysis: ArticleAnalysis): Promise<void> {
    const analyses = getStored<ArticleAnalysis[]>(STORAGE_KEYS.ANALYSES, INITIAL_ANALYSES);
    const filtered = analyses.filter((a) => a.articleId !== analysis.articleId);
    setStored(STORAGE_KEYS.ANALYSES, [analysis, ...filtered]);
  }

  async delete(articleId: string): Promise<boolean> {
    const analyses = getStored<ArticleAnalysis[]>(STORAGE_KEYS.ANALYSES, INITIAL_ANALYSES);
    const filtered = analyses.filter((a) => a.articleId !== articleId);
    setStored(STORAGE_KEYS.ANALYSES, filtered);
    return true;
  }

  async countTotal(): Promise<number> {
    const analyses = getStored<ArticleAnalysis[]>(STORAGE_KEYS.ANALYSES, INITIAL_ANALYSES);
    return analyses.length;
  }
}

// ---------------------------------------------------------------------------
// Settings Repository
// ---------------------------------------------------------------------------
export class MockSettingsRepository implements ISettingsRepository {
  private updateQueue: Promise<any> = Promise.resolve();

  async getSettings(): Promise<IntelligenceSettings> {
    return getStored<IntelligenceSettings>(STORAGE_KEYS.SETTINGS, INITIAL_SETTINGS);
  }

  async updateSettings(updates: Partial<IntelligenceSettings>): Promise<IntelligenceSettings> {
    const op = this.updateQueue.then(async () => {
      const current = await this.getSettings();
      const mergedCompetitorSets = updates.competitorSets
        ? { ...(current.competitorSets || {}), ...updates.competitorSets }
        : current.competitorSets;
      const updated: IntelligenceSettings = {
        ...current,
        ...updates,
        ...(mergedCompetitorSets ? { competitorSets: mergedCompetitorSets } : {}),
      };
      setStored(STORAGE_KEYS.SETTINGS, updated);
      return updated;
    });

    this.updateQueue = op.catch(() => {});
    return op;
  }
}

// ---------------------------------------------------------------------------
// Metrics Repository
// ---------------------------------------------------------------------------
export class MockMetricsRepository implements IMetricsRepository {
  constructor(
    private sourceRepo: ISourceRepository,
    private articleRepo: IArticleRepository,
    private storyRepo: IStoryRepository,
    private companyRepo: ICompanyRepository
  ) {}

  async getDashboardMetrics(preloaded?: PreloadedDashboardData): Promise<DashboardMetrics> {
    const sources = preloaded?.sources || (await this.sourceRepo.getAll());
    const articles = await this.articleRepo.getAll();
    const stories = preloaded?.stories || (await this.storyRepo.getAll());
    const companies = preloaded?.companies || (await this.companyRepo.getAll());

    const activeSources = sources.filter((s) => s.status === 'ACTIVE').length;
    const errorSources = sources.filter((s) => s.status === 'ERROR').length;

    // Calculate total articles collected reported by sources + stored articles
    const totalCollected = sources.reduce((acc, s) => acc + (s.articlesCollected ?? 0), 0) || articles.length;

    const todayDate = new Date().toISOString().slice(0, 10);
    const articlesToday = articles.filter((a) => a.publishedAt.slice(0, 10) === todayDate).length || 8;

    const productionStories = stories.filter(isProductionStory);
    const highPriority = productionStories.filter((s) => s.importanceScore >= 70).length;
    const totalProductionCount =
      preloaded?.totalProductionStoriesCount ??
      (await this.storyRepo.countProduction?.()) ??
      productionStories.length;

    return {
      articlesCollectedTotal: totalCollected,
      storiesDetected: totalProductionCount,
      activeSources,
      totalSources: sources.length,
      companiesTracked: companies.length,
      highPriorityStories: highPriority,
      articlesToday,
      errorSourcesCount: errorSources,
    };
  }
}

export class MockEntityReviewRepository implements IEntityReviewRepository {
  async getAll(max = 20): Promise<EntityReview[]> {
    const list = getStored<EntityReview[]>(STORAGE_KEYS.STORY_REVIEWS as any, []);
    return list.slice(0, max);
  }

  async getPending(limitCount = 20): Promise<EntityReview[]> {
    const list = getStored<EntityReview[]>(STORAGE_KEYS.STORY_REVIEWS as any, []);
    return list.filter((r) => r.status === 'PENDING').slice(0, limitCount);
  }

  async updateStatus(id: string, status: ReviewStatus): Promise<void> {
    const list = getStored<EntityReview[]>(STORAGE_KEYS.STORY_REVIEWS as any, []);
    const idx = list.findIndex((r) => r.id === id);
    if (idx !== -1) {
      list[idx].status = status;
      setStored(STORAGE_KEYS.STORY_REVIEWS as any, list);
    }
  }
}

export function resetAllMockData(): void {
  Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
}
