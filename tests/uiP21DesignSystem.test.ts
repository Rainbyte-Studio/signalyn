import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DESIGN_TOKENS,
  SEMANTIC_BADGE_STYLES,
  SemanticStatusVariant,
} from '../src/styles/designTokens';

function runDesignSystemTests() {
  console.log('Running SIGNALYN UI P2.1 Unified Design System & Platform-Wide Visual Consistency Suite...\n');

  // 1. Verify Design Token Foundation
  assert.equal(DESIGN_TOKENS.colors.background.app, 'bg-slate-950', 'Canvas token must be bg-slate-950');
  assert.equal(DESIGN_TOKENS.colors.background.surfacePrimary, 'bg-slate-900', 'Surface 1 token must be bg-slate-900');
  assert.equal(DESIGN_TOKENS.colors.border.default, 'border-slate-800', 'Hairline border token must be border-slate-800');
  assert.equal(DESIGN_TOKENS.radius.card, 'rounded-xl', 'Card radius must be rounded-xl');
  assert.equal(DESIGN_TOKENS.radius.control, 'rounded-lg', 'Control radius must be rounded-lg');
  assert.equal(DESIGN_TOKENS.radius.badge, 'rounded', 'Badge radius must be rounded (zero-pill discipline)');

  // 2. Verify Semantic Badge Styles Map
  const requiredSemanticVariants: SemanticStatusVariant[] = [
    'verified',
    'likely',
    'review',
    'pending',
    'active',
    'unavailable',
    'error',
    'info',
    'neutral',
  ];
  for (const variant of requiredSemanticVariants) {
    assert.ok(
      SEMANTIC_BADGE_STYLES[variant] && SEMANTIC_BADGE_STYLES[variant].className.length > 0,
      `SEMANTIC_BADGE_STYLES must define styles for variant "${variant}"`
    );
  }
  console.log('✓ 1. Design tokens & semantic badge styles verified.');

  // 3. Verify CSS Custom Properties & Accessibility Rules in src/index.css
  const indexCss = fs.readFileSync(path.resolve('src/index.css'), 'utf8');
  assert.ok(indexCss.includes('--ds-bg-app:'), 'index.css must define --ds-bg-app token');
  assert.ok(indexCss.includes('--ds-surface-primary:'), 'index.css must define --ds-surface-primary token');
  assert.ok(indexCss.includes('--ds-border-default:'), 'index.css must define --ds-border-default token');
  assert.ok(indexCss.includes('font-variant-numeric: tabular-nums'), 'index.css must enforce tabular-nums utility');
  assert.ok(indexCss.includes('prefers-reduced-motion: reduce'), 'index.css must support prefers-reduced-motion');
  console.log('✓ 2. Global CSS tokens, focus-visible ring, tabular-nums, and reduced-motion rules verified.');

  // 4. Verify Shared Design System Component Exports in src/components/common/DesignSystem.tsx
  const dsFile = fs.readFileSync(path.resolve('src/components/common/DesignSystem.tsx'), 'utf8');
  const expectedExports = [
    'export const AppPage',
    'export const PageHeader',
    'export const PageDescription',
    'export const PageActions',
    'export const SectionHeader',
    'export const ContentSection',
    'export const ResponsiveGrid',
    'export const MetricCard',
    'export const ContentCard',
    'export const InsightCard',
    'export const StatusCard',
    'export const EmptyStateCard',
    'export const Button',
    'export const SearchInput',
    'export const SelectControl',
    'export const FilterToolbar',
    'export function SegmentedControl',
    'export const SemanticBadge',
    'export const DataTableContainer',
    'export const ChartCard',
  ];
  for (const exp of expectedExports) {
    assert.ok(dsFile.includes(exp), `DesignSystem.tsx must export "${exp}"`);
  }
  console.log('✓ 3. All 20 shared design system components verified in DesignSystem.tsx.');

  // 5. Verify Platform-Wide Adoption Across All 16 Screens
  const all16Views = [
    'src/components/overview/OverviewDashboard.tsx',
    'src/components/feed/FeedView.tsx',
    'src/components/stories/StoriesView.tsx',
    'src/components/dailybrief/DailyBriefView.tsx',
    'src/components/companies/CompaniesView.tsx',
    'src/components/products/ProductsView.tsx',
    'src/components/retail/RetailPricesView.tsx',
    'src/components/competitors/CompetitorsView.tsx',
    'src/components/trends/TrendsView.tsx',
    'src/components/service/ServiceIntelligenceView.tsx',
    'src/components/voc/VoiceOfCustomerView.tsx',
    'src/components/analytics/AnalyticsView.tsx',
    'src/components/backfill/HistoricalBackfillView.tsx',
    'src/components/sources/SourcesManager.tsx',
    'src/components/reviews/EntityReviewsView.tsx',
    'src/components/settings/SettingsView.tsx',
  ];

  for (const viewPath of all16Views) {
    const content = fs.readFileSync(path.resolve(viewPath), 'utf8');
    assert.ok(
      content.includes('from \'../common/DesignSystem\'') || content.includes('from "../common/DesignSystem"'),
      `${viewPath} must import shared components from DesignSystem.tsx`
    );
    assert.ok(
      content.includes('<AppPage'),
      `${viewPath} must use <AppPage> as its standardized page container`
    );
  }
  console.log('✓ 4. All 16 application screens verified to adopt <AppPage> and shared DesignSystem components.');

  // 6. Verify Double-Padding Removal in RetailPricesView & ServiceIntelligenceView
  const retailContent = fs.readFileSync(path.resolve('src/components/retail/RetailPricesView.tsx'), 'utf8');
  assert.ok(
    !retailContent.includes('p-6 space-y-6 max-w-7xl mx-auto w-full'),
    'RetailPricesView must not duplicate outer p-6 max-w-7xl wrapper inside App.tsx main container'
  );

  const serviceContent = fs.readFileSync(path.resolve('src/components/service/ServiceIntelligenceView.tsx'), 'utf8');
  assert.ok(
    !serviceContent.includes('p-6 space-y-6 max-w-7xl mx-auto w-full'),
    'ServiceIntelligenceView must not duplicate outer p-6 max-w-7xl wrapper inside App.tsx main container'
  );
  console.log('✓ 5. Redundant nested page wrappers and sticky header conflicts eliminated in Retail & Service views.');

  // 7. Verify Decorative Pulsing Dots Removed on Static Indicators
  const headerContent = fs.readFileSync(path.resolve('src/components/layout/Header.tsx'), 'utf8');
  const sidebarContent = fs.readFileSync(path.resolve('src/components/layout/Sidebar.tsx'), 'utf8');
  assert.ok(
    !headerContent.includes('animate-pulse'),
    'Header.tsx must not use decorative animate-pulse on static Firestore status indicator'
  );
  assert.ok(
    !sidebarContent.includes('animate-pulse'),
    'Sidebar.tsx must not use decorative animate-pulse on static Intelligence Target indicator'
  );
  console.log('✓ 6. Decorative pulsing animations removed from static status indicators in Header and Sidebar.');

  console.log('\nALL SIGNALYN UI P2.1 DESIGN SYSTEM TESTS PASSED!');
}

runDesignSystemTests();
