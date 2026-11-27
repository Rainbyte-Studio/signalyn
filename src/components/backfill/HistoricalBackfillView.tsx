/**
 * Signalyn Historical Backfill View
 *
 * Clean executive-grade interface for expanding historical intelligence coverage
 * across strategic hardware categories, with administrator-only operational tools.
 */

import React from 'react';
import { Database, ArrowLeft, BarChart3 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { HistoricalBackfillSection } from '../settings/HistoricalBackfillSection';
import { AppPage, PageHeader, Button } from '../common/DesignSystem';

export const HistoricalBackfillView: React.FC = () => {
  const { canManage, setActiveTab } = useApp();

  return (
    <AppPage>
      <PageHeader
        eyebrow={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className="text-xs font-medium text-slate-400 hover:text-slate-200 flex items-center gap-1 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Overview
            </button>
            <span className="text-slate-600 text-xs">/</span>
            <span className="text-xs text-indigo-400 font-semibold">Historical Backfill</span>
          </div>
        }
        title={
          <span className="inline-flex items-center gap-2.5">
            <Database className="w-5 h-5 text-indigo-400 shrink-0" />
            <span>Historical Backfill</span>
          </span>
        }
        description="Analyze historical articles to expand intelligence coverage and identify past market developments."
        actions={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setActiveTab('analytics')}
              leftIcon={<BarChart3 className="w-3.5 h-3.5 text-indigo-400" />}
            >
              Analytics
            </Button>
            <Button variant="secondary" size="md" onClick={() => setActiveTab('feed')}>
              Intelligence Feed
            </Button>
          </>
        }
      />

      <HistoricalBackfillSection canManage={canManage} />
    </AppPage>
  );
};
