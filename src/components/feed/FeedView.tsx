import React, { useState, useMemo } from 'react';
import {
  Search,
  Filter,
  ExternalLink,
  Calendar,
  Globe,
  Tag,
  Hash,
  Rss,
  Info,
  Clock,
  Play,
  RefreshCw,
  Database,
  Sparkles,
  RotateCw,
  Building2,
  Smartphone,
  ShieldAlert,
  Flame,
  Scale,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ArrowDownCircle,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Article, ArticleAnalysis } from '../../types';
import { ArticleIntelligenceModal } from './ArticleIntelligenceModal';
import {
  AppPage,
  PageHeader,
  SemanticBadge,
  Button,
} from '../common/DesignSystem';

export const FeedView: React.FC = () => {
  const {
    articles,
    totalArticlesCount,
    hasMoreArticles,
    isLoadingMoreArticles,
    loadMoreArticles,
    sources,
    sourceGroups,
    analyses,
    runCollector,
    isCollecting,
    analyzeArticle,
    analyzePendingArticles,
    isAnalyzing,
    analyzingArticleId,
    settings,
    canManage,
    isLoading,
    error,
    setActiveTab,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSourceId, setSelectedSourceId] = useState<string>('ALL');
  const [selectedMarket, setSelectedMarket] = useState<string>('ALL');
  const [selectedLanguage, setSelectedLanguage] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedImportance, setSelectedImportance] = useState<string>('ALL');
  const [selectedSentiment, setSelectedSentiment] = useState<string>('ALL');
  const [selectedNewsType, setSelectedNewsType] = useState<string>('ALL');

  // Modal State
  const [inspectingArticle, setInspectingArticle] = useState<Article | null>(null);

  // Compute filter sources including historical/deleted sources (Requirement 16)
  const filterSources = useMemo(() => {
    const list: Array<{ id: string; name: string; isDeleted?: boolean }> = sources.map((s) => ({
      id: s.id,
      name: s.name,
      isDeleted: false,
    }));

    // Find any sourceIds referenced by existing articles that are not in active sources
    const activeSourceIds = new Set(sources.map((s) => s.id));
    const historicalSourcesMap = new Map<string, string>();

    for (const a of articles) {
      if (a.sourceId && !activeSourceIds.has(a.sourceId) && !historicalSourcesMap.has(a.sourceId)) {
        historicalSourcesMap.set(a.sourceId, a.sourceName || a.sourceId);
      }
    }

    historicalSourcesMap.forEach((sourceName, sourceId) => {
      list.push({
        id: sourceId,
        name: `${sourceName} (Source removed)`,
        isDeleted: true,
      });
    });

    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [sources, articles]);

  const pendingArticlesCount = useMemo(() => {
    return articles.filter((a) => a.processingStatus === 'PENDING').length;
  }, [articles]);

  const filteredArticles = useMemo(() => {
    return articles.filter((a) => {
      const analysis = analyses[a.id];

      // Text Search
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchesTitle = a.title.toLowerCase().includes(q);
        const matchesExcerpt = a.excerpt.toLowerCase().includes(q);
        const matchesAuthor = a.author?.toLowerCase().includes(q);
        const matchesCategory = a.rawCategories.some((c) => c.toLowerCase().includes(q));
        const matchesSummary = analysis?.summary?.toLowerCase().includes(q);
        const matchesCompany = analysis?.companies?.some((c) =>
          c.canonicalName.toLowerCase().includes(q)
        );
        const matchesProduct = analysis?.products?.some((p) =>
          p.canonicalName.toLowerCase().includes(q)
        );
        const matchesTopic = analysis?.topics?.some((t) => t.toLowerCase().includes(q));

        if (
          !matchesTitle &&
          !matchesExcerpt &&
          !matchesAuthor &&
          !matchesCategory &&
          !matchesSummary &&
          !matchesCompany &&
          !matchesProduct &&
          !matchesTopic
        ) {
          return false;
        }
      }

      // Source Filter
      if (selectedSourceId !== 'ALL' && a.sourceId !== selectedSourceId) return false;

      // Market & Language Filters
      if (selectedMarket !== 'ALL' && a.market !== selectedMarket) return false;
      if (selectedLanguage !== 'ALL' && a.language !== selectedLanguage) return false;

      // Analysis Status Filter
      if (selectedStatus !== 'ALL') {
        if (selectedStatus === 'ANALYZED' && a.processingStatus !== 'ANALYZED') return false;
        if (selectedStatus === 'PENDING' && a.processingStatus !== 'PENDING') return false;
        if (selectedStatus === 'FAILED' && a.processingStatus !== 'FAILED') return false;
        if (selectedStatus === 'PROCESSING' && a.processingStatus !== 'PROCESSING') return false;
        if (selectedStatus === 'SKIPPED_STRATEGIC_SCOPE' && a.processingStatus !== 'SKIPPED_STRATEGIC_SCOPE') return false;
      }

      // Importance Filter
      if (selectedImportance !== 'ALL') {
        const score = analysis?.importanceScore ?? 0;
        if (selectedImportance === 'CRITICAL' && score < 80) return false;
        if (selectedImportance === 'HIGH' && (score < 60 || score >= 80)) return false;
        if (selectedImportance === 'MODERATE' && (score < 40 || score >= 60)) return false;
        if (selectedImportance === 'LOW' && score >= 40) return false;
      }

      // Sentiment Filter
      if (selectedSentiment !== 'ALL' && analysis?.sentiment !== selectedSentiment) {
        return false;
      }

      // NewsType Filter
      if (selectedNewsType !== 'ALL' && analysis?.newsType !== selectedNewsType) {
        return false;
      }

      return true;
    });
  }, [
    articles,
    analyses,
    searchQuery,
    selectedSourceId,
    selectedMarket,
    selectedLanguage,
    selectedStatus,
    selectedImportance,
    selectedSentiment,
    selectedNewsType,
  ]);

  const handleAnalyzeClick = async (e: React.MouseEvent, articleId: string) => {
    e.stopPropagation();
    await analyzeArticle(articleId);
  };

  const handleReanalyzeClick = async (e: React.MouseEvent, articleId: string) => {
    e.stopPropagation();
    await analyzeArticle(articleId, true);
  };

  const getImportanceBadge = (score?: number) => {
    if (score === undefined) return null;
    if (score >= 80) {
      return {
        label: 'Critical',
        className: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
      };
    }
    if (score >= 60) {
      return {
        label: 'High',
        className: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      };
    }
    if (score >= 40) {
      return {
        label: 'Moderate',
        className: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
      };
    }
    return {
      label: 'Low',
      className: 'bg-slate-800 text-slate-400 border-slate-700',
    };
  };

  const getSentimentBadge = (sentiment?: string) => {
    switch (sentiment) {
      case 'POSITIVE':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
      case 'NEGATIVE':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/30';
      case 'MIXED':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
      default:
        return 'bg-slate-800 text-slate-400 border-slate-700';
    }
  };

  return (
    <AppPage>
      {/* Standardized Page Header */}
      <PageHeader
        title="Article River & Intelligence Stream"
        badges={
          <>
            <SemanticBadge variant="info" label={`${filteredArticles.length} matching shown`} />
            <SemanticBadge variant="neutral" label={`${articles.length} loaded`} />
            {totalArticlesCount > 0 && (
              <SemanticBadge
                variant="verified"
                label={`${totalArticlesCount.toLocaleString()} in archive`}
              />
            )}
          </>
        }
        description="Normalized article river collected from live RSS/Atom feeds, structured and scored via server-side Gemini intelligence."
        actions={
          <>
            {/* Historical Backfill Action — Admin Only */}
            {canManage && (
              <Button
                variant="primary"
                size="md"
                onClick={() => setActiveTab('backfill')}
                title="Open Historical Backfill engine for triaged, bounded batch processing of historical articles"
                leftIcon={<Database className="w-3.5 h-3.5 text-indigo-200" />}
              >
                Historical Backfill
              </Button>
            )}

            {/* Analyze Recent Batch Action — Admin Only */}
            {canManage && pendingArticlesCount > 0 && (
              <Button
                variant="secondary"
                size="md"
                onClick={() => analyzePendingArticles(5)}
                disabled={isAnalyzing}
                title="Analyze Pending Articles (process next batch of 5 recent pending feed articles with Gemini)"
                leftIcon={
                  <Sparkles
                    className={`w-3.5 h-3.5 text-amber-400 ${isAnalyzing ? 'animate-spin' : ''}`}
                  />
                }
              >
                {isAnalyzing ? 'Analyzing 5...' : 'Analyze Recent (5)'}
              </Button>
            )}

            {/* Ingest Action — Admin Only */}
            {canManage && (
              <Button
                variant="secondary"
                size="md"
                onClick={() => runCollector()}
                disabled={isCollecting}
                className="bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500/40"
                leftIcon={
                  isCollecting ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-current" />
                  )
                }
              >
                {isCollecting ? 'Ingesting Feeds...' : 'Collect Live Feeds'}
              </Button>
            )}

            <SemanticBadge
              variant="neutral"
              icon={<Database className="w-3.5 h-3.5 text-indigo-400" />}
              label="SHA-256 Deduplication"
              className="px-3 py-1.5 text-[11px]"
            />
          </>
        }
      />

      {/* Filter Bar */}
      <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Search className="w-4 h-4" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter loaded articles by headline, summary, entity, or tag..."
              className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700/80 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="w-full md:w-44">
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700/80 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
            >
              <option value="ALL">All Analysis States</option>
              <option value="ANALYZED">Analyzed with Gemini</option>
              <option value="PENDING">Pending Analysis</option>
              <option value="SKIPPED_STRATEGIC_SCOPE">Scope Filtered (Out of Scope)</option>
              <option value="FAILED">Analysis Failed</option>
            </select>
          </div>

          <div className="w-full md:w-48">
            <select
              value={selectedSourceId}
              onChange={(e) => setSelectedSourceId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700/80 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="ALL">All Sources ({filterSources.length})</option>
              {filterSources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Secondary Filter Row */}
        <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-800/60 text-xs">
          <div className="flex items-center gap-1.5 text-slate-400">
            <Filter className="w-3.5 h-3.5" />
            <span className="text-[11px] font-mono">Filters:</span>
          </div>

          {/* Importance */}
          <select
            value={selectedImportance}
            onChange={(e) => setSelectedImportance(e.target.value)}
            className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="ALL">All Importance</option>
            <option value="CRITICAL">Critical (80-100)</option>
            <option value="HIGH">High (60-79)</option>
            <option value="MODERATE">Moderate (40-59)</option>
            <option value="LOW">Low (0-39)</option>
          </select>

          {/* Sentiment */}
          <select
            value={selectedSentiment}
            onChange={(e) => setSelectedSentiment(e.target.value)}
            className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="ALL">All Sentiment</option>
            <option value="POSITIVE">Positive</option>
            <option value="NEUTRAL">Neutral</option>
            <option value="NEGATIVE">Negative</option>
            <option value="MIXED">Mixed</option>
          </select>

          {/* NewsType */}
          <select
            value={selectedNewsType}
            onChange={(e) => setSelectedNewsType(e.target.value)}
            className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="ALL">All News Types</option>
            <option value="PRODUCT_LAUNCH">Product Launch</option>
            <option value="PRODUCT_LEAK">Product Leak</option>
            <option value="RUMOR">Rumor</option>
            <option value="REVIEW">Review</option>
            <option value="SOFTWARE_UPDATE">Software Update</option>
            <option value="NEWS">News</option>
            <option value="PRICE_CHANGE">Price Change</option>
            <option value="BUSINESS">Business</option>
          </select>

          {/* Market */}
          <select
            value={selectedMarket}
            onChange={(e) => setSelectedMarket(e.target.value)}
            className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="ALL">All Markets</option>
            <option value="Global">Global</option>
            <option value="Greece">Greece</option>
            <option value="Europe">Europe</option>
          </select>

          {/* Language */}
          <select
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value)}
            className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="ALL">All Langs</option>
            <option value="en">English (en)</option>
            <option value="el">Greek (el)</option>
          </select>

          {(selectedImportance !== 'ALL' ||
            selectedSentiment !== 'ALL' ||
            selectedNewsType !== 'ALL' ||
            selectedStatus !== 'ALL' ||
            selectedSourceId !== 'ALL' ||
            selectedMarket !== 'ALL' ||
            selectedLanguage !== 'ALL' ||
            searchQuery.trim().length > 0) && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedStatus('ALL');
                setSelectedImportance('ALL');
                setSelectedSentiment('ALL');
                setSelectedNewsType('ALL');
                setSelectedSourceId('ALL');
                setSelectedMarket('ALL');
                setSelectedLanguage('ALL');
              }}
              className="text-[11px] text-indigo-400 hover:text-indigo-300 underline font-mono ml-auto"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Article River Stream */}
      <div className="space-y-3">
        {filteredArticles.length === 0 ? (
          <div className="p-12 text-center bg-slate-900 border border-slate-800 rounded-xl space-y-3">
            <Rss className="w-8 h-8 text-slate-600 mx-auto" />
            <p role="status" className="text-sm font-medium text-slate-300">
              {isLoading ? 'Loading articles…' : error ? 'Unable to load articles' : 'No loaded articles match your filters'}
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {!isLoading && !error && (hasMoreArticles
                ? 'Adjust your filters or load more archived articles below.'
                : 'Adjust your search or reset the filters.')}
            </p>
            {canManage && !isLoading && !error && articles.length === 0 && <button
              onClick={() => runCollector()}
              disabled={isCollecting}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-xs transition"
            >
              {isCollecting ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
              <span>Ingest Articles Now</span>
            </button>}
          </div>
        ) : (
          filteredArticles.map((article) => {
            const sourceObj = sources.find((s) => s.id === article.sourceId);
            const analysis = analyses[article.id];
            const isArticleAnalyzing = isAnalyzing && analyzingArticleId === article.id;
            const impBadge = getImportanceBadge(analysis?.importanceScore);

            return (
              <article
                key={article.id}
                onClick={() => setInspectingArticle(article)}
                className="p-4 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl cursor-pointer transition flex flex-col md:flex-row gap-4 group"
              >
                {/* Optional Image */}
                {article.imageUrl && (
                  <div className="w-full md:w-44 h-28 rounded-lg bg-slate-950 border border-slate-800 overflow-hidden shrink-0">
                    <img
                      src={article.imageUrl}
                      alt={article.title}
                      className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition"
                      loading="lazy"
                    />
                  </div>
                )}

                {/* Article Body */}
                <div className="flex-1 space-y-2 min-w-0">
                  {/* Top Metadata Strip */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-indigo-300 font-semibold text-[11px] font-mono border border-slate-700 flex items-center gap-1.5">
                      <span>{article.sourceName || sourceObj?.name || 'Source'}</span>
                      {!sourceObj && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 font-sans font-normal">
                          Source removed
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                      {article.market} • {article.language.toUpperCase()}
                    </span>

                    {/* AI Analysis Badges if Analyzed */}
                    {analysis && (
                      <>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                          {analysis.newsType}
                        </span>

                        {impBadge && (
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${impBadge.className}`}
                            title={`Importance Score: ${analysis.importanceScore}/100`}
                          >
                            Score: {analysis.importanceScore} ({impBadge.label})
                          </span>
                        )}

                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${getSentimentBadge(
                            analysis.sentiment
                          )}`}
                        >
                          {analysis.sentiment}
                        </span>

                        {analysis.competitiveRelevance?.score !== undefined && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-950 text-indigo-400 border border-slate-800">
                            Rel: {analysis.competitiveRelevance.score}%
                          </span>
                        )}
                      </>
                    )}

                    <span className="text-[10px] font-mono text-slate-500 ml-auto flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(article.publishedAt).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  {/* Title */}
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-100 group-hover:text-indigo-300 transition">
                      {article.title}
                    </h3>

                    <a
                      href={article.canonicalUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="p-1 text-slate-500 hover:text-slate-300 transition shrink-0"
                      title="Open source URL"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>

                  {/* AI Summary or Ingested Excerpt */}
                  <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">
                    {analysis ? analysis.summary : article.excerpt}
                  </p>

                  {/* Detected Entities Chips */}
                  {analysis && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {(analysis.companies || []).map((c, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-950 text-[10px] font-mono text-slate-300 border border-slate-800"
                        >
                          <Building2 className="w-2.5 h-2.5 text-indigo-400" />
                          <span>{c.canonicalName}</span>
                        </span>
                      ))}

                      {(analysis.products || []).slice(0, 3).map((p, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-950 text-[10px] font-mono text-slate-300 border border-slate-800"
                        >
                          <Smartphone className="w-2.5 h-2.5 text-emerald-400" />
                          <span>{p.canonicalName}</span>
                        </span>
                      ))}

                      {(analysis.topics || []).slice(0, 3).map((t, i) => (
                        <span
                          key={i}
                          className="px-1.5 py-0.5 rounded bg-slate-950 text-[10px] font-mono text-slate-400 border border-slate-800"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Card Bottom Strip */}
                  <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/60 text-[11px]">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Analysis Status Indicator */}
                      {article.processingStatus === 'ANALYZED' && (
                        <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-400">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Gemini Analyzed</span>
                        </span>
                      )}

                      {article.processingStatus === 'PROCESSING' && (
                        <span className="flex items-center gap-1 text-[10px] font-mono text-blue-400 animate-pulse">
                          <RotateCw className="w-3 h-3 animate-spin" />
                          <span>Analyzing...</span>
                        </span>
                      )}

                      {article.processingStatus === 'FAILED' && (
                        <span
                          className="flex items-center gap-1 text-[10px] font-mono text-rose-400"
                          title="Analysis unavailable for this article"
                        >
                          <AlertTriangle className="w-3 h-3" />
                          <span>Analysis Failed</span>
                        </span>
                      )}

                      {article.processingStatus === 'PENDING' && (
                        <span className="text-[10px] font-mono text-amber-400">
                          Pending Analysis
                        </span>
                      )}

                      {article.processingStatus === 'SKIPPED_STRATEGIC_SCOPE' && (
                        <span
                          className="flex items-center gap-1 text-[10px] font-mono text-slate-400"
                          title={article.relevanceReason || 'Filtered out: not in strategic mobile hardware scope'}
                        >
                          <Filter className="w-3 h-3 text-slate-500" />
                          <span>Scope Filtered</span>
                        </span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      {analysis ? (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setInspectingArticle(article);
                            }}
                            className="px-2.5 py-1 rounded bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 font-semibold text-[11px] font-mono border border-indigo-500/30 transition flex items-center gap-1"
                          >
                            <Sparkles className="w-3 h-3" />
                            <span>View Intelligence</span>
                          </button>

                          {canManage && (
                            <button
                              onClick={(e) => handleReanalyzeClick(e, article.id)}
                              disabled={isArticleAnalyzing}
                              className="p-1 text-slate-500 hover:text-slate-300 transition"
                              title="Re-analyze article with Gemini"
                            >
                              <RotateCw
                                className={`w-3.5 h-3.5 ${isArticleAnalyzing ? 'animate-spin' : ''}`}
                              />
                            </button>
                          )}
                        </>
                      ) : canManage ? (
                        <button
                          onClick={(e) => handleAnalyzeClick(e, article.id)}
                          disabled={isArticleAnalyzing}
                          className="flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-[11px] shadow-xs transition"
                        >
                          <Sparkles
                            className={`w-3 h-3 ${isArticleAnalyzing ? 'animate-spin' : ''}`}
                          />
                          <span>
                            {isArticleAnalyzing ? 'Analyzing...' : 'Analyze with Gemini'}
                          </span>
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-500 font-mono italic">
                          Unanalyzed
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>

      {/* Pagination Controls */}
      {articles.length > 0 && (
        <div className="pt-2 pb-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-mono border-t border-slate-800/80">
          <div className="text-slate-400">
            <span>Showing </span>
            <strong className="text-slate-200">{filteredArticles.length}</strong>
            <span> matching of </span>
            <strong className="text-slate-200">{articles.length}</strong>
            <span> loaded articles</span>
            {totalArticlesCount > 0 && (
              <>
                <span> (Archive total: </span>
                <strong className="text-indigo-300">{totalArticlesCount.toLocaleString()}</strong>
                <span>)</span>
              </>
            )}
          </div>

          <div>
            {hasMoreArticles ? (
              <button
                onClick={() => loadMoreArticles()}
                disabled={isLoadingMoreArticles}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs shadow-xs transition"
              >
                {isLoadingMoreArticles ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Loading next 25 articles...</span>
                  </>
                ) : (
                  <>
                    <ArrowDownCircle className="w-3.5 h-3.5" />
                    <span>Load 25 More Articles</span>
                  </>
                )}
              </button>
            ) : (
              <span className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-500 italic">
                All available articles loaded
              </span>
            )}
          </div>
        </div>
      )}

      {/* Article Intelligence Modal */}
      {inspectingArticle && (
        <ArticleIntelligenceModal
          article={inspectingArticle}
          analysis={analyses[inspectingArticle.id]}
          onClose={() => setInspectingArticle(null)}
        />
      )}
    </AppPage>
  );
};
