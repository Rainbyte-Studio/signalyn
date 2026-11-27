/**
 * Signalyn — Technology News Aggregation & Competitive Intelligence Platform
 * Phase 1 Application Foundation
 */

import React, { useCallback, useRef, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { ToastContainer } from './components/layout/ToastContainer';

// Views
import { OverviewDashboard } from './components/overview/OverviewDashboard';
import { FeedView } from './components/feed/FeedView';
import { StoriesView } from './components/stories/StoriesView';
import { CompaniesView } from './components/companies/CompaniesView';
import { ProductsView } from './components/products/ProductsView';
import { CompetitorsView } from './components/competitors/CompetitorsView';
import { TrendsView } from './components/trends/TrendsView';
import { DailyBriefView } from './components/dailybrief/DailyBriefView';
import { RetailPricesView } from './components/retail/RetailPricesView';
import { ServiceIntelligenceView } from './components/service/ServiceIntelligenceView';
import { VoiceOfCustomerView } from './components/voc/VoiceOfCustomerView';
import { AnalyticsView } from './components/analytics/AnalyticsView';
import { SourcesManager } from './components/sources/SourcesManager';
import { EntityReviewsView } from './components/reviews/EntityReviewsView';
import { SettingsView } from './components/settings/SettingsView';
import { HistoricalBackfillView } from './components/backfill/HistoricalBackfillView';
import { RestrictedAccessView } from './components/common/RestrictedAccessView';

const MainContent: React.FC = () => {
  const { activeTab, setActiveTab, canManage, isLoading } = useApp();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuTrigger = useRef<HTMLButtonElement>(null);

  const closeMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(false);
    mobileMenuTrigger.current?.focus();
  }, []);

  const renderActiveView = () => {
    switch (activeTab) {
      case 'overview':
        return <OverviewDashboard />;
      case 'feed':
        return <FeedView />;
      case 'stories':
        return <StoriesView />;
      case 'companies':
        return <CompaniesView />;
      case 'products':
        return <ProductsView />;
      case 'retail-prices':
        return <RetailPricesView />;
      case 'service':
        return <ServiceIntelligenceView />;
      case 'voc':
        return <VoiceOfCustomerView />;
      case 'competitors':
        return <CompetitorsView />;
      case 'trends':
        return <TrendsView />;
      case 'daily-brief':
        return <DailyBriefView />;
      case 'analytics':
        return <AnalyticsView />;
      case 'sources':
        return <SourcesManager />;
      case 'backfill':
        return canManage ? (
          <HistoricalBackfillView />
        ) : (
          <RestrictedAccessView
            title="Historical Backfill Workflow Restricted"
            description="The Historical Intelligence Backfill workflow is restricted to verified administrators. Guest sessions have read-only permissions."
            onReturn={() => setActiveTab('overview')}
          />
        );
      case 'reviews':
        return canManage ? (
          <EntityReviewsView />
        ) : (
          <RestrictedAccessView
            title="Entity Review Workflow Restricted"
            description="The Entity Review & Canonical Promotion workflow is restricted to verified administrators. Guest sessions are strictly read-only."
            onReturn={() => setActiveTab('overview')}
          />
        );
      case 'settings':
        return <SettingsView />;
      default:
        return <OverviewDashboard />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col antialiased selection:bg-indigo-500/30 selection:text-indigo-200">
      {/* Mobile Drawer Backdrop */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 lg:hidden backdrop-blur-xs"
          onClick={closeMobileMenu}
        />
      )}

      <div className="flex flex-1 min-h-screen overflow-hidden">
        {/* Primary Sidebar */}
        <Sidebar
          isMobileOpen={isMobileMenuOpen}
          onCloseMobile={closeMobileMenu}
        />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">
          <Header
            mobileMenuTrigger={mobileMenuTrigger}
            isMobileMenuOpen={isMobileMenuOpen}
            onToggleMobileMenu={() => setIsMobileMenuOpen((prev) => !prev)}
          />

          <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-7xl w-full mx-auto">
            {renderActiveView()}
          </main>
        </div>
      </div>

      <ToastContainer />
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <MainContent />
    </AppProvider>
  );
}
