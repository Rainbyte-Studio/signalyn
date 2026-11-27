import React, { useMemo, useState, useEffect } from 'react';
import {
  Layers,
  Flame,
  Clock,
  ExternalLink,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Loader2,
  FileText,
  Filter,
  ArrowUpDown,
  ShieldAlert,
  ShieldCheck,
  Shield,
  AlertTriangle,
  Play,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Archive,
  TrendingUp,
  GitMerge,
  Info,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  Story,
  StoryMembership,
  Article,
  StoryStatus,
  isProductionStory,
  EvidenceClassification,
  CompetitiveThreatLevel,
} from '../../types';
import { getStoryCanonicalCategories, CanonicalDeviceCategory } from '../../utils/categoryModel';
import { aiIntelligenceService } from '../../services/aiIntelligenceService';
import {
  AppPage,
  PageHeader,
  SemanticBadge,
  Button,
  EmptyStateCard,
} from '../common/DesignSystem';

interface StoryCardProps {
  story: Story;
  isSelected?: boolean;
  onClearSelection?: () => void;
}

const STRATEGIC_CATEGORIES = new Set<CanonicalDeviceCategory>([
  'SMARTPHONE',
  'WEARABLE',
  'AUDIO',
  'TABLET',
]);

const renderLifecycleBadge = (status: StoryStatus) => {
  switch (status) {
    case 'NEW':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-sky-500/10 text-sky-400 border border-sky-500/30">
          NEW
        </span>
      );
    case 'DEVELOPING':
    case 'ACTIVE':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-amber-500/10 text-amber-400 border border-amber-500/30">
          DEVELOPING
        </span>
      );
    case 'STABLE':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
          STABLE
        </span>
      );
    case 'RESOLVED':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-purple-500/10 text-purple-400 border border-purple-500/30">
          RESOLVED
        </span>
      );
    case 'ARCHIVED':
    case 'STALE':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-slate-500/10 text-slate-400 border border-slate-500/30">
          ARCHIVED
        </span>
      );
    default:
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-slate-800 text-slate-400 border border-slate-700">
          {status}
        </span>
      );
  }
};

const renderEvidenceBadge = (classification?: EvidenceClassification) => {
  switch (classification) {
    case 'OFFICIAL_ANNOUNCEMENT':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
          <ShieldCheck className="w-3 h-3 text-emerald-400" />
          OFFICIAL
        </span>
      );
    case 'VERIFIED_REPORT':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-blue-500/15 text-blue-300 border border-blue-500/40 flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-blue-400" />
          VERIFIED REPORT
        </span>
      );
    case 'MULTI_SOURCE_CORROBORATED':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-indigo-500/15 text-indigo-300 border border-indigo-500/40 flex items-center gap-1">
          <Layers className="w-3 h-3 text-indigo-400" />
          CORROBORATED
        </span>
      );
    case 'RUMOR_OR_LEAK':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-amber-500/15 text-amber-300 border border-amber-500/40 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3 text-amber-400" />
          RUMOR / LEAK
        </span>
      );
    case 'CONTRADICTED':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-rose-500/15 text-rose-300 border border-rose-500/40 flex items-center gap-1">
          <AlertCircle className="w-3 h-3 text-rose-400" />
          CONTRADICTED
        </span>
      );
    case 'SINGLE_SOURCE_REPORT':
    default:
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase bg-slate-800 text-slate-300 border border-slate-700">
          SINGLE SOURCE
        </span>
      );
  }
};

const renderThreatBadge = (threat?: CompetitiveThreatLevel) => {
  switch (threat) {
    case 'HIGH':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-rose-500/15 text-rose-300 border border-rose-500/40">
          HIGH THREAT
        </span>
      );
    case 'MEDIUM':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase bg-amber-500/15 text-amber-300 border border-amber-500/40">
          MED THREAT
        </span>
      );
    case 'LOW':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase bg-slate-800 text-slate-300 border border-slate-700">
          LOW THREAT
        </span>
      );
    case 'NOT_APPLICABLE':
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">
          HUAWEI 1P
        </span>
      );
    default:
      return null;
  }
};

