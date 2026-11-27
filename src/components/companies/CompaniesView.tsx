import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Shield,
  Check,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Company } from '../../types';
import {
  getMergedCanonicalCompanies,
  getMergedCanonicalProducts,
} from '../../services/canonicalEntities';
import {
  getPrimaryCompany,
  getCompanyMarketEvidence,
  STANDARD_CATEGORIES,
} from '../../services/competitorSelectors';
import {
  AppPage,
  PageHeader,
  FilterToolbar,
  SearchInput,
  ResponsiveGrid,
  SemanticBadge,
  Button,
} from '../common/DesignSystem';

export const CompaniesView: React.FC = () => {
  const { companies, settings, setPrimaryCompany, products, canManage } = useApp();
  const [searchQuery, setSearchQuery] = useState('');

  // Combined company list (Firestore + Static Canonical Registry)
  const allCompanies = useMemo(() => {
    return getMergedCanonicalCompanies(companies);
  }, [companies]);

  // Combined product catalog (Firestore + Canonical Catalog)
  const allProducts = useMemo(() => {
    return getMergedCanonicalProducts(products);
  }, [products]);

  const primaryCompany = useMemo(
    () => getPrimaryCompany(companies, settings),
    [companies, settings]
  );

  const filteredCompanies = allCompanies.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.aliases.some((a) => a.toLowerCase().includes(q)) ||
      c.categories.some((cat) => cat.toLowerCase().includes(q))
    );
  });

  const handleMakePrimary = async (comp: Company) => {
    if (comp.id === primaryCompany.id) return;
    await setPrimaryCompany(comp.id);
  };

  return (
    <AppPage>
      {/* Standardized Page Header */}
      <PageHeader
        title="Tracked Companies"
        badges={
          <>
            <SemanticBadge variant="neutral" label={`${allCompanies.length} Total Entities`} />
            <SemanticBadge variant="info" label="1 Primary Target" />
            <SemanticBadge
              variant="review"
              label={`${allCompanies.filter((c) => c.isCompetitor).length} Tracked Rivals`}
            />
          </>
        }
        description="Configure primary intelligence perspective and market competitors. Any company can be designated as the primary reference point."
        actions={
          <SemanticBadge
            variant="verified"
            icon={<Shield className="w-3.5 h-3.5 text-emerald-400" />}
            label="Deterministic Canonical Registry Active"
            className="px-3 py-1.5 text-[11px]"
          />
        }
      />

      {/* Standardized Filter Toolbar */}
      <FilterToolbar>
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search company by name, brand aliases, or product categories..."
        />
      </FilterToolbar>

      {/* Companies Grid */}
      <ResponsiveGrid cols={3} gap="md">
        {filteredCompanies.map((company) => {
          const compProducts = allProducts.filter((p) => p.companyId === company.id);
          const isPrimary = company.id === primaryCompany.id;
          const isCompetitor = !isPrimary && company.isCompetitor;

          return (
            <div
              key={company.id}
              className={`p-5 rounded-xl border transition-colors flex flex-col justify-between ${
                isPrimary
                  ? 'bg-indigo-950/20 border-indigo-500/60 ring-1 ring-indigo-500/40'
                  : 'bg-slate-900 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-slate-200 text-sm shrink-0">
                      {company.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-bold text-slate-100 text-sm">{company.name}</h3>
                        {isPrimary && <SemanticBadge variant="info" label="PRIMARY" />}
                      </div>
                      <a
                        href={company.website}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-slate-400 hover:text-indigo-400 flex items-center gap-1 font-mono mt-0.5"
                      >
                        {company.website.replace(/^https?:\/\//, '')}
                        <ExternalLink className="w-3 h-3 text-slate-500" />
                      </a>
                    </div>
                  </div>

                  <SemanticBadge
                    variant={isPrimary ? 'info' : isCompetitor ? 'review' : 'neutral'}
                    label={isPrimary ? 'Target' : isCompetitor ? 'Tracked Competitor' : 'Ecosystem OEM'}
                  />
                </div>

                {/* Aliases */}
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-mono text-slate-500 block">
                    Brand Aliases
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {company.aliases.map((alias) => (
                      <span
                        key={alias}
                        className="px-1.5 py-0.5 rounded bg-slate-950 text-slate-300 text-[10px] font-mono border border-slate-800"
                      >
                        {alias}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Categories */}
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-mono tabular-nums text-slate-500 block">
                    Product Domains ({company.categories.length})
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {company.categories.map((cat) => (
                      <span
                        key={cat}
                        className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-mono"
                      >
                        {cat}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Selected for Comparison */}
                <div className="space-y-1 pt-1 border-t border-slate-800/60">
                  <span className="text-[10px] uppercase font-mono tabular-nums text-slate-500 flex items-center justify-between">
                    <span>Selected for Comparison</span>
                    <span className="text-slate-400 font-mono">
                      {STANDARD_CATEGORIES.filter((cat) =>
                        (settings?.competitorSets?.[cat] || []).includes(company.id)
                      ).length > 0
                        ? `${
                            STANDARD_CATEGORIES.filter((cat) =>
                              (settings?.competitorSets?.[cat] || []).includes(company.id)
                            ).length
                          } categories`
                        : 'None'}
                    </span>
                  </span>
                  {STANDARD_CATEGORIES.filter((cat) =>
                    (settings?.competitorSets?.[cat] || []).includes(company.id)
                  ).length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {STANDARD_CATEGORIES.filter((cat) =>
                        (settings?.competitorSets?.[cat] || []).includes(company.id)
                      ).map((cat) => (
                        <span
                          key={cat}
                          className="px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 text-[10px] font-mono"
                        >
                          {cat}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-[11px] text-slate-500 italic block">
                      None configured in Settings
                    </span>
                  )}
                </div>

                {/* Greek Market Presence */}
                <div className="space-y-1 pt-1 border-t border-slate-800/60">
                  <div className="flex items-center justify-between text-[10px] font-mono">
                    <span className="text-slate-500 flex items-center gap-1">Greek Market:</span>
                    {getCompanyMarketEvidence(company.id, 'GR').status === 'OFFICIAL' && (
                      <span className="text-emerald-400 font-semibold flex items-center gap-1">
                        <Check className="w-3 h-3" /> Official Distribution
                      </span>
                    )}
                    {getCompanyMarketEvidence(company.id, 'GR').status === 'RETAIL_CONFIRMED' && (
                      <span className="text-amber-400 font-semibold flex items-center gap-1">
                        <Check className="w-3 h-3" /> Confirmed Retail
                      </span>
                    )}
                    {getCompanyMarketEvidence(company.id, 'GR').status === 'UNKNOWN' && (
                      <span className="text-slate-400 italic">Not Verified</span>
                    )}
                    {getCompanyMarketEvidence(company.id, 'GR').status === 'UNAVAILABLE' && (
                      <span className="text-rose-400 font-semibold">Confirmed Unavailable</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="pt-4 mt-4 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <div className="flex flex-col font-mono tabular-nums">
                  <span className="text-slate-300 text-[11px] font-semibold">
                    {compProducts.length} tracked models
                  </span>
                  <span className="text-slate-500 text-[10px]">
                    {compProducts.filter(
                      (p) => p.lifecycle === 'RELEASED' || p.lifecycle === 'ANNOUNCED'
                    ).length > 0 &&
                      `${
                        compProducts.filter(
                          (p) => p.lifecycle === 'RELEASED' || p.lifecycle === 'ANNOUNCED'
                        ).length
                      } active`}
                    {compProducts.filter(
                      (p) => p.lifecycle === 'RELEASED' || p.lifecycle === 'ANNOUNCED'
                    ).length > 0 &&
                      compProducts.filter(
                        (p) => p.lifecycle === 'RUMORED' || p.lifecycle === 'PROTOTYPE'
                      ).length > 0 &&
                      ' • '}
                    {compProducts.filter(
                      (p) => p.lifecycle === 'RUMORED' || p.lifecycle === 'PROTOTYPE'
                    ).length > 0 &&
                      `${
                        compProducts.filter(
                          (p) => p.lifecycle === 'RUMORED' || p.lifecycle === 'PROTOTYPE'
                        ).length
                      } rumored`}
                  </span>
                </div>
                {isPrimary ? (
                  <span className="text-emerald-400 text-xs font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Primary Reference
                  </span>
                ) : canManage ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleMakePrimary(company)}
                  >
                    Set as Primary
                  </Button>
                ) : (
                  <span className="text-slate-500 text-xs font-mono">Tracked Enterprise</span>
                )}
              </div>
            </div>
          );
        })}
      </ResponsiveGrid>
    </AppPage>
  );
};
