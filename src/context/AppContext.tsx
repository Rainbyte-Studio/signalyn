/**
 * Signalyn Application Context
 * 
 * Provides unified state management across the application shell,
 * backed by real Cloud Firestore repositories, server-side ingestion
 * runner, live feed discovery, and Firebase Authentication.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  signInAnonymously,
} from 'firebase/auth';
import { auth, db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import {
  Source,
  SourceFeed,
  SourceGroup,
  Article,
  Story,
  StoryMembership,
  Company,
  Product,
  ArticleAnalysis,
  EntityReview,
  ReviewStatus,
  ProductLifecycleStatus,
  ProductEntityLevel,
  IntelligenceSettings,
  DashboardMetrics,
  NavigationTab,
  DeletedSource,
} from '../types';
import {
  FirestoreSourceRepository,
  FirestoreSourceGroupRepository,
  FirestoreArticleRepository,
  FirestoreStoryRepository,
  FirestoreStoryReviewRepository,
  FirestoreStoryRunRepository,
  FirestoreCompanyRepository,
  FirestoreProductRepository,
  FirestoreArticleAnalysisRepository,
  FirestoreEntityReviewRepository,
  FirestoreSettingsRepository,
  FirestoreMetricsRepository,
  seedFirestoreIfEmpty,
} from '../repositories/firestore/firestoreRepositories';
import { RealFeedDiscoveryService } from '../services/feedDiscoveryService';
import { collectorClient, CollectorRunStats, CollectorStatus } from '../services/collectorClientService';
import { aiIntelligenceService, BatchAnalysisResponse } from '../services/aiIntelligenceService';
import {
  linkEntityReviewToExisting,
  promoteEntityReviewToCompany,
  promoteEntityReviewToProduct,
  dismissEntityReviewAsNonStrategic,
  rejectEntityReview as rejectEntityReviewService,
} from '../services/entityReviewClientService';
import {
  buildNavigationHash,
  parseNavigationHash,
} from '../utils/navigationSync';

interface Notification {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
}

interface AppContextValue {
  // Navigation
  activeTab: NavigationTab;
  setActiveTab: (tab: NavigationTab) => void;
  selectedStoryId: string | null;
  setSelectedStoryId: (id: string | null) => void;
  navigateToStory: (storyId: string) => void;

  // Authentication & Authorization (Phase 5S-D2-A)
  currentUser: User | null;
  isAuthLoading: boolean;
  isAdmin: boolean;
  isCheckingAdmin: boolean;
  canManage: boolean;
  requireAdminPrivilege: (actionName: string) => boolean;
  signInWithGoogle: () => Promise<void>;
  signInAsGuest: () => Promise<void>;
  logout: () => Promise<void>;

  // Data State
  sources: Source[];
  deletedSources: DeletedSource[];
  sourceGroups: SourceGroup[];
  articles: Article[];
  totalArticlesCount: number;
  hasMoreArticles: boolean;
  isLoadingMoreArticles: boolean;
  loadMoreArticles: () => Promise<void>;
  resetArticlePagination: () => Promise<void>;
  stories: Story[];
  companies: Company[];
  products: Product[];
  settings: IntelligenceSettings | null;
  metrics: DashboardMetrics | null;
  isLoading: boolean;
  error: string | null;

  // Phase 3: AI Analysis & Intelligence
  analyses: Record<string, ArticleAnalysis>;
  entityReviews: EntityReview[];
  isAnalyzing: boolean;
  analyzingArticleId: string | null;
  analyzeArticle: (articleId: string, forceReanalyze?: boolean) => Promise<ArticleAnalysis | null>;
  analyzeBatch: (articleIds: string[], forceReanalyze?: boolean) => Promise<BatchAnalysisResponse>;
  analyzePendingArticles: (maxCount?: number) => Promise<BatchAnalysisResponse>;
  updateEntityReviewStatus: (reviewId: string, status: ReviewStatus) => Promise<void>;
  linkEntityReview: (
    reviewId: string,
    params: {
      canonicalId: string;
      canonicalName: string;
      entityType: 'COMPANY' | 'PRODUCT';
      addAlias?: boolean;
    }
  ) => Promise<void>;
  promoteCompanyFromReview: (
    reviewId: string,
    companyData: {
      name: string;
      aliases?: string[];
      categories?: string[];
      tracked?: boolean;
      website?: string;
    }
  ) => Promise<void>;
  promoteProductFromReview: (
    reviewId: string,
    productData: {
      name: string;
      companyId: string;
      category: string;
      subcategory?: string;
      lifecycle?: ProductLifecycleStatus;
      entityLevel?: ProductEntityLevel;
      aliases?: string[];
    }
  ) => Promise<void>;
  dismissReviewAsNonStrategic: (reviewId: string, reason?: string) => Promise<void>;
  rejectReview: (reviewId: string, reason?: string) => Promise<void>;

  // Stories & Memberships (Phase 4C.2)
  getStoryMemberships: (storyId: string) => Promise<StoryMembership[]>;
  getStoryConnectedArticles: (storyId: string) => Promise<{ membership: StoryMembership; article?: Article }[]>;
  loadAllStories: () => Promise<void>;

  // Ingestion & Collection
  isCollecting: boolean;
  collectorStatus: CollectorStatus | null;
  runCollector: (sourceId?: string, feedId?: string) => Promise<CollectorRunStats | void>;

  // Services
  feedDiscoveryService: RealFeedDiscoveryService;
  aiService: typeof aiIntelligenceService;

  // Actions: Sources
  refreshData: () => Promise<void>;
  createSource: (
    source: Omit<Source, 'id' | 'createdAt' | 'updatedAt' | 'articlesCollected' | 'errorCount'> & { customId?: string }
  ) => Promise<Source>;
  updateSource: (id: string, updates: Partial<Source>) => Promise<Source>;
  deleteSource: (id: string, reason?: string) => Promise<boolean>;
  restoreSource: (
    deletedSourceId: string,
    source: Omit<Source, 'id' | 'createdAt' | 'updatedAt' | 'articlesCollected' | 'errorCount'>
  ) => Promise<Source>;
  getDeletedSourceByDomain: (domain: string) => Promise<DeletedSource | null>;
  toggleSourceStatus: (id: string) => Promise<Source>;
  addSourceFeed: (
    sourceId: string,
    feed: Omit<SourceFeed, 'id' | 'createdAt' | 'updatedAt' | 'failureCount' | 'articlesCollected'>
  ) => Promise<Source>;
  updateSourceFeed: (sourceId: string, feedId: string, updates: Partial<SourceFeed>) => Promise<Source>;
  removeSourceFeed: (sourceId: string, feedId: string) => Promise<Source>;
  setPrimarySourceFeed: (sourceId: string, feedId: string) => Promise<Source>;
  toggleSourceFeedStatus: (sourceId: string, feedId: string) => Promise<Source>;
  retrySourceFeed: (sourceId: string, feedId: string) => Promise<Source>;

  // Actions: Source Groups
  createSourceGroup: (
    group: Omit<SourceGroup, 'id' | 'createdAt' | 'updatedAt'>
  ) => Promise<SourceGroup>;
  updateSourceGroup: (id: string, updates: Partial<SourceGroup>) => Promise<SourceGroup>;
  deleteSourceGroup: (id: string) => Promise<boolean>;

  // Actions: Companies & Settings
  setPrimaryCompany: (companyId: string) => Promise<void>;
  updateSettings: (updates: Partial<IntelligenceSettings>) => Promise<IntelligenceSettings>;
  resetMockData: () => Promise<void>;

  // Notifications
  notifications: Notification[];
  dismissNotification: (id: string) => void;
  notify: (type: Notification['type'], title: string, message?: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

// Firestore Repository Instances
const sourceRepo = new FirestoreSourceRepository();
const sourceGroupRepo = new FirestoreSourceGroupRepository();
const articleRepo = new FirestoreArticleRepository();
const storyRepo = new FirestoreStoryRepository();
const storyReviewRepo = new FirestoreStoryReviewRepository();
const storyRunRepo = new FirestoreStoryRunRepository();
const companyRepo = new FirestoreCompanyRepository();
const productRepo = new FirestoreProductRepository();
const analysisRepo = new FirestoreArticleAnalysisRepository();
const reviewRepo = new FirestoreEntityReviewRepository();
const settingsRepo = new FirestoreSettingsRepository();
const metricsRepo = new FirestoreMetricsRepository(
  sourceRepo,
  articleRepo,
  storyRepo,
  companyRepo,
  analysisRepo,
  reviewRepo
);

const feedDiscoveryService = new RealFeedDiscoveryService();

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initialNav = parseNavigationHash(
    typeof window !== 'undefined' ? window.location.hash : ''
  );
  const [activeTab, setActiveTabState] = useState<NavigationTab>(initialNav.activeTab);
  const activeTabRef = useRef<NavigationTab>(initialNav.activeTab);
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);

  const setActiveTab = useCallback((tab: NavigationTab) => {
    activeTabRef.current = tab;
    setActiveTabState(tab);

    if (typeof window !== 'undefined') {
      const currentHash = window.location.hash || '';
      const targetHash = buildNavigationHash(tab, {
        currentHash,
        preserveExistingSettingsHash: tab === 'settings',
      });
      if (currentHash !== targetHash) {
        window.history.pushState({ activeTab: tab }, '', targetHash);
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncFromBrowserLocation = (event?: PopStateEvent | HashChangeEvent) => {
      const rawHash = window.location.hash || '';
      const historyStateTab =
        event && 'state' in event && event.state?.activeTab
          ? (event.state.activeTab as NavigationTab)
          : window.history.state?.activeTab;

      const resolved = parseNavigationHash(rawHash, {
        currentActiveTab: activeTabRef.current,
        historyStateTab,
      });

      activeTabRef.current = resolved.activeTab;
      setActiveTabState(resolved.activeTab);

      if (resolved.isUnknownFallback && window.location.hash !== resolved.canonicalHash) {
        window.history.replaceState(
          { activeTab: resolved.activeTab },
          '',
          resolved.canonicalHash
        );
      }
    };

    const initialResolved = parseNavigationHash(window.location.hash || '', {
      currentActiveTab: activeTabRef.current,
      historyStateTab: window.history.state?.activeTab,
    });
    if (!window.location.hash || initialResolved.isUnknownFallback) {
      window.history.replaceState(
        { activeTab: initialResolved.activeTab },
        '',
        initialResolved.canonicalHash
      );
    }

    window.addEventListener('popstate', syncFromBrowserLocation);
    window.addEventListener('hashchange', syncFromBrowserLocation);
    return () => {
      window.removeEventListener('popstate', syncFromBrowserLocation);
      window.removeEventListener('hashchange', syncFromBrowserLocation);
    };
  }, []);

  const navigateToStory = useCallback(
    (storyId: string) => {
      setSelectedStoryId(storyId);
      setActiveTab('stories');
    },
    [setActiveTab]
  );

  // Auth State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [isCheckingAdmin, setIsCheckingAdmin] = useState<boolean>(false);

  // Data State
  const [sources, setSources] = useState<Source[]>([]);
  const [deletedSources, setDeletedSources] = useState<DeletedSource[]>([]);
  const [sourceGroups, setSourceGroups] = useState<SourceGroup[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [totalArticlesCount, setTotalArticlesCount] = useState<number>(0);
  const [hasMoreArticles, setHasMoreArticles] = useState<boolean>(true);
  const [isLoadingMoreArticles, setIsLoadingMoreArticles] = useState<boolean>(false);
  const articleLastCursorRef = useRef<any>(null);
  const refreshRequest = useRef(0);
  const articlePageVersion = useRef(0);
  const loadedArticleCount = useRef(25);
  const includeStoryArchive = useRef(false);
  const [stories, setStories] = useState<Story[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<IntelligenceSettings | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Phase 3: AI Analysis & Intelligence State
  const [analyses, setAnalyses] = useState<Record<string, ArticleAnalysis>>({});
  const [entityReviews, setEntityReviews] = useState<EntityReview[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analyzingArticleId, setAnalyzingArticleId] = useState<string | null>(null);

  // Collector State: Authoritative Server-Driven Pattern
  const [isTriggering, setIsTriggering] = useState<boolean>(false);
  const [collectorStatus, setCollectorStatus] = useState<CollectorStatus | null>(null);

  const isCollecting = Boolean(collectorStatus ? collectorStatus.isRunning : isTriggering);

  const [notifications, setNotifications] = useState<Notification[]>([]);

  const notify = useCallback((type: Notification['type'], title: string, message?: string) => {
    const id = `notif-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    setNotifications((prev) => [...prev, { id, type, title, message }]);

    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 4500);
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Centralized administrator privilege state:
  // Strict fail-closed: Defaults to false while authentication or admin role verification is unresolved.
  const canManage = Boolean(!isAuthLoading && !isCheckingAdmin && isAdmin);

  const requireAdminPrivilege = useCallback(
    (actionName: string): boolean => {
      if (!canManage) {
        notify(
          'error',
          'Permission Denied',
          `Administrator privileges are required to ${actionName}. Guest sessions are strictly read-only.`
        );
        return false;
      }
      return true;
    },
    [canManage, notify]
  );

  // Listen to Firebase Auth & evaluate explicit administrator privileges (Phase 5S-D2-A)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      setIsAuthLoading(false);

      if (!user) {
        setIsAdmin(false);
        setIsCheckingAdmin(false);
        return;
      }

      setIsCheckingAdmin(true);
      try {
        const idTokenResult = await user.getIdTokenResult(true);
        // Explicit administrator check:
        // 1. Canonical Firebase custom claim 'admin'
        const hasAdminClaim = Boolean(idTokenResult.claims.admin);

        // 2. Admin registry document check in Firestore (/admins/{uid})
        let hasAdminDoc = false;
        try {
          const adminDocSnap = await getDoc(doc(db, 'admins', user.uid));
          hasAdminDoc = adminDocSnap.exists();
        } catch {
          hasAdminDoc = false;
        }

        // 3. Environment owner verification (strictly requiring verified email or UID match)
        const configuredOwnerEmail = (import.meta.env.VITE_SIGNALYN_OWNER_EMAIL || 'n.kalogerogiannis@gmail.com')
          .trim()
          .toLowerCase();
        const configuredOwnerUid = (import.meta.env.VITE_SIGNALYN_OWNER_UID || '').trim();

        const isOwnerUid = Boolean(configuredOwnerUid && user.uid === configuredOwnerUid);
        const isOwnerEmail = Boolean(
          configuredOwnerEmail &&
          user.email &&
          user.email.toLowerCase() === configuredOwnerEmail &&
          user.emailVerified
        );

        setIsAdmin(hasAdminClaim || hasAdminDoc || isOwnerUid || isOwnerEmail);
      } catch (err) {
        console.warn('[Signalyn Auth] Notice verifying administrator token:', err);
        setIsAdmin(false);
      } finally {
        setIsCheckingAdmin(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      notify('success', 'Authentication Successful', 'Signed in with Google.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed';
      notify('error', 'Sign-in Failed', msg);
    }
  };

  const signInAsGuest = async () => {
    try {
      await signInAnonymously(auth);
      notify('info', 'Guest Session', 'Signed in as guest analyst.');
    } catch {
      notify(
        'info',
        'Public Read-Only Mode Active',
        'Anonymous auth is restricted by project policy. Public browsing and data exploration are active under security rules without login.'
      );
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      notify('info', 'Signed Out', 'You have been signed out.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sign out failed';
      notify('error', 'Sign-out Error', msg);
    }
  };

  // Poll collector status periodically
  const refreshCollectorStatus = useCallback(async () => {
    try {
      const status = await collectorClient.getStatus();
      setCollectorStatus(status);
      setIsTriggering(false);
    } catch {
      // Backend may be booting up
    }
  }, []);

  useEffect(() => {
    refreshCollectorStatus();
    const interval = setInterval(refreshCollectorStatus, 30000);
    return () => clearInterval(interval);
  }, [refreshCollectorStatus]);

  const refreshData = useCallback(async (preserveExpandedResults = false) => {
    const request = ++refreshRequest.current;
    const pageVersion = ++articlePageVersion.current;
    const loadStoryArchive = includeStoryArchive.current;
    try {
      setIsLoading(true);
      setError(null);

      const [
        loadedSources,
        loadedDeletedSources,
        loadedGroups,
        paginatedArticlesRes,
        serverTotalArticles,
        recentStoriesRes,
        totalStoriesCount,
        loadedCompanies,
        loadedProducts,
        loadedSettings,
        loadedAnalyses,
        loadedReviews,
      ] = await Promise.all([
        sourceRepo.getAll(),
        sourceRepo.getDeletedSources().catch(() => []),
        sourceGroupRepo.getAll(),
        articleRepo.getPaginatedArticles(preserveExpandedResults ? loadedArticleCount.current : 25),
        articleRepo.countTotal().catch(() => 0),
        loadStoryArchive
          ? storyRepo.getAll().then((stories) => ({ stories }))
          : storyRepo.getRecentProductionStories(1000),
        storyRepo.countProduction().catch(() => 108),
        companyRepo.getAll(),
        productRepo.getAll(),
        settingsRepo.getSettings(),
        analysisRepo.getAll(50).catch(() => []),
        (canManage ? reviewRepo.getArchive() : reviewRepo.getAll(20)).catch(() => null),
      ]);

      const loadedStories = recentStoriesRes.stories;
      const loadedArticles = paginatedArticlesRes.articles;
      if (request !== refreshRequest.current) return;
      if (pageVersion === articlePageVersion.current) {
        ++articlePageVersion.current;
        loadedArticleCount.current = Math.max(25, loadedArticles.length);
        articleLastCursorRef.current = paginatedArticlesRes.lastDocCursor;
        setHasMoreArticles(paginatedArticlesRes.hasMore);
        setTotalArticlesCount(serverTotalArticles || loadedArticles.length);
        setArticles(loadedArticles);
      }

      const analysisMap: Record<string, ArticleAnalysis> = {};
      for (const a of loadedAnalyses) {
        analysisMap[a.articleId] = a;
      }

      setSources(loadedSources);
      setDeletedSources(loadedDeletedSources);
      setSourceGroups(loadedGroups);
      if (loadStoryArchive === includeStoryArchive.current) setStories(loadedStories);
      setCompanies(loadedCompanies);
      setProducts(loadedProducts);
      setSettings(loadedSettings);
      setAnalyses(analysisMap);
      if (loadedReviews) setEntityReviews(loadedReviews);
      else if (canManage) notify('error', 'Entity Reviews Unavailable', 'Could not refresh the entity review queue.');

      const loadedMetrics = await metricsRepo.getDashboardMetrics({
        sources: loadedSources,
        stories: loadedStories,
        companies: loadedCompanies,
        entityReviews: loadedReviews ?? undefined,
        totalProductionStoriesCount: totalStoriesCount,
      });
      if (request === refreshRequest.current) setMetrics(loadedMetrics);
    } catch (err: unknown) {
      if (request !== refreshRequest.current) return;
      const msg = err instanceof Error ? err.message : 'Failed to connect to Cloud Firestore.';
      setError(msg);
      notify('error', 'Firestore Connection Error', msg);
    } finally {
      if (request === refreshRequest.current) setIsLoading(false);
    }
  }, [canManage, notify]);

  useEffect(() => {
    refreshData();
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshData(true);
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => document.removeEventListener('visibilitychange', refreshWhenVisible);
  }, [refreshData]);

  // Active collector polling loop: polls every 2 seconds while collector is running on server
  useEffect(() => {
    if (!collectorStatus?.isRunning) {
      return;
    }

    let isMounted = true;
    const pollInterval = setInterval(async () => {
      try {
        const status = await collectorClient.getStatus();
        if (!isMounted) return;

        setCollectorStatus(status);
        setIsTriggering(false);

        // Terminal state reached: isRunning is now false
        if (!status.isRunning) {
          await refreshData();

          if (status.staleRunRecovered) {
            notify(
              'warning',
              'Collector Stale Run Recovered',
              'A previous collection run exceeded the maximum execution window and was safely recovered.'
            );
          } else if (status.lastRun?.status === 'SUCCESS' || status.lastRun?.status === 'PARTIAL_SUCCESS') {
            notify(
              status.lastRun.status === 'SUCCESS' ? 'success' : 'warning',
              `Ingestion Cycle Complete (${status.lastRun.status})`,
              `Discovered ${status.lastRun.articlesDiscovered} items, created ${status.lastRun.articlesCreated} new articles, skipped ${status.lastRun.duplicatesSkipped} duplicates.`
            );
          } else if (status.lastRun?.status === 'FAILED') {
            const errorDetail =
              status.lastRun.errors?.[0]?.error || 'Collection cycle encountered fatal errors.';
            notify('error', 'Ingestion Cycle Failed', errorDetail);
          }
        }
      } catch {
        // Ignore transient poll network errors
      }
    }, 2000);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
    };
  }, [collectorStatus?.isRunning, notify, refreshData]);

  // Phase 3: AI Intelligence Actions
  const analyzeArticle = async (
    articleId: string,
    forceReanalyze?: boolean
  ): Promise<ArticleAnalysis | null> => {
    if (!requireAdminPrivilege('trigger Gemini analysis')) {
      return null;
    }

    setIsAnalyzing(true);
    setAnalyzingArticleId(articleId);

    // Optimistically mark article as PROCESSING in UI
    setArticles((prev) =>
      prev.map((a) => (a.id === articleId ? { ...a, processingStatus: 'PROCESSING' } : a))
    );

    try {
      const res = await aiIntelligenceService.analyzeArticle(articleId, { forceReanalyze });

      if (res.success && res.skipped) {
        setArticles((prev) =>
          prev.map((a) =>
            a.id === articleId
              ? {
                  ...a,
                  processingStatus: 'SKIPPED_STRATEGIC_SCOPE',
                  relevanceDecision: 'OUT_OF_SCOPE',
                  relevanceReason: res.skipReason || 'Out of strategic mobile scope',
                  analysisError: undefined,
                }
              : a
          )
        );
        notify(
          'info',
          'Scope Filtered',
          `Article is out of strategic mobile scope (${res.skipReason || 'Out of scope'}). Gemini was not called.`
        );
        return null;
      }

      if (res.success && res.analysis) {
        const analysis = res.analysis;
        setAnalyses((prev) => ({ ...prev, [articleId]: analysis }));
        setArticles((prev) =>
          prev.map((a) =>
            a.id === articleId
              ? {
                  ...a,
                  processingStatus: 'ANALYZED',
                  analysisError: undefined,
                  lastAnalysisAttemptAt: analysis.analyzedAt,
                }
              : a
          )
        );

        // Refresh reviews and metrics
        const [updatedReviews, updatedMetrics] = await Promise.all([
          reviewRepo.getArchive().catch(() => null),
          metricsRepo.getDashboardMetrics().catch(() => null),
        ]);
        if (updatedReviews) setEntityReviews(updatedReviews);
        if (updatedMetrics) setMetrics(updatedMetrics);

        notify(
          'success',
          'Gemini Analysis Complete',
          `"${res.analysis.newsType}" (Score: ${res.analysis.importanceScore}/100, Relevance: ${res.analysis.competitiveRelevance?.score ?? 0}%)`
        );
        return analysis;
      } else {
        const errMsg = res.error || 'Analysis failed.';
        setArticles((prev) =>
          prev.map((a) =>
            a.id === articleId ? { ...a, processingStatus: 'FAILED', analysisError: errMsg } : a
          )
        );
        notify('error', 'Analysis Failed', errMsg);
        return null;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Article analysis failed.';
      setArticles((prev) =>
        prev.map((a) =>
          a.id === articleId ? { ...a, processingStatus: 'FAILED', analysisError: msg } : a
        )
      );
      notify('error', 'Analysis Error', msg);
      return null;
    } finally {
      setIsAnalyzing(false);
      setAnalyzingArticleId(null);
    }
  };

  const analyzeBatch = async (
    articleIds: string[],
    forceReanalyze?: boolean
  ): Promise<BatchAnalysisResponse> => {
    if (!requireAdminPrivilege('trigger batch Gemini analysis')) {
      return {
        runId: '',
        totalAttempted: 0,
        succeeded: 0,
        skipped: 0,
        failed: 0,
        durationMs: 0,
        results: [],
      };
    }

    setIsAnalyzing(true);
    notify('info', 'Batch Analysis Started', `Processing ${articleIds.length} articles with Gemini...`);

    try {
      const res = await aiIntelligenceService.analyzeBatch(articleIds, { forceReanalyze });
      await refreshData();

      notify(
        res.succeeded > 0 ? 'success' : 'error',
        'Batch Analysis Complete',
        `${res.succeeded} succeeded, ${res.failed} failed out of ${res.totalAttempted} articles.`
      );
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Batch analysis failed.';
      notify('error', 'Batch Analysis Error', msg);
      throw err;
    } finally {
      setIsAnalyzing(false);
    }
  };

  const analyzePendingArticles = async (maxCount = 5): Promise<BatchAnalysisResponse> => {
    if (!requireAdminPrivilege('process pending analysis queue')) {
      return {
        runId: '',
        totalAttempted: 0,
        succeeded: 0,
        skipped: 0,
        failed: 0,
        durationMs: 0,
        results: [],
      };
    }

    setIsAnalyzing(true);
    notify('info', 'Analyzing Pending Queue', `Analyzing up to ${maxCount} pending articles with Gemini...`);

    try {
      const res = await aiIntelligenceService.analyzePendingArticles(maxCount);
      await refreshData();

      if (res.totalAttempted === 0) {
        notify('info', 'Queue Clean', 'No pending articles found awaiting analysis.');
      } else {
        notify(
          res.succeeded > 0 ? 'success' : 'warning',
          'Pending Queue Processed',
          `${res.succeeded} analyzed successfully, ${res.failed} failed.`
        );
      }
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Queue processing failed.';
      notify('error', 'Queue Error', msg);
      throw err;
    } finally {
      setIsAnalyzing(false);
    }
  };

  const updateEntityReviewStatus = async (reviewId: string, status: ReviewStatus): Promise<void> => {
    if (!requireAdminPrivilege('update entity review status')) {
      return;
    }
    try {
      await reviewRepo.updateStatus(reviewId, status);
      setEntityReviews((prev) =>
        prev.map((r) => (r.id === reviewId ? { ...r, status, reviewedAt: new Date().toISOString() } : r))
      );
      const updatedMetrics = await metricsRepo.getDashboardMetrics();
      setMetrics(updatedMetrics);
      notify('success', 'Review Updated', `Entity marked as ${status}.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not update entity status.';
      notify('error', 'Review Update Failed', msg);
    }
  };

  const linkEntityReview = async (
    reviewId: string,
    params: {
      canonicalId: string;
      canonicalName: string;
      entityType: 'COMPANY' | 'PRODUCT';
      addAlias?: boolean;
    }
  ): Promise<void> => {
    if (!requireAdminPrivilege('link entity to canonical catalog')) {
      return;
    }
    try {
      const res = await linkEntityReviewToExisting(reviewId, params);
      setEntityReviews((prev) =>
        prev.map((r) => (r.id === reviewId ? { ...r, ...res.review } : r))
      );
      if (params.addAlias) {
        if (params.entityType === 'COMPANY') {
          const updated = await companyRepo.getAll();
          setCompanies(updated);
        } else {
          const updated = await productRepo.getAll();
          setProducts(updated);
        }
      }
      const updatedMetrics = await metricsRepo.getDashboardMetrics();
      setMetrics(updatedMetrics);
      notify('success', 'Entity Linked', `Successfully linked to canonical "${params.canonicalName}".`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not link entity.';
      notify('error', 'Link Failed', msg);
      throw err;
    }
  };

  const promoteCompanyFromReview = async (
    reviewId: string,
    companyData: {
      name: string;
      aliases?: string[];
      categories?: string[];
      tracked?: boolean;
      website?: string;
    }
  ): Promise<void> => {
    if (!requireAdminPrivilege('promote company from review')) {
      return;
    }
    try {
      const res = await promoteEntityReviewToCompany(reviewId, companyData);
      const now = new Date().toISOString();
      setEntityReviews((prev) =>
        prev.map((r) =>
          r.id === reviewId
            ? {
                ...r,
                status: 'PROMOTED_NEW',
                canonicalId: res.company.id,
                canonicalName: res.company.name,
                resolutionType: 'PROMOTED_NEW',
                resolutionMethod: 'MANUAL_PROMOTION',
                resolvedAt: now,
                reviewedAt: now,
              }
            : r
        )
      );
      const updatedCompanies = await companyRepo.getAll();
      setCompanies(updatedCompanies);
      const updatedMetrics = await metricsRepo.getDashboardMetrics();
      setMetrics(updatedMetrics);
      notify('success', 'Company Promoted', `"${res.company.name}" is now a canonical Company.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not promote company.';
      notify('error', 'Promotion Failed', msg);
      throw err;
    }
  };

  const promoteProductFromReview = async (
    reviewId: string,
    productData: {
      name: string;
      companyId: string;
      category: string;
      subcategory?: string;
      lifecycle?: ProductLifecycleStatus;
      entityLevel?: ProductEntityLevel;
      aliases?: string[];
    }
  ): Promise<void> => {
    if (!requireAdminPrivilege('promote product from review')) {
      return;
    }
    try {
      const res = await promoteEntityReviewToProduct(reviewId, productData);
      const now = new Date().toISOString();
      setEntityReviews((prev) =>
        prev.map((r) =>
          r.id === reviewId
            ? {
                ...r,
                status: 'PROMOTED_NEW',
                canonicalId: res.product.id,
                canonicalName: res.product.name,
                resolutionType: 'PROMOTED_NEW',
                resolutionMethod: 'MANUAL_PROMOTION',
                resolvedAt: now,
                reviewedAt: now,
              }
            : r
        )
      );
      const updatedProducts = await productRepo.getAll();
      setProducts(updatedProducts);
      const updatedMetrics = await metricsRepo.getDashboardMetrics();
      setMetrics(updatedMetrics);
      notify('success', 'Product Promoted', `"${res.product.name}" is now a canonical Product.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not promote product.';
      notify('error', 'Promotion Failed', msg);
      throw err;
    }
  };

  const dismissReviewAsNonStrategic = async (reviewId: string, reason?: string): Promise<void> => {
    if (!requireAdminPrivilege('dismiss entity review')) {
      return;
    }
    try {
      await dismissEntityReviewAsNonStrategic(reviewId, reason);
      const now = new Date().toISOString();
      setEntityReviews((prev) =>
        prev.map((r) =>
          r.id === reviewId
            ? {
                ...r,
                status: 'DISMISSED_NON_STRATEGIC',
                resolutionType: 'NON_STRATEGIC',
                resolutionMethod: 'DISMISS',
                nonStrategicReason: reason,
                resolvedAt: now,
                reviewedAt: now,
              }
            : r
        )
      );
      const updatedMetrics = await metricsRepo.getDashboardMetrics();
      setMetrics(updatedMetrics);
      notify('info', 'Dismissed as Non-Strategic', 'Entity classified as non-hardware concept.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not dismiss entity.';
      notify('error', 'Dismiss Failed', msg);
      throw err;
    }
  };

  const rejectReview = async (reviewId: string, reason?: string): Promise<void> => {
    if (!requireAdminPrivilege('reject entity review')) {
      return;
    }
    try {
      await rejectEntityReviewService(reviewId, reason);
      const now = new Date().toISOString();
      setEntityReviews((prev) =>
        prev.map((r) =>
          r.id === reviewId
            ? {
                ...r,
                status: 'REJECTED',
                resolutionType: 'REJECTED',
                nonStrategicReason: reason,
                resolvedAt: now,
                reviewedAt: now,
              }
            : r
        )
      );
      const updatedMetrics = await metricsRepo.getDashboardMetrics();
      setMetrics(updatedMetrics);
      notify('info', 'Review Rejected', 'Entity review rejected.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not reject entity.';
      notify('error', 'Reject Failed', msg);
      throw err;
    }
  };

  // Phase 4C.2: Authoritative On-Demand Story Membership & Connected Articles Hydration
  const storyMembershipsCache = useRef<Map<string, StoryMembership[]>>(new Map());
  const articleDetailCache = useRef<Map<string, Article>>(new Map());

  const getStoryMemberships = useCallback(async (storyId: string): Promise<StoryMembership[]> => {
    if (storyMembershipsCache.current.has(storyId)) {
      return storyMembershipsCache.current.get(storyId)!;
    }
    try {
      const memberships = await storyRepo.getMemberships(storyId);
      storyMembershipsCache.current.set(storyId, memberships);
      return memberships;
    } catch (err) {
      console.warn(`Could not load memberships for story ${storyId}:`, err);
      return [];
    }
  }, []);

  const getStoryConnectedArticles = useCallback(
    async (storyId: string): Promise<{ membership: StoryMembership; article?: Article }[]> => {
      const memberships = await getStoryMemberships(storyId);
      if (memberships.length === 0) return [];

      const results: { membership: StoryMembership; article?: Article }[] = [];
      const missingIds: string[] = [];

      for (const m of memberships) {
        const cached =
          articleDetailCache.current.get(m.articleId) ||
          articles.find((a) => a.id === m.articleId);
        if (cached) {
          results.push({ membership: m, article: cached });
        } else {
          missingIds.push(m.articleId);
        }
      }

      if (missingIds.length > 0) {
        await Promise.all(
          missingIds.map(async (artId) => {
            const member = memberships.find((m) => m.articleId === artId);
            try {
              const art = await articleRepo.getById(artId);
              if (art) {
                articleDetailCache.current.set(artId, art);
                if (member) {
                  results.push({ membership: member, article: art });
                }
              } else if (member) {
                results.push({ membership: member, article: undefined });
              }
            } catch (e) {
              console.warn(`Could not fetch article ${artId}:`, e);
              if (member) {
                results.push({ membership: member, article: undefined });
              }
            }
          })
        );
      }

      return results.sort(
        (a, b) =>
          new Date(b.membership.publishedAt).getTime() -
          new Date(a.membership.publishedAt).getTime()
      );
    },
    [getStoryMemberships, articles]
  );

  const loadAllStories = useCallback(async () => {
    try {
      const all = await storyRepo.getAll();
      includeStoryArchive.current = true;
      setStories(all);
      notify('info', 'Stories Archive Loaded', `Loaded all ${all.length} stories from archive.`);
    } catch (e) {
      console.warn('Failed to load all stories:', e);
    }
  }, [notify]);

  // Phase 5S-C2: Scalable News Feed Pagination
  const loadMoreArticles = useCallback(async () => {
    if (isLoadingMoreArticles || !hasMoreArticles) {
      return;
    }

    const pageVersion = articlePageVersion.current;
    try {
      setIsLoadingMoreArticles(true);
      const res = await articleRepo.getPaginatedArticles(25, articleLastCursorRef.current);
      if (pageVersion !== articlePageVersion.current) return;

      if (res.articles.length > 0) {
        loadedArticleCount.current += res.articles.length;
        articleLastCursorRef.current = res.lastDocCursor;
        setArticles((prev) => {
          const existingIds = new Set(prev.map((a) => a.id));
          const uniqueNew = res.articles.filter((a) => !existingIds.has(a.id));
          return [...prev, ...uniqueNew];
        });
      }

      setHasMoreArticles(res.hasMore);
    } catch (err) {
      if (pageVersion !== articlePageVersion.current) return;
      console.error('[AppContext] Failed to load more articles:', err);
      notify('error', 'Pagination Error', 'Failed to retrieve older articles from Firestore.');
    } finally {
      setIsLoadingMoreArticles(false);
    }
  }, [isLoadingMoreArticles, hasMoreArticles, notify]);

  const resetArticlePagination = useCallback(async () => {
    const pageVersion = ++articlePageVersion.current;
    const activeRefresh = refreshRequest.current;
    try {
      setIsLoading(true);
      const [pagedRes, serverTotal] = await Promise.all([
        articleRepo.getPaginatedArticles(25),
        articleRepo.countTotal().catch(() => 0),
      ]);

      if (pageVersion !== articlePageVersion.current) return;
      ++articlePageVersion.current;
      loadedArticleCount.current = Math.max(25, pagedRes.articles.length);
      articleLastCursorRef.current = pagedRes.lastDocCursor;
      setArticles(pagedRes.articles);
      setHasMoreArticles(pagedRes.hasMore);
      setTotalArticlesCount(serverTotal || pagedRes.articles.length);
    } catch (err) {
      console.error('[AppContext] Failed to reset article pagination:', err);
    } finally {
      if (activeRefresh === refreshRequest.current) setIsLoading(false);
    }
  }, []);

  // Run Collector Action
  const runCollector = async (sourceId?: string, feedId?: string): Promise<CollectorRunStats | void> => {
    if (!requireAdminPrivilege('trigger news ingestion')) {
      return;
    }

    if (collectorStatus?.isRunning || isTriggering) {
      notify('info', 'Collection In Progress', 'A collection cycle is already active. Monitoring progress...');
      return;
    }

    setIsTriggering(true);
    const targetSource = sourceId ? sources.find((s) => s.id === sourceId) : undefined;
    const targetFeed = targetSource?.feeds?.find((f) => f.id === feedId);
    notify(
      'info',
      'Ingestion Triggered',
      targetFeed
        ? `Fetching feed "${targetFeed.title}" for ${targetSource?.name}...`
        : targetSource
        ? `Fetching feeds for ${targetSource.name}...`
        : 'Executing global collection cycle across all active sources...'
    );

    try {
      const stats = await collectorClient.triggerRun(sourceId, feedId);

      // Immediately synchronize authoritative server status
      await refreshCollectorStatus();

      return stats;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Collector cycle failed to initiate.';
      notify('error', 'Collector Execution Error', msg);
      throw err;
    } finally {
      setIsTriggering(false);
    }
  };

  // Source Actions
  const createSource = async (
    sourceInput: Omit<Source, 'id' | 'createdAt' | 'updatedAt' | 'articlesCollected' | 'errorCount'> & { customId?: string }
  ): Promise<Source> => {
    if (!requireAdminPrivilege('register a new source')) {
      throw new Error('Administrator privileges required');
    }
    try {
      const created = await sourceRepo.create(sourceInput);
      setSources((prev) => [created, ...prev.filter((s) => s.id !== created.id)]);
      setDeletedSources((prev) => prev.filter((d) => d.id !== created.id));
      const newMetrics = await metricsRepo.getDashboardMetrics();
      setMetrics(newMetrics);
      notify('success', 'Source Registered', `"${created.name}" saved to Cloud Firestore.`);
      return created;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not add source';
      notify('error', 'Add Source Failed', msg);
      throw err;
    }
  };

  const updateSource = async (id: string, updates: Partial<Source>): Promise<Source> => {
    if (!requireAdminPrivilege('update source configuration')) {
      throw new Error('Administrator privileges required');
    }
    try {
      const updated = await sourceRepo.update(id, updates);
      setSources((prev) => prev.map((s) => (s.id === id ? updated : s)));
      notify('success', 'Source Updated', `Saved changes for "${updated.name}".`);
      return updated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not update source';
      notify('error', 'Update Failed', msg);
      throw err;
    }
  };

  const deleteSource = async (id: string, reason?: string): Promise<boolean> => {
    if (!requireAdminPrivilege('delete source')) {
      return false;
    }
    try {
      const target = sources.find((s) => s.id === id);
      const ok = await sourceRepo.delete(id, reason);
      if (ok) {
        setSources((prev) => prev.filter((s) => s.id !== id));
        // Refresh deletedSources list
        const updatedDeleted = await sourceRepo.getDeletedSources().catch(() => []);
        setDeletedSources(updatedDeleted);
        const newMetrics = await metricsRepo.getDashboardMetrics();
        setMetrics(newMetrics);
        notify(
          'info',
          'Source Deleted',
          target
            ? `"${target.name}" removed from configuration. Historical articles and intelligence preserved.`
            : 'Source removed successfully.'
        );
      }
      return ok;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not delete source';
      notify('error', 'Delete Failed', msg);
      throw err;
    }
  };

  const restoreSource = async (
    deletedSourceId: string,
    sourceInput: Omit<Source, 'id' | 'createdAt' | 'updatedAt' | 'articlesCollected' | 'errorCount'>
  ): Promise<Source> => {
    if (!requireAdminPrivilege('restore deleted source')) {
      throw new Error('Administrator privileges required');
    }
    try {
      const restored = await sourceRepo.restoreSource(deletedSourceId, sourceInput);
      setSources((prev) => [restored, ...prev.filter((s) => s.id !== deletedSourceId)]);
      setDeletedSources((prev) => prev.filter((d) => d.id !== deletedSourceId));
      const newMetrics = await metricsRepo.getDashboardMetrics();
      setMetrics(newMetrics);
      notify(
        'success',
        'Source Restored',
        `"${restored.name}" restored with historical identity and articles unified.`
      );
      return restored;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not restore source';
      notify('error', 'Restoration Failed', msg);
      throw err;
    }
  };

  const getDeletedSourceByDomain = useCallback(
    async (domain: string): Promise<DeletedSource | null> => {
      return sourceRepo.getDeletedSourceByDomain(domain);
    },
    []
  );

  const toggleSourceStatus = async (id: string): Promise<Source> => {
    if (!requireAdminPrivilege('toggle source status')) {
      throw new Error('Administrator privileges required');
    }
    try {
      const updated = await sourceRepo.toggleStatus(id);
      setSources((prev) => prev.map((s) => (s.id === id ? updated : s)));
      const newMetrics = await metricsRepo.getDashboardMetrics();
      setMetrics(newMetrics);
      notify(
        'info',
        'Status Changed',
        `"${updated.name}" is now marked as ${updated.status}.`
      );
      return updated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not toggle source status';
      notify('error', 'Status Update Failed', msg);
      throw err;
    }
  };

  const addSourceFeed = async (
    sourceId: string,
    feedInput: Omit<SourceFeed, 'id' | 'createdAt' | 'updatedAt' | 'failureCount' | 'articlesCollected'>
  ): Promise<Source> => {
    if (!requireAdminPrivilege('add source feed')) {
      throw new Error('Administrator privileges required');
    }
    try {
      const updated = await sourceRepo.addFeed(sourceId, feedInput);
      setSources((prev) => prev.map((s) => (s.id === sourceId ? updated : s)));
      notify('success', 'Feed Added', `Added "${feedInput.title}" to ${updated.name}.`);
      return updated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not add feed';
      notify('error', 'Add Feed Failed', msg);
      throw err;
    }
  };

  const updateSourceFeed = async (
    sourceId: string,
    feedId: string,
    updates: Partial<SourceFeed>
  ): Promise<Source> => {
    if (!requireAdminPrivilege('update source feed')) {
      throw new Error('Administrator privileges required');
    }
    try {
      const updated = await sourceRepo.updateFeed(sourceId, feedId, updates);
      setSources((prev) => prev.map((s) => (s.id === sourceId ? updated : s)));
      notify('success', 'Feed Updated', 'Saved feed configuration.');
      return updated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not update feed';
      notify('error', 'Update Feed Failed', msg);
      throw err;
    }
  };

  const removeSourceFeed = async (sourceId: string, feedId: string): Promise<Source> => {
    if (!requireAdminPrivilege('remove source feed')) {
      throw new Error('Administrator privileges required');
    }
    try {
      const updated = await sourceRepo.removeFeed(sourceId, feedId);
      setSources((prev) => prev.map((s) => (s.id === sourceId ? updated : s)));
      notify('info', 'Feed Removed', 'Feed removed. Previously collected articles are safely preserved.');
      return updated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not remove feed';
      notify('error', 'Remove Feed Failed', msg);
      throw err;
    }
  };

  const setPrimarySourceFeed = async (sourceId: string, feedId: string): Promise<Source> => {
    if (!requireAdminPrivilege('set primary feed')) {
      throw new Error('Administrator privileges required');
    }
    try {
      const updated = await sourceRepo.setPrimaryFeed(sourceId, feedId);
      setSources((prev) => prev.map((s) => (s.id === sourceId ? updated : s)));
      notify('success', 'Primary Feed Set', 'Updated primary syndication endpoint.');
      return updated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not set primary feed';
      notify('error', 'Set Primary Failed', msg);
      throw err;
    }
  };

  const toggleSourceFeedStatus = async (sourceId: string, feedId: string): Promise<Source> => {
    if (!requireAdminPrivilege('toggle feed status')) {
      throw new Error('Administrator privileges required');
    }
    try {
      const updated = await sourceRepo.toggleFeedStatus(sourceId, feedId);
      setSources((prev) => prev.map((s) => (s.id === sourceId ? updated : s)));
      const feed = updated.feeds?.find((f) => f.id === feedId);
      notify('info', 'Feed Status Changed', `Feed is now ${feed?.status || 'updated'}.`);
      return updated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not toggle feed status';
      notify('error', 'Status Update Failed', msg);
      throw err;
    }
  };

  const retrySourceFeed = async (sourceId: string, feedId: string): Promise<Source> => {
    if (!requireAdminPrivilege('retry feed collection')) {
      throw new Error('Administrator privileges required');
    }
    try {
      const updated = await sourceRepo.retryFeed(sourceId, feedId);
      setSources((prev) => prev.map((s) => (s.id === sourceId ? updated : s)));
      notify('info', 'Feed Reset', 'Feed reset to ACTIVE and queued for collection.');
      return updated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not reset feed';
      notify('error', 'Retry Failed', msg);
      throw err;
    }
  };

  // Group Actions
  const createSourceGroup = async (
    groupInput: Omit<SourceGroup, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<SourceGroup> => {
    if (!requireAdminPrivilege('create source group')) {
      throw new Error('Administrator privileges required');
    }
    try {
      const created = await sourceGroupRepo.create(groupInput);
      setSourceGroups((prev) => [...prev, created]);
      notify('success', 'Group Created', `Source group "${created.name}" created.`);
      return created;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not create group';
      notify('error', 'Group Creation Failed', msg);
      throw err;
    }
  };

  const updateSourceGroup = async (
    id: string,
    updates: Partial<SourceGroup>
  ): Promise<SourceGroup> => {
    if (!requireAdminPrivilege('update source group')) {
      throw new Error('Administrator privileges required');
    }
    try {
      const updated = await sourceGroupRepo.update(id, updates);
      setSourceGroups((prev) => prev.map((g) => (g.id === id ? updated : g)));
      notify('success', 'Group Updated', `Group "${updated.name}" updated.`);
      return updated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not update group';
      notify('error', 'Group Update Failed', msg);
      throw err;
    }
  };

  const deleteSourceGroup = async (id: string): Promise<boolean> => {
    if (!requireAdminPrivilege('delete source group')) {
      return false;
    }
    try {
      const target = sourceGroups.find((g) => g.id === id);
      const ok = await sourceGroupRepo.delete(id);
      if (ok) {
        setSourceGroups((prev) => prev.filter((g) => g.id !== id));
        notify('info', 'Group Removed', target ? `"${target.name}" removed.` : undefined);
      }
      return ok;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not delete group';
      notify('error', 'Group Deletion Failed', msg);
      throw err;
    }
  };

  // Settings & Company Actions
  const setPrimaryCompany = async (companyId: string): Promise<void> => {
    if (!requireAdminPrivilege('change primary company perspective')) {
      return;
    }
    try {
      await companyRepo.setMyCompany(companyId);
      const updatedCompanies = await companyRepo.getAll();
      setCompanies(updatedCompanies);

      const targetComp = updatedCompanies.find((c) => c.id === companyId);
      const currentSettings = settings || (await settingsRepo.getSettings());

      // Clean new primary company from competitorSets so it cannot be its own competitor
      const cleanedCompetitorSets: Record<string, string[]> = {};
      if (currentSettings.competitorSets) {
        for (const [cat, compList] of Object.entries(currentSettings.competitorSets)) {
          cleanedCompetitorSets[cat] = compList.filter((id) => id !== companyId);
        }
      }

      const updatedSettings = await settingsRepo.updateSettings({
        myCompanyId: companyId,
        myCompanyName: targetComp?.name || companyId,
        competitorSets: cleanedCompetitorSets,
      });
      setSettings(updatedSettings);

      notify(
        'success',
        'Primary Company Updated',
        `Primary focus changed to "${targetComp?.name || companyId}".`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not set primary company';
      notify('error', 'Update Failed', msg);
      throw err;
    }
  };

  const updateSettings = async (
    updates: Partial<IntelligenceSettings>
  ): Promise<IntelligenceSettings> => {
    if (!requireAdminPrivilege('update system intelligence settings')) {
      throw new Error('Administrator privileges required');
    }
    try {
      const updated = await settingsRepo.updateSettings(updates);
      setSettings(updated);
      notify('success', 'Settings Saved', 'System configurations updated in Firestore.');
      return updated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not update settings';
      notify('error', 'Settings Error', msg);
      throw err;
    }
  };

  const resetMockData = async (): Promise<void> => {
    if (!requireAdminPrivilege('reset baseline demo data')) {
      return;
    }
    try {
      setIsLoading(true);
      await seedFirestoreIfEmpty();
      await refreshData();
      notify('info', 'Database Synced', 'Synchronized baseline sources and settings with Cloud Firestore.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Database sync failed';
      notify('error', 'Sync Failed', msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AppContext.Provider
      value={{
        activeTab,
        setActiveTab,
        selectedStoryId,
        setSelectedStoryId,
        navigateToStory,
        currentUser,
        isAuthLoading,
        isAdmin,
        isCheckingAdmin,
        canManage,
        requireAdminPrivilege,
        signInWithGoogle,
        signInAsGuest,
        logout,
        sources,
        deletedSources,
        sourceGroups,
        articles,
        totalArticlesCount,
        hasMoreArticles,
        isLoadingMoreArticles,
        loadMoreArticles,
        resetArticlePagination,
        stories,
        companies,
        products,
        settings,
        metrics,
        isLoading,
        error,
        analyses,
        entityReviews,
        isAnalyzing,
        analyzingArticleId,
        analyzeArticle,
        analyzeBatch,
        analyzePendingArticles,
        updateEntityReviewStatus,
        linkEntityReview,
        promoteCompanyFromReview,
        promoteProductFromReview,
        dismissReviewAsNonStrategic,
        rejectReview,
        getStoryMemberships,
        getStoryConnectedArticles,
        loadAllStories,
        isCollecting,
        collectorStatus,
        runCollector,
        feedDiscoveryService,
        aiService: aiIntelligenceService,
        refreshData,
        createSource,
        updateSource,
        deleteSource,
        restoreSource,
        getDeletedSourceByDomain,
        toggleSourceStatus,
        addSourceFeed,
        updateSourceFeed,
        removeSourceFeed,
        setPrimarySourceFeed,
        toggleSourceFeedStatus,
        retrySourceFeed,
        createSourceGroup,
        updateSourceGroup,
        deleteSourceGroup,
        setPrimaryCompany,
        updateSettings,
        resetMockData,
        notifications,
        dismissNotification,
        notify,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
