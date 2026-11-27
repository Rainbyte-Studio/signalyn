import React, { useState } from 'react';
import {
  X,
  Sparkles,
  ExternalLink,
  ShieldAlert,
  Building2,
  Smartphone,
  Tag,
  Clock,
  TrendingUp,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  RotateCw,
  FileText,
  Quote,
  Flame,
  Scale,
} from 'lucide-react';
import { Article, ArticleAnalysis } from '../../types';
import { useApp } from '../../context/AppContext';

interface ArticleIntelligenceModalProps {
  article: Article;
  analysis?: ArticleAnalysis;
  onClose: () => void;
}

export const ArticleIntelligenceModal: React.FC<ArticleIntelligenceModalProps> = ({
  article,
  analysis,
  onClose,
}) => {
  const { sources, analyzeArticle, isAnalyzing, analyzingArticleId, settings, canManage } = useApp();
  const [activeTab, setActiveTab] = useState<'analysis' | 'raw'>('analysis');

  const isCurrentAnalyzing = isAnalyzing && analyzingArticleId === article.id;
  const myCompany = settings?.myCompanyName || 'HUAWEI';
  const isSourceActive = sources.some((s) => s.id === article.sourceId);

  const handleReanalyze = async () => {
    await analyzeArticle(article.id, true);
  };

  const getImportanceBadge = (score: number) => {
    if (score >= 80) {
      return {
        label: 'Critical',
        bg: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
        bar: 'bg-rose-500',
      };
    }
    if (score >= 60) {
      return {
        label: 'High',
        bg: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        bar: 'bg-amber-500',
      };
    }
    if (score >= 40) {
      return {
        label: 'Moderate',
        bg: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
        bar: 'bg-indigo-500',
      };
    }
    if (score >= 20) {
      return {
        label: 'Low',
        bg: 'bg-slate-700/50 text-slate-300 border-slate-600',
        bar: 'bg-slate-400',
      };
    }
    return {
      label: 'Very Low',
      bg: 'bg-slate-800 text-slate-400 border-slate-700',
      bar: 'bg-slate-500',
    };
  };

  const getSentimentBadge = (sentiment: string) => {
    switch (sentiment) {
      case 'POSITIVE':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
      case 'NEGATIVE':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
      case 'MIXED':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-black/75 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-950/80 border-b border-slate-800 flex items-start justify-between gap-4">
          <div className="space-y-1.5 flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[11px] font-mono font-semibold border border-indigo-500/30 flex items-center gap-1.5">
                <span>{article.sourceName || article.sourceId}</span>
                {!isSourceActive && (
                  <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 font-sans font-normal">
                    Source removed
                  </span>
                )}
              </span>
              <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] font-mono border border-slate-700">
                {article.market} • {article.language.toUpperCase()}
              </span>
              <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-500" />
                {new Date(article.publishedAt).toLocaleDateString([], {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>

            <h2 className="text-base md:text-lg font-bold text-slate-100 leading-snug line-clamp-2">
              {article.title}
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href={article.canonicalUrl}
              target="_blank"
              rel="noreferrer"
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition"
              title="Open Original Canonical Link"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Switcher & Actions Bar */}
        <div className="px-6 py-2.5 bg-slate-950/40 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setActiveTab('analysis')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition ${
                activeTab === 'analysis'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Gemini Intelligence</span>
            </button>
            <button
              onClick={() => setActiveTab('raw')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition ${
                activeTab === 'raw'
                  ? 'bg-slate-800 text-slate-200 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Raw Article ({article.id.slice(0, 12)})</span>
            </button>
          </div>

          {canManage && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleReanalyze}
                disabled={isCurrentAnalyzing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium shadow-xs transition"
              >
                <RotateCw className={`w-3.5 h-3.5 ${isCurrentAnalyzing ? 'animate-spin' : ''}`} />
                <span>{isCurrentAnalyzing ? 'Analyzing with Gemini...' : 'Re-analyze with Gemini'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-200">
          {activeTab === 'analysis' ? (
            analysis ? (
              <div className="space-y-6">
                {/* Architecture Model Watermark */}
                <div className="p-3 bg-indigo-950/20 border border-indigo-900/40 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="font-mono text-indigo-300 font-semibold">
                      Model: {analysis.model}
                    </span>
                    <span className="text-slate-500">•</span>
                    <span className="font-mono text-slate-400 text-[11px]">
                      Version: {analysis.analysisVersion}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-400 font-mono text-[11px]">
                    {analysis.processingMetadata?.executionTimeMs && (
                      <span>Latency: {analysis.processingMetadata.executionTimeMs}ms</span>
                    )}
                    <span>Confidence: {Math.round((analysis.confidence ?? (analysis as any).confidenceScore ?? 0.85) * 100)}%</span>
                  </div>
                </div>

                {/* Primary Intelligence Indicators */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {/* News Type */}
                  <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl space-y-1">
                    <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">
                      News Classification
                    </span>
                    <span className="text-xs font-bold text-slate-100 block truncate">
                      {analysis.newsType}
                    </span>
                    {analysis.secondaryNewsTypes && analysis.secondaryNewsTypes.length > 0 && (
                      <span className="text-[10px] text-slate-500 font-mono block truncate">
                        +{analysis.secondaryNewsTypes.join(', ')}
                      </span>
                    )}
                  </div>

                  {/* Importance Score */}
                  {(() => {
                    const imp = getImportanceBadge(analysis.importanceScore);
                    return (
                      <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                            Importance
                          </span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${imp.bg}`}>
                            {imp.label}
                          </span>
                        </div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-lg font-black text-slate-100">
                            {analysis.importanceScore}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">/ 100</span>
                        </div>
                        <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${imp.bar}`}
                            style={{ width: `${analysis.importanceScore}%` }}
                          />
                        </div>
                      </div>
                    );
                  })()}

                  {/* Sentiment */}
                  <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl space-y-1">
                    <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">
                      Tone & Sentiment
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded border ${getSentimentBadge(
                          analysis.sentiment
                        )}`}
                      >
                        {analysis.sentiment}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono block">
                      Confidence: {Math.round((analysis.sentimentConfidence ?? 0.8) * 100)}%
                    </span>
                  </div>

                  {/* Competitive Relevance */}
                  <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl space-y-1">
                    <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">
                      Target Relevance
                    </span>
                    <div className="flex items-baseline gap-1">
                      <span className="text-lg font-black text-indigo-300">
                        {analysis.competitiveRelevance?.score ?? 'N/A'}
                      </span>
                      {analysis.competitiveRelevance?.score !== undefined && (
                        <span className="text-[10px] text-slate-500 font-mono">/ 100</span>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono block truncate">
                      Relative to {myCompany}
                    </span>
                  </div>
                </div>

                {/* Executive Summary */}
                <div className="p-4 bg-slate-950/40 border border-slate-800 rounded-xl space-y-2">
                  <div className="flex items-center gap-2 text-indigo-400">
                    <Sparkles className="w-4 h-4" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 font-mono">
                      Executive Intelligence Summary
                    </h3>
                  </div>
                  <p className="text-xs md:text-sm text-slate-200 leading-relaxed font-sans">
                    {analysis.summary}
                  </p>
                </div>

                {/* Key Points */}
                {(analysis.keyPoints || []).length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">
                      Key Intelligence Takeaways
                    </h3>
                    <div className="grid gap-2">
                      {(analysis.keyPoints || []).map((pt, idx) => (
                        <div
                          key={idx}
                          className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl flex items-start gap-2.5 text-xs text-slate-300"
                        >
                          <span className="w-5 h-5 rounded-md bg-indigo-500/10 text-indigo-300 font-mono font-bold flex items-center justify-center shrink-0 text-[11px] border border-indigo-500/20">
                            {idx + 1}
                          </span>
                          <span className="leading-relaxed">{pt}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Competitive Relevance Insights */}
                {analysis.competitiveRelevance && (
                  <div className="p-4 bg-slate-950/40 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Scale className="w-4 h-4 text-indigo-400" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 font-mono">
                          Competitive Relevance & Rival Impact
                        </h3>
                      </div>
                      <span className="text-xs font-mono font-bold text-indigo-300">
                        Score: {analysis.competitiveRelevance.score ?? 0}%
                      </span>
                    </div>

                    {(analysis.competitiveRelevance.reasons || []).length > 0 && (
                      <div className="space-y-1.5">
                        <span className="text-[11px] font-mono text-slate-400">Strategic Reasons:</span>
                        <ul className="list-disc list-inside space-y-1 text-xs text-slate-300">
                          {analysis.competitiveRelevance.reasons.map((r, i) => (
                            <li key={i} className="leading-relaxed">
                              {r}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-slate-800 text-xs">
                      {(analysis.competitiveRelevance.categories || []).length > 0 && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-mono text-slate-400">Contested Sectors:</span>
                          <div className="flex flex-wrap gap-1">
                            {analysis.competitiveRelevance.categories.map((cat, i) => (
                              <span
                                key={i}
                                className="px-1.5 py-0.5 rounded bg-slate-900 text-slate-300 text-[10px] font-mono border border-slate-800"
                              >
                                {cat}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {(analysis.competitiveRelevance.relatedCompanies || []).length > 0 && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-mono text-slate-400">Impacted Rivals:</span>
                          <div className="flex flex-wrap gap-1">
                            {analysis.competitiveRelevance.relatedCompanies.map((comp, i) => (
                              <span
                                key={i}
                                className="px-1.5 py-0.5 rounded bg-indigo-950/40 text-indigo-300 text-[10px] font-mono border border-indigo-800/40"
                              >
                                {comp}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Grounded Competitive Signals with Excerpts */}
                {analysis.competitiveSignals && analysis.competitiveSignals.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Flame className="w-4 h-4 text-amber-400" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">
                        Structured Competitive Signals ({analysis.competitiveSignals.length})
                      </h3>
                    </div>

                    <div className="grid gap-3">
                      {analysis.competitiveSignals.map((sig, idx) => (
                        <div
                          key={idx}
                          className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-xl space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[10px] font-bold border border-amber-500/30">
                                {sig.type}
                              </span>
                              <span className="text-xs font-bold text-slate-200">
                                {sig.company} {sig.product ? `• ${sig.product}` : ''}
                              </span>
                            </div>
                            <span className="text-[10px] font-mono text-slate-500">
                              Confidence: {Math.round(sig.confidence * 100)}%
                            </span>
                          </div>

                          <p className="text-xs text-slate-300 leading-relaxed font-sans">
                            {sig.description}
                          </p>

                          {sig.evidence && (
                            <div className="p-2.5 bg-slate-900/90 border-l-2 border-indigo-500 rounded-r-lg flex items-start gap-2 text-[11px] text-slate-400 italic">
                              <Quote className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
                              <span>"{sig.evidence}"</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Detected Companies & Products */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Companies */}
                  <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl space-y-2.5">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-indigo-400" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 font-mono">
                        Detected Companies ({analysis.companies.length})
                      </h4>
                    </div>

                    <div className="space-y-1.5">
                      {(analysis.companies || []).map((c, i) => (
                        <div
                          key={i}
                          className="p-2 bg-slate-900 border border-slate-800/80 rounded-lg flex items-center justify-between text-xs"
                        >
                          <div>
                            <span className="font-semibold text-slate-200">
                              {c.canonicalName}
                            </span>
                            {c.matchedAlias && c.matchedAlias !== c.canonicalName && (
                              <span className="text-[10px] text-slate-400 font-mono ml-1.5">
                                (as "{c.matchedAlias}")
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-[9px] font-mono px-1.5 py-0.2 rounded ${
                                c.relevance === 'PRIMARY'
                                  ? 'bg-indigo-600 text-white font-bold'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              {c.relevance}
                            </span>
                            <span className="text-[10px] font-mono text-slate-500">
                              {Math.round(c.confidence * 100)}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Products */}
                  <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl space-y-2.5">
                    <div className="flex items-center gap-2">
                      <Smartphone className="w-4 h-4 text-indigo-400" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 font-mono">
                        Detected Products ({(analysis.products || []).length})
                      </h4>
                    </div>

                    <div className="space-y-1.5">
                      {(!analysis.products || analysis.products.length === 0) ? (
                        <p className="text-xs text-slate-500 italic">No specific hardware models tagged.</p>
                      ) : (
                        analysis.products.map((p, i) => (
                          <div
                            key={i}
                            className="p-2 bg-slate-900 border border-slate-800/80 rounded-lg flex items-center justify-between text-xs"
                          >
                            <div className="min-w-0 pr-2">
                              <span className="font-semibold text-slate-200 block truncate">
                                {p.canonicalName}
                              </span>
                              <span className="text-[10px] text-slate-400 font-mono block">
                                {p.category} {p.subcategory ? `• ${p.subcategory}` : ''}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span
                                className={`text-[9px] font-mono px-1.5 py-0.2 rounded ${
                                  p.relevance === 'PRIMARY'
                                    ? 'bg-indigo-600 text-white font-bold'
                                    : 'bg-slate-800 text-slate-400'
                                }`}
                              >
                                {p.relevance}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* Topics */}
                {(analysis.topics || []).length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5 text-slate-500" />
                      <span>Canonical Topics ({analysis.topics.length})</span>
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.topics.map((t, i) => (
                        <span
                          key={i}
                          className="px-2 py-1 rounded-md bg-slate-950 border border-slate-800 text-slate-300 text-xs font-mono"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Unresolved Entities Warning if any */}
                {((analysis.unresolvedCompanies && analysis.unresolvedCompanies.length > 0) ||
                  (analysis.unresolvedProducts && analysis.unresolvedProducts.length > 0)) && (
                  <div className="p-3.5 bg-amber-950/20 border border-amber-900/40 rounded-xl space-y-1 text-xs">
                    <div className="flex items-center gap-2 text-amber-300 font-bold">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>Unresolved Entities Routed to Review Queue</span>
                    </div>
                    <p className="text-slate-400 text-[11px] leading-relaxed">
                      Gemini detected new entities not yet in the canonical registry. These have been
                      queued in <span className="font-mono text-amber-200">/entityReview</span> for
                      analyst onboarding rather than automatically modifying the registry.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-12 text-center space-y-4 bg-slate-950/40 border border-slate-800 rounded-xl">
                <Sparkles className="w-10 h-10 text-indigo-400 mx-auto animate-pulse" />
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-slate-100">
                    {article.processingStatus === 'FAILED'
                      ? 'Analysis Failed'
                      : 'Article Not Yet Analyzed'}
                  </h3>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    {article.processingStatus === 'FAILED'
                      ? 'Analysis is unavailable for this article. The source article is still available.'
                      : 'Extract structured intelligence, company mentions, product tags, sentiment, and competitive relevance via Gemini.'}
                  </p>
                </div>
                {canManage && <button
                  onClick={handleReanalyze}
                  disabled={isCurrentAnalyzing}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs shadow-md transition"
                >
                  <RotateCw className={`w-4 h-4 ${isCurrentAnalyzing ? 'animate-spin' : ''}`} />
                  <span>
                    {isCurrentAnalyzing ? 'Running Gemini Analysis...' : 'Analyze with Gemini Now'}
                  </span>
                </button>}
              </div>
            )
          ) : (
            /* Raw Article Tab - Demonstrating Raw vs Analyzed separation */
            <div className="space-y-4">
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-slate-300">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="font-mono">Immutable Raw Document: /articles/{article.id}</span>
                </div>
                <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono text-[10px] border border-emerald-500/30">
                  Status: {article.processingStatus}
                </span>
              </div>

              <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl space-y-3 font-mono text-xs">
                <div>
                  <span className="text-slate-500 block text-[10px]">Article ID:</span>
                  <span className="text-slate-200 select-all">{article.id}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Canonical URL:</span>
                  <a
                    href={article.canonicalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-400 hover:underline break-all"
                  >
                    {article.canonicalUrl}
                  </a>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Deterministic Content Hash:</span>
                  <span className="text-slate-300">{article.contentHash}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Raw Ingested Categories:</span>
                  <span className="text-slate-300">
                    {article.rawCategories.join(', ') || 'None'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Published Timestamp:</span>
                  <span className="text-slate-300">{article.publishedAt}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Collected Timestamp:</span>
                  <span className="text-slate-300">{article.collectedAt}</span>
                </div>
              </div>

              <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl space-y-2">
                <h4 className="text-xs font-mono text-slate-400 uppercase tracking-wider font-bold">
                  Raw Ingested Excerpt
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed font-sans">
                  {article.excerpt || 'No excerpt available.'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between text-xs text-slate-500">
          <span className="font-mono text-[10px]">
            Cloud Firestore: signalyn-5406e • /articleAnalysis/{article.id}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-lg transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