const StoryCard: React.FC<StoryCardProps> = ({ story, isSelected = false, onClearSelection }) => {
  const { sources, getStoryConnectedArticles } = useApp();
  const [isExpanded, setIsExpanded] = useState(isSelected);
  const [activeTab, setActiveTab] = useState<'EVIDENCE' | 'TIMELINE' | 'COMPETITIVE' | 'ARTICLES'>('EVIDENCE');
  const [connectedItems, setConnectedItems] = useState<
    { membership: StoryMembership; article?: Article }[] | null
  >(null);
  const [isLoading, setIsLoading] = useState(false);

  // Auto-expand and scroll into view when targeted
  useEffect(() => {
    if (isSelected) {
      setIsExpanded(true);
      const el = document.getElementById(`story-${story.id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [isSelected, story.id]);

  // Authoritative counts from Story document
  const articleCount = story.articleCount ?? story.articleIds?.length ?? 0;
  const sourceCount = story.sourceCount ?? story.sourceIds?.length ?? 1;
  const independentSourceCount = story.independentSourceCount ?? sourceCount;

  // Resolved sources from currently known sources registry
  const linkedSources = useMemo(() => {
    if (!story.sourceIds || story.sourceIds.length === 0) return [];
    return sources.filter((s) => story.sourceIds.includes(s.id));
  }, [sources, story.sourceIds]);

  const handleToggleExpand = async () => {
    const nextState = !isExpanded;
    setIsExpanded(nextState);

    if (nextState && connectedItems === null) {
      setIsLoading(true);
      try {
        const items = await getStoryConnectedArticles(story.id);
        setConnectedItems(items);
      } catch (err) {
        console.warn(`Failed to hydrate connected articles for ${story.id}:`, err);
        setConnectedItems([]);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const canonicalCats = useMemo(() => Array.from(getStoryCanonicalCategories(story)), [story]);
  const primaryCategory = canonicalCats[0] || (story.categories && story.categories[0]) || story.category || 'SMARTPHONE';

  const importanceScore = story.strategicImportanceScore || story.importanceScore || 40;
  const confidencePercent = story.evidenceConfidence
    ? Math.round(story.evidenceConfidence * 100)
    : Math.round((story.confidence || 0.8) * 100);

  const lastMaterialDate = story.lastMaterialUpdateAt
    ? new Date(story.lastMaterialUpdateAt).toLocaleDateString()
    : new Date(story.lastSeenAt || story.firstSeenAt).toLocaleDateString();

  return (
    <div
      id={`story-${story.id}`}
      className={`p-5 bg-slate-900 rounded-xl space-y-4 transition ${
        isSelected
          ? 'border-2 border-indigo-500 ring-2 ring-indigo-500/50 bg-indigo-950/20 shadow-lg shadow-indigo-950/60'
          : 'border border-slate-800 hover:border-slate-700'
      }`}
    >
      {isSelected && (
        <div className="p-2.5 rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-indigo-200 text-xs font-mono font-semibold flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            STORY INTELLIGENCE RECORD TARGETED FROM DAILY BRIEF
          </span>
          {onClearSelection && (
            <button
              onClick={onClearSelection}
              className="text-[10px] text-indigo-300 hover:text-white underline cursor-pointer"
            >
              Clear Selection
            </button>
          )}
        </div>
      )}

      {/* Top Meta Bar */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
        <div className="space-y-1.5 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {renderLifecycleBadge(story.status)}
            {renderEvidenceBadge(story.evidenceClassification)}
            {renderThreatBadge(story.competitiveThreatLevel)}

            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">
              {primaryCategory}
            </span>

            <span className="text-[11px] text-slate-400 font-mono">
              {confidencePercent}% Evidence Conf.
            </span>

            <span className="text-[11px] text-slate-500 font-mono">
              • Material update: {lastMaterialDate}
            </span>
          </div>

          <h3 className="text-base font-bold text-slate-100 leading-snug">
            {story.canonicalTitle || story.title}
          </h3>
        </div>

        {/* Strategic Scores */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right p-2 rounded-lg bg-slate-950/70 border border-slate-800">
            <span className="text-[9px] text-slate-400 uppercase font-mono block">
              Strategic Index
            </span>
            <span
              className={`text-base font-mono font-bold ${
                importanceScore >= 75
                  ? 'text-rose-400'
                  : importanceScore >= 50
                  ? 'text-amber-400'
                  : 'text-slate-300'
              }`}
            >
              {importanceScore} <span className="text-xs text-slate-500 font-normal">/ 100</span>
            </span>
          </div>
        </div>
      </div>

      {/* Canonical English Summary */}
      <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/50 p-3 rounded-lg border border-slate-800/80">
        {story.canonicalSummary || story.summary}
      </p>

      {/* HUAWEI Competitive Implication Highlight */}
      {(story.competitiveImplication || story.huaweiRelevance) && (
        <div className="p-3 rounded-lg bg-slate-950 border border-indigo-950/80 flex items-start gap-2.5">
          <Flame className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
          <div className="text-xs">
            <strong className="text-indigo-300 font-mono text-[11px] uppercase mr-1.5">HUAWEI Competitive Impact:</strong>
            <span className="text-slate-300">
              {story.competitiveImplication || story.huaweiRelevance}
            </span>
          </div>
        </div>
      )}

      {/* Summary Chips: Independent Sources & Outlets */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1">
        <div className="flex items-center gap-2 flex-wrap text-[11px] font-mono text-slate-400">
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300">
            <Shield className="w-3 h-3 text-indigo-400" />
            {independentSourceCount} Independent {independentSourceCount === 1 ? 'Source' : 'Sources'}
          </span>
          <span className="text-slate-500">•</span>
          <span>{articleCount} Connected {articleCount === 1 ? 'Report' : 'Reports'}</span>
          <span className="text-slate-500">•</span>
          <span>{sourceCount} Media {sourceCount === 1 ? 'Outlet' : 'Outlets'}</span>
        </div>

        <button
          onClick={handleToggleExpand}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-slate-800/80 hover:bg-slate-800 text-indigo-300 hover:text-indigo-200 border border-slate-700/80 transition"
        >
          <span>Intelligence Drill-Down</span>
          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Expandable Intelligence Section */}
      {isExpanded && (
        <div className="pt-3 border-t border-slate-800/80 space-y-4">
          {/* Sub-Tabs */}
          <div className="flex items-center gap-2 border-b border-slate-800 pb-2 overflow-x-auto">
            {[
              { id: 'EVIDENCE', label: 'Evidence & Sources' },
              { id: 'TIMELINE', label: `Timeline (${story.timeline?.length || 1})` },
              { id: 'COMPETITIVE', label: 'HUAWEI Strategic Impact' },
              { id: 'ARTICLES', label: `Connected Articles (${articleCount})` },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-3 py-1 rounded-md text-xs font-mono font-medium transition ${
                  activeTab === tab.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* TAB 1: Evidence & Sources */}
          {activeTab === 'EVIDENCE' && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 space-y-1">
                  <span className="text-[10px] text-slate-400 font-mono uppercase block">Verification Status</span>
                  <div className="font-bold text-slate-200">{story.evidenceClassification || 'SINGLE_SOURCE_REPORT'}</div>
                  <span className="text-[11px] text-slate-400">Confidence: {confidencePercent}%</span>
                </div>
                <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 space-y-1">
                  <span className="text-[10px] text-slate-400 font-mono uppercase block">Source Independence</span>
                  <div className="font-bold text-slate-200">{independentSourceCount} Independent Entities</div>
                  <span className="text-[11px] text-slate-400">{sourceCount} reporting syndicated outlets</span>
                </div>
                <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 space-y-1">
                  <span className="text-[10px] text-slate-400 font-mono uppercase block">Last Material Development</span>
                  <div className="font-bold text-slate-200">{lastMaterialDate}</div>
                  <span className="text-[11px] text-slate-400">Strictly separates updates from syndication</span>
                </div>
              </div>

              {/* Evidence Reasons & Limitations */}
              {story.evidenceReasons && story.evidenceReasons.length > 0 && (
                <div className="p-3 rounded-lg bg-slate-950/40 border border-slate-800/80 space-y-1.5">
                  <span className="text-[10px] font-mono uppercase text-slate-400 block font-semibold">
                    Evidentiary Validation & Notes:
                  </span>
                  <ul className="space-y-1 text-slate-300">
                    {story.evidenceReasons.map((r, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-indigo-400 font-mono">•</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Verified Source Links */}
              <div className="space-y-2">
                <span className="text-[10px] font-mono uppercase text-slate-400 block font-semibold">
                  Source Provenance Registry:
                </span>
                <div className="flex flex-wrap gap-2">
                  {linkedSources.map((src) => (
                    <div
                      key={src.id}
                      className="p-2 rounded bg-slate-950 border border-slate-800 text-xs font-mono space-y-0.5"
                    >
                      <div className="flex items-center gap-1.5 text-slate-200 font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        {src.name}
                      </div>
                      <div className="text-[10px] text-slate-500">Market: {src.market || 'Global'}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Development Timeline */}
          {activeTab === 'TIMELINE' && (
            <div className="space-y-3 text-xs">
              <span className="text-[10px] font-mono uppercase text-slate-400 block font-semibold">
                Auditable Development Chronology:
              </span>
              <div className="space-y-2 relative border-l-2 border-indigo-500/30 pl-4 ml-2">
                {(story.timeline && story.timeline.length > 0 ? story.timeline : [
                  {
                    id: 'init',
                    timestamp: story.firstSeenAt,
                    developmentType: 'INITIAL_COVERAGE',
                    description: story.canonicalTitle || story.title || 'Initial storyline detected.',
                    confidence: 'HIGH',
                    evidenceClassification: story.evidenceClassification || 'SINGLE_SOURCE_REPORT',
                  },
                ]).map((dev: any, idx: number) => (
                  <div key={dev.id || idx} className="space-y-1 relative">
                    <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-indigo-400 border border-slate-900" />
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-slate-400">
                        {new Date(dev.timestamp).toLocaleString()}
                      </span>
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase bg-slate-800 text-slate-300 border border-slate-700">
                        {dev.developmentType}
                      </span>
                    </div>
                    <div className="text-slate-200 font-medium">{dev.description}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: HUAWEI Competitive Impact */}
          {activeTab === 'COMPETITIVE' && (
            <div className="space-y-3 text-xs">
              {story.huaweiRelevance && (
                <div className="p-3 bg-indigo-950/20 rounded-lg border border-indigo-900/40 space-y-1">
                  <span className="text-[10px] text-indigo-300 font-mono uppercase font-bold block">
                    Strategic Relevance to HUAWEI
                  </span>
                  <p className="text-slate-200">{story.huaweiRelevance}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 space-y-1">
                  <span className="text-[10px] text-slate-400 font-mono uppercase block">Competitive Implication</span>
                  <p className="text-slate-200">
                    {story.competitiveImplication ||
                      `Active market activity in ${primaryCategory.toLowerCase()} hardware segment.`}
                  </p>
                </div>
                <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800 space-y-1">
                  <span className="text-[10px] text-slate-400 font-mono uppercase block">Recommended Action</span>
                  <p className="text-slate-200">
                    {story.strategicRecommendation ||
                      `Track competitor announcements and feature differentials in daily intelligence brief.`}
                  </p>
                </div>
              </div>

              {story.strategicScoringFactors && (
                <div className="p-3 bg-slate-950/40 rounded-lg border border-slate-800 text-[11px] font-mono text-slate-400 space-y-1">
                  <span className="text-slate-300 font-semibold block uppercase text-[10px]">Strategic Scoring Breakdown:</span>
                  <div>{story.strategicScoringFactors.explanation}</div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: Connected Articles */}
          {activeTab === 'ARTICLES' && (
            <div className="space-y-2">
              {isLoading ? (
                <div className="p-4 rounded-lg bg-slate-950/60 border border-slate-800 flex items-center justify-center gap-2 text-xs text-slate-400 font-mono">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                  <span>Hydrating connected article intelligence...</span>
                </div>
              ) : connectedItems && connectedItems.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {connectedItems.map(({ membership, article }) => {
                    const headline = article?.title || membership.headline || `Article ${membership.articleId}`;
                    const outletName = article?.sourceName || membership.sourceName || 'Syndicated Source';
                    const pubDate = article?.publishedAt || membership.publishedAt;
                    const targetUrl = article?.canonicalUrl || (article as any)?.url;

                    return (
                      <div
                        key={membership.articleId}
                        className="p-2.5 rounded bg-slate-950/60 border border-slate-800 hover:border-indigo-500/50 flex items-start justify-between gap-2 group transition"
                      >
                        <div className="min-w-0 flex-1">
                          {targetUrl ? (
                            <a
                              href={targetUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-medium text-slate-200 group-hover:text-indigo-300 line-clamp-1 block"
                            >
                              {headline}
                            </a>
                          ) : (
                            <span className="text-xs font-medium text-slate-200 line-clamp-1 block">
                              {headline}
                            </span>
                          )}
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mt-1 font-mono">
                            <span className="text-indigo-400">{outletName}</span>
                            <span>•</span>
                            <span>{new Date(pubDate).toLocaleDateString()}</span>
                          </div>
                        </div>

                        {targetUrl && (
                          <a
                            href={targetUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 shrink-0"
                            title="Open original article in new tab"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-4 text-center text-xs text-slate-500 font-mono bg-slate-950/40 rounded border border-slate-800">
                  No active membership records returned for this cluster.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const StoriesView: React.FC = () => {
  const { stories, loadAllStories, canManage, selectedStoryId, setSelectedStoryId } = useApp();
  const [loadingAll, setLoadingAll] = useState(false);

  // Filters State
  const [categoryFilter, setCategoryFilter] = useState<
    'ALL_STRATEGIC' | 'SMARTPHONE' | 'WEARABLE' | 'AUDIO' | 'TABLET' | 'ECOSYSTEM' | 'ALL'
  >('ALL_STRATEGIC');
  const [lifecycleFilter, setLifecycleFilter] = useState<'ACTIVE' | 'ALL' | 'ARCHIVED'>('ACTIVE');
  const [companyFilter, setCompanyFilter] = useState<string>('ALL');
  const [evidenceFilter, setEvidenceFilter] = useState<string>('ALL');
  const [threatFilter, setThreatFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'LATEST_MATERIAL' | 'IMPORTANCE' | 'CONFIDENCE'>('LATEST_MATERIAL');

  // Reset filters if navigating to a specific story from Daily Brief so it's guaranteed visible
  useEffect(() => {
    if (selectedStoryId) {
      setCategoryFilter('ALL');
      setLifecycleFilter('ALL');
      setCompanyFilter('ALL');
      setEvidenceFilter('ALL');
      setThreatFilter('ALL');
    }
  }, [selectedStoryId]);

  // Admin Governance & Reconciliation State
  const [showReconciliationPanel, setShowReconciliationPanel] = useState(false);
  const [governanceTab, setGovernanceTab] = useState<'LIFECYCLE' | 'DUPLICATES'>('LIFECYCLE');

  // Lifecycle reconciliation state
  const [dryRunReport, setDryRunReport] = useState<any | null>(null);
  const [runningDryRun, setRunningDryRun] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [reconciliationResult, setReconciliationResult] = useState<any | null>(null);

  // Duplicate audit state
  const [duplicateAuditReport, setDuplicateAuditReport] = useState<any | null>(null);
  const [runningDuplicateAudit, setRunningDuplicateAudit] = useState(false);
  const [mergingPairId, setMergingPairId] = useState<string | null>(null);
  const [mergeSuccessMsg, setMergeSuccessMsg] = useState<string | null>(null);

  // Authoritative Production Story Isolation (Excludes legacy bootstrap stories)
  const productionStories = useMemo(
    () => stories.filter(isProductionStory),
    [stories]
  );

  // Filtering & Sorting Logic
  const filteredStories = useMemo(() => {
    return productionStories
      .filter((story) => {
        // 1. Lifecycle Status Filter
        const status = story.status || 'DEVELOPING';
        if (lifecycleFilter === 'ACTIVE') {
          if (status === 'ARCHIVED' || status === 'STALE') return false;
        } else if (lifecycleFilter === 'ARCHIVED') {
          if (status !== 'ARCHIVED' && status !== 'STALE') return false;
        }

        // 2. Category Filter
        const canonicalCats = getStoryCanonicalCategories(story);
        if (categoryFilter === 'ALL_STRATEGIC') {
          if (!Array.from(canonicalCats).some((cat) => STRATEGIC_CATEGORIES.has(cat))) {
            return false;
          }
        } else if (categoryFilter === 'SMARTPHONE') {
          if (!canonicalCats.has('SMARTPHONE')) return false;
        } else if (categoryFilter === 'WEARABLE') {
          if (!canonicalCats.has('WEARABLE')) return false;
        } else if (categoryFilter === 'AUDIO') {
          if (!canonicalCats.has('AUDIO')) return false;
        } else if (categoryFilter === 'TABLET') {
          if (!canonicalCats.has('TABLET')) return false;
        } else if (categoryFilter === 'ECOSYSTEM') {
          const isCore = Array.from(canonicalCats).some((cat) => STRATEGIC_CATEGORIES.has(cat));
          if (isCore) return false;
        }

        // 3. Company Filter
        if (companyFilter !== 'ALL') {
          const sComp = story.primaryCompanyId || story.companies?.[0]?.companyId;
          if (sComp !== companyFilter) return false;
        }

        // 4. Evidence Classification Filter
        if (evidenceFilter !== 'ALL') {
          const ev = story.evidenceClassification || 'SINGLE_SOURCE_REPORT';
          if (ev !== evidenceFilter) return false;
        }

        // 5. Threat Filter
        if (threatFilter !== 'ALL') {
          const th = story.competitiveThreatLevel || 'LOW';
          if (th !== threatFilter) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'IMPORTANCE') {
          const scoreB = b.strategicImportanceScore || b.importanceScore || 0;
          const scoreA = a.strategicImportanceScore || a.importanceScore || 0;
          return scoreB - scoreA;
        }
        if (sortBy === 'CONFIDENCE') {
          const confB = b.evidenceConfidence || b.confidence || 0;
          const confA = a.evidenceConfidence || a.confidence || 0;
          return confB - confA;
        }
        // LATEST_MATERIAL
        const timeB = new Date(b.lastMaterialUpdateAt || b.lastSeenAt || b.updatedAt || 0).getTime();
        const timeA = new Date(a.lastMaterialUpdateAt || a.lastSeenAt || a.updatedAt || 0).getTime();
        return timeB - timeA;
      });
  }, [
    productionStories,
    categoryFilter,
    lifecycleFilter,
    companyFilter,
    evidenceFilter,
    threatFilter,
    sortBy,
  ]);

  const handleLoadAll = async () => {
    setLoadingAll(true);
    try {
      await loadAllStories();
    } finally {
      setLoadingAll(false);
    }
  };

  const handleRunDryRun = async () => {
    setRunningDryRun(true);
    setReconciliationResult(null);
    try {
      const report = await aiIntelligenceService.getStoryLifecycleDryRun();
      setDryRunReport(report);
    } catch (err) {
      console.error('Lifecycle dry-run failed:', err);
    } finally {
      setRunningDryRun(false);
    }
  };

  const handleExecuteReconciliation = async () => {
    if (!window.confirm('Execute bounded lifecycle reconciliation for production stories? Statuses will be updated conservatively.')) {
      return;
    }
    setReconciling(true);
    try {
      const res = await aiIntelligenceService.executeStoryLifecycleReconciliation({ batchSize: 50, limit: 500 });
      setReconciliationResult(res);
      await loadAllStories();
      const report = await aiIntelligenceService.getStoryLifecycleDryRun();
      setDryRunReport(report);
    } catch (err) {
      console.error('Lifecycle reconciliation failed:', err);
    } finally {
      setReconciling(false);
    }
  };

  const handleRunDuplicateAudit = async () => {
    setRunningDuplicateAudit(true);
    setMergeSuccessMsg(null);
    try {
      const report = await aiIntelligenceService.getStoryDuplicateAudit();
      setDuplicateAuditReport(report);
    } catch (err) {
      console.error('Duplicate audit failed:', err);
    } finally {
      setRunningDuplicateAudit(false);
    }
  };

  const handleExecuteMerge = async (cand: any) => {
    const confirmText = `Merge duplicate Story B into Story A?\n\nTarget Story A: ${cand.storyA.title}\nSource Story B: ${cand.storyB.title}\n\nArticles will be consolidated and Story B will be marked RESOLVED.`;
    if (!window.confirm(confirmText)) return;

    setMergingPairId(cand.pairId);
    setMergeSuccessMsg(null);
    try {
      const res = await aiIntelligenceService.executeStoryMerge({
        targetStoryId: cand.storyA.id,
        sourceStoryId: cand.storyB.id,
        reason: cand.reason,
      });
      setMergeSuccessMsg(`Successfully consolidated ${cand.storyB.id} into ${cand.storyA.id} (${res.mergedArticleCount} total articles).`);
      await loadAllStories();
      // Refresh audit report
      const rep = await aiIntelligenceService.getStoryDuplicateAudit();
      setDuplicateAuditReport(rep);
    } catch (err: any) {
      console.error('Merge failed:', err);
      alert(`Merge failed: ${err.message}`);
    } finally {
      setMergingPairId(null);
    }
  };

  return (
    <AppPage>
      {/* Standardized Page Header */}
      <PageHeader
        title="Story Intelligence"
        badges={
          <SemanticBadge
            variant="info"
            label={`${filteredStories.length} of ${productionStories.length} Stories`}
          />
        }
        description="Evidence-verified storylines tracking HUAWEI and key competitors across core hardware categories."
        actions={
          canManage ? (
            <Button
              variant="outline"
              size="md"
              onClick={() => setShowReconciliationPanel(!showReconciliationPanel)}
              leftIcon={<ShieldAlert className="w-3.5 h-3.5 text-amber-400" />}
            >
              Lifecycle Governance & Deduplication {showReconciliationPanel ? '▲' : '▼'}
            </Button>
          ) : undefined
        }
      />

      {/* Admin Governance & Deduplication Panel */}
      {canManage && showReconciliationPanel && (
        <div className="p-4 bg-slate-900/95 border border-amber-500/30 rounded-xl space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                Story Intelligence Lifecycle Governance & Historical Reconciliation
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Deterministic lifecycle management, duplicate detection, and bounded administrative actions. Zero mutations during dry runs.
              </p>
            </div>

            {/* Panel Tabs */}
            <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button
                onClick={() => setGovernanceTab('LIFECYCLE')}
                className={`px-3 py-1 rounded text-xs font-mono font-semibold transition ${
                  governanceTab === 'LIFECYCLE'
                    ? 'bg-slate-800 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Lifecycle Maintenance
              </button>
              <button
                onClick={() => setGovernanceTab('DUPLICATES')}
                className={`px-3 py-1 rounded text-xs font-mono font-semibold transition ${
                  governanceTab === 'DUPLICATES'
                    ? 'bg-slate-800 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Duplicate Candidate Audit
              </button>
            </div>
          </div>

          {/* TAB 1: Lifecycle Maintenance */}
          {governanceTab === 'LIFECYCLE' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-300">
                  Evaluates NEW, DEVELOPING, STABLE, RESOLVED, and ARCHIVED states.
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRunDryRun}
                    disabled={runningDryRun}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 flex items-center gap-1.5 transition disabled:opacity-50"
                  >
                    {runningDryRun ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 text-indigo-400" />}
                    <span>Run Dry-Run Audit</span>
                  </button>
                  {dryRunReport && dryRunReport.storiesRequiringChangeCount > 0 && (
                    <button
                      onClick={handleExecuteReconciliation}
                      disabled={reconciling}
                      className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-xs font-bold text-white shadow-sm flex items-center gap-1.5 transition disabled:opacity-50"
                    >
                      {reconciling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                      <span>Reconcile ({dryRunReport.storiesRequiringChangeCount})</span>
                    </button>
                  )}
                </div>
              </div>

              {dryRunReport && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div className="p-2.5 bg-slate-950/60 rounded border border-slate-800">
                      <span className="text-slate-400 block text-[10px] uppercase font-mono">Evaluated</span>
                      <span className="text-base font-bold font-mono text-slate-200">{dryRunReport.totalProductionStories}</span>
                    </div>
                    <div className="p-2.5 bg-slate-950/60 rounded border border-slate-800">
                      <span className="text-slate-400 block text-[10px] uppercase font-mono">Changes Needed</span>
                      <span className="text-base font-bold font-mono text-amber-400">{dryRunReport.storiesRequiringChangeCount}</span>
                    </div>
                    <div className="p-2.5 bg-slate-950/60 rounded border border-slate-800">
                      <span className="text-slate-400 block text-[10px] uppercase font-mono">To Archive (&ge;30d)</span>
                      <span className="text-base font-bold font-mono text-slate-400">{dryRunReport.potentiallyArchivedCount}</span>
                    </div>
                    <div className="p-2.5 bg-slate-950/60 rounded border border-slate-800">
                      <span className="text-slate-400 block text-[10px] uppercase font-mono">To Reactivate</span>
                      <span className="text-base font-bold font-mono text-emerald-400">{dryRunReport.potentiallyReactivatedCount}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 text-[11px] font-mono">
                    {Object.entries(dryRunReport.proposedLifecycleDistribution).map(([st, count]) => (
                      <span key={st} className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300">
                        {st}: <strong className="text-white">{count as number}</strong>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {reconciliationResult && (
                <div className="p-3 rounded bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 font-mono">
                  ✓ Reconciliation complete: {reconciliationResult.storiesChanged} stories updated in {reconciliationResult.durationMs}ms.
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Duplicate Candidate Audit */}
          {governanceTab === 'DUPLICATES' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-300">
                  Scans 398 production stories for identical developments and cross-language duplicates.
                </span>
                <button
                  onClick={handleRunDuplicateAudit}
                  disabled={runningDuplicateAudit}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 flex items-center gap-1.5 transition disabled:opacity-50"
                >
                  {runningDuplicateAudit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitMerge className="w-3.5 h-3.5 text-indigo-400" />}
                  <span>Run Duplicate Audit</span>
                </button>
              </div>

              {mergeSuccessMsg && (
                <div className="p-3 rounded bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 font-mono">
                  ✓ {mergeSuccessMsg}
                </div>
              )}

              {duplicateAuditReport && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div className="p-2.5 bg-slate-950/60 rounded border border-slate-800">
                      <span className="text-slate-400 block text-[10px] uppercase font-mono">Stories Audited</span>
                      <span className="text-base font-bold font-mono text-slate-200">{duplicateAuditReport.totalStoriesAudited}</span>
                    </div>
                    <div className="p-2.5 bg-slate-950/60 rounded border border-slate-800">
                      <span className="text-slate-400 block text-[10px] uppercase font-mono">Candidate Pairs</span>
                      <span className="text-base font-bold font-mono text-amber-400">{duplicateAuditReport.suspectedDuplicatePairsCount}</span>
                    </div>
                    <div className="p-2.5 bg-slate-950/60 rounded border border-slate-800">
                      <span className="text-slate-400 block text-[10px] uppercase font-mono">Clear Merges</span>
                      <span className="text-base font-bold font-mono text-emerald-400">{duplicateAuditReport.clearMergesCount}</span>
                    </div>
                    <div className="p-2.5 bg-slate-950/60 rounded border border-slate-800">
                      <span className="text-slate-400 block text-[10px] uppercase font-mono">Flagged For Review</span>
                      <span className="text-base font-bold font-mono text-slate-400">{duplicateAuditReport.flaggedForReviewCount}</span>
                    </div>
                  </div>

                  {/* Candidate Pairs Table */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] uppercase font-mono text-slate-400 block font-semibold">
                      Candidate Pairs Preview (Top Candidates):
                    </span>
                    <div className="overflow-x-auto rounded border border-slate-800">
                      <table className="w-full text-left text-xs text-slate-300">
                        <thead className="bg-slate-950 text-[10px] font-mono text-slate-400 uppercase">
                          <tr>
                            <th className="p-2">Story A</th>
                            <th className="p-2">Story B</th>
                            <th className="p-2">Similarity</th>
                            <th className="p-2">Action</th>
                            <th className="p-2">Reason</th>
                            <th className="p-2 text-right">Execute</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                          {duplicateAuditReport.candidatePairs.slice(0, 10).map((cand: any) => (
                            <tr key={cand.pairId} className="hover:bg-slate-800/30">
                              <td className="p-2 max-w-xs truncate text-slate-200">
                                <div>{cand.storyA.title}</div>
                                <div className="text-[9px] text-slate-500">{cand.storyA.id}</div>
                              </td>
                              <td className="p-2 max-w-xs truncate text-slate-200">
                                <div>{cand.storyB.title}</div>
                                <div className="text-[9px] text-slate-500">{cand.storyB.id}</div>
                              </td>
                              <td className="p-2 font-bold text-indigo-300">{cand.similarityScore}%</td>
                              <td className="p-2">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  cand.proposedAction === 'MERGE'
                                    ? 'bg-emerald-500/20 text-emerald-300'
                                    : 'bg-amber-500/20 text-amber-300'
                                }`}>
                                  {cand.proposedAction}
                                </span>
                              </td>
                              <td className="p-2 text-slate-400 text-[10px] max-w-xs truncate">{cand.reason}</td>
                              <td className="p-2 text-right">
                                {cand.proposedAction === 'MERGE' && (
                                  <button
                                    onClick={() => handleExecuteMerge(cand)}
                                    disabled={mergingPairId === cand.pairId}
                                    className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold disabled:opacity-50"
                                  >
                                    {mergingPairId === cand.pairId ? 'Merging...' : 'Merge'}
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Control Bar: Categories, Filters, and Sorting */}
      <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl space-y-3">
        {/* Row 1: Category Tabs */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-mono text-slate-500 uppercase mr-1 flex items-center gap-1">
            <Filter className="w-3 h-3" /> Scope:
          </span>
          {[
            { id: 'ALL_STRATEGIC', label: 'Strategic Focus (4 Categories)' },
            { id: 'SMARTPHONE', label: 'Smartphones' },
            { id: 'WEARABLE', label: 'Wearables' },
            { id: 'AUDIO', label: 'Audio' },
            { id: 'TABLET', label: 'Tablets' },
            { id: 'ECOSYSTEM', label: 'Ecosystem / Other' },
            { id: 'ALL', label: 'All Categories' },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategoryFilter(cat.id as any)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                categoryFilter === cat.id
                  ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Row 2: Secondary Dropdowns (Lifecycle, Company, Evidence, Threat, Sort) */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/60">
          <div className="flex flex-wrap items-center gap-2">
            {/* Lifecycle */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
              {[
                { id: 'ACTIVE', label: 'Active' },
                { id: 'ALL', label: 'All Lifecycle' },
                { id: 'ARCHIVED', label: 'Archived' },
              ].map((lf) => (
                <button
                  key={lf.id}
                  onClick={() => setLifecycleFilter(lf.id as any)}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono transition ${
                    lifecycleFilter === lf.id
                      ? 'bg-slate-800 text-slate-100 font-bold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {lf.label}
                </button>
              ))}
            </div>

            {/* Company Filter */}
            <select
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-200 text-xs font-mono focus:outline-none focus:border-indigo-500"
            >
              <option value="ALL">All Competitors</option>
              <option value="comp-huawei">HUAWEI</option>
              <option value="comp-apple">Apple</option>
              <option value="comp-samsung">Samsung</option>
              <option value="comp-xiaomi">Xiaomi</option>
              <option value="comp-honor">HONOR</option>
              <option value="comp-garmin">Garmin</option>
              <option value="comp-google">Google / Fitbit</option>
            </select>

            {/* Evidence Classification Filter */}
            <select
              value={evidenceFilter}
              onChange={(e) => setEvidenceFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-200 text-xs font-mono focus:outline-none focus:border-indigo-500"
            >
              <option value="ALL">All Evidence Tiers</option>
              <option value="OFFICIAL_ANNOUNCEMENT">Official Announcements</option>
              <option value="VERIFIED_REPORT">Verified Reports</option>
              <option value="MULTI_SOURCE_CORROBORATED">Multi-Source Corroborated</option>
              <option value="RUMOR_OR_LEAK">Rumors & Leaks</option>
            </select>

            {/* Threat Level Filter */}
            <select
              value={threatFilter}
              onChange={(e) => setThreatFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-200 text-xs font-mono focus:outline-none focus:border-indigo-500"
            >
              <option value="ALL">All Threat Levels</option>
              <option value="HIGH">High Threat</option>
              <option value="MEDIUM">Medium Threat</option>
              <option value="LOW">Low Threat</option>
            </select>
          </div>

          {/* Sort Selector */}
          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
            <ArrowUpDown className="w-3 h-3 text-slate-500" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
            >
              <option value="LATEST_MATERIAL">Latest Material Update</option>
              <option value="IMPORTANCE">Strategic Index</option>
              <option value="CONFIDENCE">Evidence Confidence</option>
            </select>
          </div>
        </div>
      </div>

      {/* Stories Grid */}
      {filteredStories.length === 0 ? (
        <EmptyStateCard
          title="No stories match the active filters"
          description="Try resetting filters to view all strategic intelligence."
          density="standard"
        />
      ) : (
        <div className="space-y-4">
          {(selectedStoryId
            ? [
                ...filteredStories.filter((s) => s.id === selectedStoryId),
                ...filteredStories.filter((s) => s.id !== selectedStoryId),
              ]
            : filteredStories
          ).map((story) => (
            <StoryCard
              key={story.id}
              story={story}
              isSelected={story.id === selectedStoryId}
              onClearSelection={() => setSelectedStoryId(null)}
            />
          ))}
        </div>
      )}

      {/* Historical Archive Load Button */}
      {productionStories.length >= 50 && (
        <div className="pt-4 text-center">
          <Button
            variant="secondary"
            size="md"
            onClick={handleLoadAll}
            disabled={loadingAll}
            isLoading={loadingAll}
            leftIcon={<Clock className="w-3.5 h-3.5 text-purple-400" />}
          >
            {loadingAll ? 'Loading All Historical Stories...' : 'Load Full Historical Story Archive'}
          </Button>
        </div>
      )}
    </AppPage>
  );
};
