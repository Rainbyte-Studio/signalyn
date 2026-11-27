/**
 * Signalyn Repository Interfaces
 * Defines contracts for all data interactions.
 * Enables zero-friction migration to Cloud Firestore in future phases.
 */

import {
  Source,
  SourceFeed,
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
} from '../types';

export interface ISourceRepository {
  getAll(): Promise<Source[]>;
  getById(id: string): Promise<Source | null>;
  getByWebsiteUrl(url: string): Promise<Source | null>;
  create(source: Omit<Source, 'id' | 'createdAt' | 'updatedAt' | 'articlesCollected' | 'errorCount'> & { customId?: string }): Promise<Source>;
  update(id: string, updates: Partial<Source>): Promise<Source>;
  delete(id: string, reason?: string): Promise<boolean>;
  getDeletedSourceByDomain(domain: string): Promise<DeletedSource | null>;
  getDeletedSources(): Promise<DeletedSource[]>;
  restoreSource(deletedSourceId: string, source: Omit<Source, 'id' | 'createdAt' | 'updatedAt' | 'articlesCollected' | 'errorCount'>): Promise<Source>;
  toggleStatus(id: string): Promise<Source>;
  addFeed(sourceId: string, feed: Omit<SourceFeed, 'id' | 'createdAt' | 'updatedAt' | 'failureCount' | 'articlesCollected'>): Promise<Source>;
  updateFeed(sourceId: string, feedId: string, updates: Partial<SourceFeed>): Promise<Source>;
  removeFeed(sourceId: string, feedId: string): Promise<Source>;
  setPrimaryFeed(sourceId: string, feedId: string): Promise<Source>;
  toggleFeedStatus(sourceId: string, feedId: string): Promise<Source>;
  retryFeed(sourceId: string, feedId: string): Promise<Source>;
}

export interface ISourceGroupRepository {
  getAll(): Promise<SourceGroup[]>;
  getById(id: string): Promise<SourceGroup | null>;
  create(group: Omit<SourceGroup, 'id' | 'createdAt' | 'updatedAt'>): Promise<SourceGroup>;
  update(id: string, updates: Partial<SourceGroup>): Promise<SourceGroup>;
  delete(id: string): Promise<boolean>;
}

export interface PaginatedArticlesResult {
  articles: Article[];
  lastDocCursor: any;
  hasMore: boolean;
  pageSize: number;
}

export interface IArticleRepository {
  getAll(limit?: number): Promise<Article[]>;
  getPaginatedArticles(pageSize?: number, startAfterCursor?: any): Promise<PaginatedArticlesResult>;
  getById(id: string): Promise<Article | null>;
  getBySourceId(sourceId: string): Promise<Article[]>;
  getByCanonicalUrl(url: string): Promise<Article | null>;
  create(article: Omit<Article, 'id' | 'collectedAt' | 'updatedAt'>): Promise<Article>;
  search(query: string): Promise<Article[]>;
  countToday(): Promise<number>;
  countTotal(): Promise<number>;
  countByStatus(status: Article['processingStatus']): Promise<number>;
}

export interface IStoryRepository {
  getAll(limitCount?: number): Promise<Story[]>;
  getById(id: string): Promise<Story | null>;
  getHighPriority(threshold?: number): Promise<Story[]>;
  create(story: Story): Promise<Story>;
  update(id: string, updates: Partial<Story>): Promise<Story>;
  delete(id: string): Promise<boolean>;
  addMembership(storyId: string, membership: StoryMembership): Promise<void>;
  removeMembership(storyId: string, articleId: string): Promise<void>;
  getMemberships(storyId: string): Promise<StoryMembership[]>;
  mergeStories(targetStoryId: string, sourceStoryId: string): Promise<Story>;
  removeArticleFromStory(storyId: string, articleId: string): Promise<{ storyDeleted: boolean; updatedStory?: Story }>;
  updateStoryAggregates(storyId: string): Promise<Story | null>;
  getRecentProductionStories(limitCount?: number, startAfterCursor?: any): Promise<{ stories: Story[]; lastDoc?: any; hasMore: boolean }>;
  countProduction(): Promise<number>;
}

export interface IStoryReviewRepository {
  getAll(): Promise<StoryReview[]>;
  getPending(): Promise<StoryReview[]>;
  create(review: StoryReview): Promise<StoryReview>;
  updateStatus(id: string, status: 'PENDING' | 'RESOLVED' | 'DISMISSED', resolutionAction?: any): Promise<void>;
  delete(id: string): Promise<boolean>;
}

export interface IStoryRunRepository {
  create(run: StoryRun): Promise<StoryRun>;
  getAll(max?: number): Promise<StoryRun[]>;
  getLatest(): Promise<StoryRun | null>;
}

export interface ICompanyRepository {
  getAll(): Promise<Company[]>;
  getById(id: string): Promise<Company | null>;
  getMyCompany(): Promise<Company | null>;
  getCompetitors(): Promise<Company[]>;
  update(id: string, updates: Partial<Company>): Promise<Company>;
  setMyCompany(companyId: string): Promise<void>;
}

export interface IProductRepository {
  getAll(): Promise<Product[]>;
  getByCompanyId(companyId: string): Promise<Product[]>;
  getByCategory(category: string): Promise<Product[]>;
  create(product: Omit<Product, 'id'>): Promise<Product>;
}

export interface IArticleAnalysisRepository {
  getByArticleId(articleId: string): Promise<ArticleAnalysis | null>;
  getAll(max?: number): Promise<ArticleAnalysis[]>;
  save(analysis: ArticleAnalysis): Promise<void>;
  delete(articleId: string): Promise<boolean>;
  countTotal(): Promise<number>;
}

export interface IEntityReviewRepository {
  getAll(max?: number): Promise<EntityReview[]>;
  getPending(limitCount?: number): Promise<EntityReview[]>;
  updateStatus(id: string, status: ReviewStatus): Promise<void>;
}

export interface ISettingsRepository {
  getSettings(): Promise<IntelligenceSettings>;
  updateSettings(updates: Partial<IntelligenceSettings>): Promise<IntelligenceSettings>;
}

export interface PreloadedDashboardData {
  sources?: Source[];
  stories?: Story[];
  companies?: Company[];
  pendingReviews?: EntityReview[];
  entityReviews?: EntityReview[];
  totalProductionStoriesCount?: number;
}

export interface IMetricsRepository {
  getDashboardMetrics(preloaded?: PreloadedDashboardData): Promise<DashboardMetrics>;
}
