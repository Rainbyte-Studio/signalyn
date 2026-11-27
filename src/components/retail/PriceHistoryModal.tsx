import React, { useEffect, useState } from 'react';
import { X, TrendingDown, TrendingUp, Minus, Calendar, ExternalLink, ShieldAlert, ShieldCheck, AlertCircle, Info, Lock } from 'lucide-react';
import { RetailProduct, RetailOffer, RetailPriceHistoryEntry } from '../../types/retailPrice';
import {
  evaluateProductPriceComparisonSemantics,
  normalizeRetailBrandDisplay,
} from '../../utils/dataIntegrityContracts';

interface PriceHistoryModalProps {
  product: RetailProduct;
  offers: RetailOffer[];
  onClose: () => void;
}

export const PriceHistoryModal: React.FC<PriceHistoryModalProps> = ({ product, offers, onClose }) => {
  const [history, setHistory] = useState<RetailPriceHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadHistory() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/retail/history/${encodeURIComponent(product.id)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (isMounted) {
          setHistory(data.history || []);
        }
      } catch (err: unknown) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    loadHistory();
    return () => {
      isMounted = false;
    };
  }, [product.id]);

  const formatEuro = (cents: number | null | undefined) => {
    if (cents === null || cents === undefined || cents <= 0) return '—';
    return (cents / 100).toLocaleString('el-GR', { style: 'currency', currency: 'EUR' });
  };

  const livePrices = history.filter((h) => h.isLiveVerified && h.priceCents > 0).map((h) => h.priceCents);
  const hasLiveVerified = history.some((h) => h.isLiveVerified) || offers.some((o) => o.isLiveVerified);
  const rangePrices = hasLiveVerified
    ? livePrices
    : history.filter((h) => h.priceCents > 0).map((h) => h.priceCents);
  const minObserved = rangePrices.length ? Math.min(...rangePrices) : null;
  const maxObserved = rangePrices.length ? Math.max(...rangePrices) : null;
  const comparisonSemantics = evaluateProductPriceComparisonSemantics({
    item: {
      product,
      offers,
      lowestPriceCents: minObserved,
      lowestRetailer: null,
      lowestLiveVerifiedPriceCents: livePrices.length > 0 ? Math.min(...livePrices) : null,
      lowestLiveVerifiedRetailer: null,
      lowestPilotPriceCents: null,
      lowestPilotRetailer: null,
      effectiveLowestPriceCents: minObserved,
      effectiveLowestPriceProvenance: hasLiveVerified ? 'LIVE_VERIFIED' : 'SEEDED_PILOT',
      priceDelta24hCents: null,
      priceDelta7dCents: null,
      priceDelta30dCents: null,
      comparisonType: 'SINGLE_RETAILER_LIVE',
      lastUpdated: offers[0]?.lastCheckedAt || null,
    },
    historyEntries: history,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-slate-900 border border-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-slate-800 bg-slate-900/80">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2 py-0.5 text-[11px] font-mono uppercase tracking-wider rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                {product.category}
              </span>
              <span className="px-2 py-0.5 text-[11px] font-mono tracking-wider rounded bg-slate-800 text-slate-300">
                {normalizeRetailBrandDisplay(product.brand)}
              </span>
              <span
                className={`px-2 py-0.5 text-[11px] font-mono rounded ${
                  product.isPilot
                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                }`}
              >
                {product.isPilot ? 'Pilot Catalog' : 'Auto-Discovered'}
              </span>
              {product.ean && (
                <span className="text-[11px] font-mono text-slate-400">
                  EAN: {product.ean}
                </span>
              )}
            </div>
            <h2 className="text-xl font-bold text-slate-100">{product.name}</h2>
            <p className="text-xs text-slate-400 mt-1 font-mono">
              Model: {product.modelFamily} • Storage: {product.storage || 'N/A'} • Color: {product.color || 'N/A'} • Connectivity: {product.connectivity || 'N/A'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Provenance Notice */}
          <div
            className={`p-3.5 rounded-lg border text-xs flex items-start gap-2.5 ${
              hasLiveVerified
                ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-300'
                : 'bg-amber-950/30 border-amber-800/40 text-amber-300'
            }`}
          >
            <Info className={`w-4 h-4 shrink-0 mt-0.5 ${hasLiveVerified ? 'text-emerald-400' : 'text-amber-400'}`} />
            <div className="space-y-1">
              <p className={`font-semibold ${hasLiveVerified ? 'text-emerald-200' : 'text-amber-200'}`}>
                {hasLiveVerified
                  ? 'Verified Retail Price History'
                  : 'Seeded Pilot Baseline Data Only (No Live Offer Yet)'}
              </p>
              <p className="text-slate-300 leading-relaxed text-[11px]">
                {hasLiveVerified
                  ? 'This ledger contains LIVE_VERIFIED observations extracted directly from Greek retail category pages alongside preserved historical baseline snapshots.'
                  : 'This product currently has only SEEDED_PILOT reference observations anchored to 2025-02-18 and no matching LIVE_VERIFIED offer yet.'}
              </p>
            </div>
          </div>

          {/* Key Range Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-slate-950/60 border border-slate-800/80">
              <span className="text-xs text-slate-400 font-medium">
                {hasLiveVerified ? 'Lowest Recorded Verified Price' : 'Pilot Baseline Lowest'}
              </span>
              <div className="text-2xl font-bold font-mono tabular-nums text-emerald-400 mt-1">
                {formatEuro(minObserved)}
              </div>
              <span className="text-[10px] text-slate-400 font-mono">
                {hasLiveVerified ? 'Eligible LIVE_VERIFIED observation' : 'SEEDED_PILOT reference baseline'}
              </span>
            </div>
            <div className="p-4 rounded-lg bg-slate-950/60 border border-slate-800/80">
              <span className="text-xs text-slate-400 font-medium">{hasLiveVerified ? 'Highest Recorded Verified Price' : 'Pilot Baseline Highest'}</span>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-300 mt-1">
                {formatEuro(maxObserved)}
              </div>
              <span className="text-[10px] text-slate-400 font-mono">{hasLiveVerified ? 'Eligible LIVE_VERIFIED observation' : 'SEEDED_PILOT reference baseline'}</span>
            </div>
            <div className="p-4 rounded-lg bg-slate-950/60 border border-slate-800/80">
              <span className="text-xs text-slate-400 font-medium">24h Delta & Freshness</span>
              <div className="text-base font-bold font-mono tabular-nums text-indigo-300 mt-1">
                {comparisonSemantics.primaryLabel}
              </div>
              <span className="text-[10px] text-slate-400 font-mono block mt-0.5">
                {comparisonSemantics.secondaryLabel} ({offers.length} offer{offers.length === 1 ? '' : 's'})
              </span>
            </div>
          </div>

          {/* Current Tracked Offers */}
          <div>
            <h3 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-indigo-400" />
              Tracked Retailer Offers & Provenance
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {offers.map((offer) => (
                <div
                  key={offer.id}
                  className="p-4 rounded-lg bg-slate-950/80 border border-slate-800 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold text-slate-200">{offer.retailerName}</span>
                      <span
                        className={`text-[9px] font-mono px-1.5 py-0.5 rounded uppercase font-semibold ${
                          offer.isLiveVerified
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        }`}
                      >
                        {offer.isLiveVerified ? 'LIVE VERIFIED' : 'SEEDED PILOT'}
                      </span>
                    </div>
                    <div className="text-xl font-bold font-mono tabular-nums text-slate-100">
                      {formatEuro(offer.currentPriceCents)}
                    </div>
                    {offer.referencePriceCents && offer.referencePriceCents > (offer.currentPriceCents || 0) && (
                      <span className="text-xs font-mono text-slate-400 line-through">
                        MSRP {formatEuro(offer.referencePriceCents)}
                      </span>
                    )}
                    {offer.provenanceNote && (
                      <p className="text-[10px] text-slate-400 mt-2 leading-tight">
                        {offer.provenanceNote}
                      </p>
                    )}
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                    <span className="text-[11px] text-slate-400 font-mono">SKU: {offer.retailerSku}</span>
                    <a
                      href={offer.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-medium"
                    >
                      Store Link <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Historical Observations Ledger */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-indigo-400" />
                Price Observation Ledger (Europe/Athens)
              </h3>
              <span className="text-xs text-slate-400 font-mono">Append-only historical records</span>
            </div>

            {isLoading ? (
              <div className="p-8 text-center text-slate-400 font-mono text-xs">
                Loading price history ledger...
              </div>
            ) : error ? (
              <div className="p-4 rounded-lg bg-red-950/30 border border-red-800/40 text-red-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                Error loading history: {error}
              </div>
            ) : history.length === 0 ? (
              <div className="p-6 text-center text-slate-400 font-mono text-xs bg-slate-950/40 rounded-lg border border-slate-800">
                No observations recorded yet for this product.
              </div>
            ) : (
              <div className="border border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950/90 text-slate-400 font-mono border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Athens Date</th>
                      <th className="py-2.5 px-4 font-medium">Retailer</th>
                      <th className="py-2.5 px-4 font-medium">Observed Price</th>
                      <th className="py-2.5 px-4 font-medium">Provenance</th>
                      <th className="py-2.5 px-4 font-medium">Stock Status</th>
                      <th className="py-2.5 px-4 font-medium">Source Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {history.map((entry) => (
                      <tr key={entry.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-2.5 px-4 font-bold text-slate-200">{entry.dateAthens}</td>
                        <td className="py-2.5 px-4 text-slate-300 capitalize">{entry.retailerId.replace('-gr', '')}</td>
                        <td className="py-2.5 px-4 font-bold text-slate-100 tabular-nums">
                          {formatEuro(entry.priceCents)}
                        </td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              entry.isLiveVerified
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            }`}
                          >
                            {entry.isLiveVerified ? 'LIVE VERIFIED' : 'SEEDED PILOT'}
                          </span>
                        </td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${
                              entry.isAvailable
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-red-500/10 text-red-400 border border-red-500/20'
                            }`}
                          >
                            {entry.stockStatus}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-slate-400 text-[11px]">
                          {entry.priceSourceType}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/90 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
