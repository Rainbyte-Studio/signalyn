/**
 * Signalyn UI P2.1 — Shared Design System Component Library
 *
 * Provides standardized layout containers, card primitives, button variants,
 * form & filter controls, semantic badges, data table wrappers, and chart containers.
 */

import React from 'react';
import { Search, Loader2 } from 'lucide-react';
import {
  DESIGN_TOKENS,
  CardDensityVariant,
  ButtonVariant,
  ButtonSize,
  SemanticStatusVariant,
  SEMANTIC_BADGE_STYLES,
} from '../../styles/designTokens';

/* ============================================================================
 * C1. PAGE LAYOUT & SECTION HIERARCHY COMPONENTS
 * ========================================================================== */

export interface AppPageProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Standardized top-level page wrapper with consistent vertical rhythm (`space-y-6`).
 */
export const AppPage: React.FC<AppPageProps> = ({ children, className = '' }) => (
  <div className={`space-y-6 min-w-0 ${className}`.trim()}>{children}</div>
);

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Standardized page header with title, optional eyebrow/badges, description, and right-aligned actions.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  eyebrow,
  icon,
  badge,
  badges,
  actions,
  className = '',
}) => {
  const resolvedBadges = badges ?? badge;
  return (
    <header
      className={`flex flex-col lg:flex-row lg:items-start justify-between gap-4 pb-5 border-b border-slate-800 ${className}`.trim()}
    >
      <div className="space-y-1.5 min-w-0 flex-1">
        {eyebrow && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-mono text-slate-400">
            {eyebrow}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2.5">
          {icon && <span className="text-indigo-400 shrink-0">{icon}</span>}
          <h1 className={DESIGN_TOKENS.typography.pageTitle}>{title}</h1>
          {resolvedBadges && <div className="flex flex-wrap items-center gap-1.5">{resolvedBadges}</div>}
        </div>
        {description && <PageDescription>{description}</PageDescription>}
      </div>
      {actions && <PageActions>{actions}</PageActions>}
    </header>
  );
};

export const PageDescription: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <p className={`text-xs sm:text-sm text-slate-400 max-w-3xl leading-relaxed ${className}`.trim()}>
    {children}
  </p>
);

export const PageActions: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <div className={`flex flex-wrap items-center gap-2.5 shrink-0 ${className}`.trim()}>
    {children}
  </div>
);

export interface SectionHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  subtitle,
  badge,
  actions,
  className = '',
}) => (
  <div
    className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${className}`.trim()}
  >
    <div className="space-y-0.5 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={DESIGN_TOKENS.typography.sectionHeader}>{title}</h2>
        {badge}
      </div>
      {subtitle && <p className={DESIGN_TOKENS.typography.bodySecondary}>{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

export interface ContentSectionProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}

export const ContentSection: React.FC<ContentSectionProps> = ({
  title,
  subtitle,
  badge,
  actions,
  children,
  className = '',
  ariaLabel,
}) => (
  <section aria-label={ariaLabel} className={`space-y-3 ${className}`.trim()}>
    {(title || actions) && (
      <SectionHeader title={title} subtitle={subtitle} badge={badge} actions={actions} />
    )}
    {children}
  </section>
);

export interface ResponsiveGridProps {
  cols?: 1 | 2 | 3 | 4 | 6;
  gap?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  className?: string;
}

export const ResponsiveGrid: React.FC<ResponsiveGridProps> = ({
  cols = 4,
  gap = 'md',
  children,
  className = '',
}) => {
  const colClasses: Record<number, string> = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 lg:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4',
    6: 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6',
  };
  const gapClasses = {
    sm: 'gap-3',
    md: 'gap-4',
    lg: 'gap-6',
  };
  return (
    <div className={`grid ${colClasses[cols]} ${gapClasses[gap]} ${className}`.trim()}>
      {children}
    </div>
  );
};

/* ============================================================================
 * C2. CARD SYSTEM (MetricCard, ContentCard, InsightCard, StatusCard, EmptyStateCard)
 * ========================================================================== */

export interface MetricCardProps {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  secondaryContext?: React.ReactNode;
  footerLeft?: React.ReactNode;
  footerRight?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'nominal' | 'warning' | 'critical' | 'positive' | 'info' | 'muted';
  density?: CardDensityVariant;
  isLoading?: boolean;
  onClick?: () => void;
  className?: string;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  unit,
  secondaryContext,
  footerLeft,
  footerRight,
  icon,
  tone = 'nominal',
  density = 'standard',
  isLoading = false,
  onClick,
  className = '',
}) => {
  const paddingClass = DESIGN_TOKENS.cardPadding[density];

  if (isLoading) {
    return (
      <div
        className={`${paddingClass} bg-slate-900 border border-slate-800 rounded-xl flex flex-col justify-between min-h-[132px] ${className}`.trim()}
      >
        <div className="space-y-2.5">
          <div className="h-3.5 w-32 bg-slate-800 rounded" />
          <div className="h-7 w-20 bg-slate-800 rounded" />
          <div className="h-3 w-40 bg-slate-800/70 rounded" />
        </div>
        <div className="pt-2.5 mt-2.5 border-t border-slate-800/80 flex justify-between">
          <div className="h-2.5 w-24 bg-slate-800/60 rounded" />
          <div className="h-2.5 w-14 bg-slate-800/60 rounded" />
        </div>
      </div>
    );
  }

  const toneValueMap: Record<NonNullable<MetricCardProps['tone']>, string> = {
    nominal: 'text-slate-100',
    positive: 'text-emerald-400',
    warning: 'text-amber-300',
    critical: 'text-rose-400',
    info: 'text-sky-400',
    muted: 'text-slate-300',
  };

  const content = (
    <>
      <div className="space-y-1.5 w-full">
        <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
          <span className="font-medium text-slate-300 truncate">{label}</span>
          {icon && <span className="shrink-0 text-slate-400">{icon}</span>}
        </div>
        <div className="flex items-baseline gap-2 pt-0.5">
          <span
            className={`${
              density === 'compact'
                ? DESIGN_TOKENS.typography.kpiDisplayMedium
                : DESIGN_TOKENS.typography.kpiDisplayLarge
            } ${toneValueMap[tone]}`}
          >
            {value}
          </span>
          {unit && (
            <span className="text-xs text-slate-400 font-mono tabular-nums truncate">{unit}</span>
          )}
        </div>
        {secondaryContext && (
          <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">{secondaryContext}</p>
        )}
      </div>

      {(footerLeft || footerRight) && (
        <div className="pt-2.5 mt-2.5 border-t border-slate-800/80 w-full flex items-center justify-between gap-2 text-[11px] text-slate-500 font-mono tabular-nums">
          <span className="truncate">{footerLeft}</span>
          {footerLeft && footerRight && <span aria-hidden="true">·</span>}
          <span className="truncate text-right">{footerRight}</span>
        </div>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${paddingClass} bg-slate-900 hover:bg-slate-900/95 border border-slate-800 hover:border-slate-700 rounded-xl flex flex-col justify-between text-left transition-colors group cursor-pointer ${DESIGN_TOKENS.colors.border.focus} ${className}`.trim()}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={`${paddingClass} bg-slate-900 border border-slate-800 rounded-xl flex flex-col justify-between ${className}`.trim()}
    >
      {content}
    </div>
  );
};

export interface ContentCardProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  headerRight?: React.ReactNode;
  footer?: React.ReactNode;
  density?: CardDensityVariant;
  children: React.ReactNode;
  className?: string;
}

export const ContentCard: React.FC<ContentCardProps> = ({
  title,
  subtitle,
  headerRight,
  footer,
  density = 'standard',
  children,
  className = '',
}) => {
  const paddingClass = DESIGN_TOKENS.cardPadding[density];
  return (
    <div
      className={`${paddingClass} bg-slate-900 border border-slate-800 rounded-xl flex flex-col justify-between space-y-4 ${className}`.trim()}
    >
      <div className="space-y-4">
        {(title || headerRight) && (
          <div className="flex items-start justify-between gap-4 pb-3.5 border-b border-slate-800">
            <div className="space-y-0.5 min-w-0">
              {title && (
                <h3 className="text-base font-semibold text-slate-100 tracking-tight">{title}</h3>
              )}
              {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
            </div>
            {headerRight && <div className="shrink-0">{headerRight}</div>}
          </div>
        )}
        <div>{children}</div>
      </div>
      {footer && <div className="pt-3 border-t border-slate-800/80">{footer}</div>}
    </div>
  );
};

export interface InsightCardProps {
  title: React.ReactNode;
  summary: React.ReactNode;
  metadata?: React.ReactNode;
  footer?: React.ReactNode;
  actions?: React.ReactNode;
  density?: CardDensityVariant;
  className?: string;
}

export const InsightCard: React.FC<InsightCardProps> = ({
  title,
  summary,
  metadata,
  footer,
  actions,
  density = 'standard',
  className = '',
}) => {
  const paddingClass = DESIGN_TOKENS.cardPadding[density];
  return (
    <div
      className={`${paddingClass} bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl transition-colors flex flex-col justify-between gap-3 ${className}`.trim()}
    >
      <div className="space-y-2">
        {metadata && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
            {metadata}
          </div>
        )}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1 min-w-0 flex-1">
            <h4 className="text-sm font-semibold text-slate-100 leading-snug">{title}</h4>
            <p className="text-xs text-slate-400 leading-relaxed">{summary}</p>
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      </div>
      {footer && (
        <div className="pt-2.5 border-t border-slate-800/80 text-[11px] font-mono tabular-nums text-slate-500 flex flex-wrap items-center justify-between gap-2">
          {footer}
        </div>
      )}
    </div>
  );
};

export interface StatusCardProps {
  title: React.ReactNode;
  statusVariant?: SemanticStatusVariant;
  statusLabel?: string;
  description?: React.ReactNode;
  metrics?: React.ReactNode;
  actions?: React.ReactNode;
  density?: CardDensityVariant;
  className?: string;
}

export const StatusCard: React.FC<StatusCardProps> = ({
  title,
  statusVariant = 'active',
  statusLabel,
  description,
  metrics,
  actions,
  density = 'compact',
  className = '',
}) => {
  const paddingClass = DESIGN_TOKENS.cardPadding[density];
  return (
    <div
      className={`${paddingClass} bg-slate-950/90 border border-slate-800 rounded-xl flex flex-col justify-between gap-3 ${className}`.trim()}
    >
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-200 truncate">{title}</span>
          <SemanticBadge variant={statusVariant} label={statusLabel} />
        </div>
        {description && <p className="text-[11px] text-slate-400 leading-relaxed">{description}</p>}
      </div>
      {(metrics || actions) && (
        <div className="pt-2 border-t border-slate-800/70 space-y-2">
          {metrics && <div className="text-[11px] font-mono tabular-nums text-slate-400">{metrics}</div>}
          {actions && <div className="flex items-center justify-end gap-2">{actions}</div>}
        </div>
      )}
    </div>
  );
};

export interface EmptyStateCardProps {
  title: React.ReactNode;
  description: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  density?: CardDensityVariant;
  className?: string;
}

export const EmptyStateCard: React.FC<EmptyStateCardProps> = ({
  title,
  description,
  icon,
  action,
  density = 'standard',
  className = '',
}) => {
  const pyClass = density === 'compact' ? 'py-6 px-4' : density === 'expanded' ? 'py-12 px-6' : 'py-8 px-5';
  return (
    <div
      className={`${pyClass} bg-slate-900/70 border border-slate-800 rounded-xl text-center flex flex-col items-center justify-center gap-2.5 ${className}`.trim()}
    >
      {icon && <div className="text-slate-500">{icon}</div>}
      <div className="space-y-1 max-w-lg">
        <h4 className="text-sm font-semibold text-slate-200">{title}</h4>
        <p className="text-xs text-slate-400 leading-relaxed">{description}</p>
      </div>
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
};

/* ============================================================================
 * D1. BUTTON SYSTEM
 * ========================================================================== */

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const BUTTON_VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-500/40 shadow-xs',
  secondary:
    'bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700',
  outline:
    'bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-slate-700/90 hover:border-slate-600',
  ghost:
    'bg-transparent hover:bg-slate-800/70 text-slate-300 hover:text-slate-100 border border-transparent',
  destructive:
    'bg-rose-950/60 hover:bg-rose-900/70 text-rose-200 border border-rose-800/70',
  icon:
    'bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-slate-100 border border-slate-800',
};

const BUTTON_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs rounded-lg gap-1.5',
  md: 'px-3 py-1.5 text-xs rounded-lg gap-1.5',
  lg: 'px-4 py-2 text-sm rounded-lg gap-2',
  icon: 'p-2 rounded-lg',
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  disabled,
  children,
  className = '',
  type = 'button',
  ...rest
}) => {
  const sizeClass =
    variant === 'icon'
      ? size === 'sm'
        ? 'p-1.5 rounded-lg'
        : 'p-2 rounded-lg'
      : BUTTON_SIZE_CLASSES[size];

  return (
    <button
      type={type}
      disabled={disabled || isLoading}
      className={`inline-flex items-center justify-center font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${DESIGN_TOKENS.colors.border.focus} ${BUTTON_VARIANT_CLASSES[variant]} ${sizeClass} ${className}`.trim()}
      {...rest}
    >
      {isLoading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
      ) : (
        leftIcon && <span className="shrink-0">{leftIcon}</span>
      )}
      {children && <span>{children}</span>}
      {!isLoading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
    </button>
  );
};

/* ============================================================================
 * D2. FORM & FILTER CONTROLS
 * ========================================================================== */

export interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  containerClassName?: string;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChange,
  placeholder = 'Search...',
  containerClassName = '',
  className = '',
  ...rest
}) => (
  <div className={`relative flex-1 min-w-[200px] ${containerClassName}`.trim()}>
    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
      <Search className="w-3.5 h-3.5" />
    </div>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors ${className}`.trim()}
      {...rest}
    />
  </div>
);

export interface SelectControlProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  containerClassName?: string;
}

export const SelectControl: React.FC<SelectControlProps> = ({
  label,
  containerClassName = '',
  className = '',
  children,
  ...rest
}) => (
  <div className={`inline-flex items-center gap-2 ${containerClassName}`.trim()}>
    {label && (
      <span className="text-xs text-slate-400 font-medium whitespace-nowrap">{label}</span>
    )}
    <select
      className={`px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors ${className}`.trim()}
      {...rest}
    >
      {children}
    </select>
  </div>
);

export interface FilterToolbarProps {
  children: React.ReactNode;
  className?: string;
}

export const FilterToolbar: React.FC<FilterToolbarProps> = ({ children, className = '' }) => (
  <div
    className={`p-3 bg-slate-900/90 border border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs ${className}`.trim()}
  >
    {children}
  </div>
);

export interface SegmentedOption<T extends string> {
  id: T;
  label: React.ReactNode;
  count?: number;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`inline-flex flex-wrap rounded-lg bg-slate-950 p-0.5 border border-slate-800 ${className}`.trim()}
    >
      {options.map((opt) => {
        const isActive = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isActive
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>{opt.label}</span>
            {typeof opt.count === 'number' && (
              <span className="ml-1 font-mono tabular-nums text-[11px] opacity-85">
                ({opt.count})
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================================
 * D3. SEMANTIC BADGE SYSTEM
 * ========================================================================== */

export interface SemanticBadgeProps {
  variant?: SemanticStatusVariant;
  label?: React.ReactNode;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

export const SemanticBadge: React.FC<SemanticBadgeProps> = ({
  variant = 'neutral',
  label,
  children,
  icon,
  className = '',
}) => {
  const spec = SEMANTIC_BADGE_STYLES[variant] || SEMANTIC_BADGE_STYLES.neutral;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${DESIGN_TOKENS.typography.badgeLabel} tabular-nums whitespace-nowrap shrink-0 ${spec.className} ${className}`.trim()}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{children ?? label ?? spec.defaultLabel}</span>
    </span>
  );
};

/* ============================================================================
 * E & F. STANDARDIZED DATA TABLE & CHART CONTAINERS
 * ========================================================================== */

export interface DataTableContainerProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  headerRight?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const DataTableContainer: React.FC<DataTableContainerProps> = ({
  title,
  subtitle,
  headerRight,
  footer,
  children,
  className = '',
}) => (
  <div
    className={`bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col ${className}`.trim()}
  >
    {(title || headerRight) && (
      <div className="px-5 py-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5 min-w-0">
          {title && <h3 className="text-sm font-semibold text-slate-100">{title}</h3>}
          {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
        </div>
        {headerRight && <div className="shrink-0 flex items-center gap-2">{headerRight}</div>}
      </div>
    )}
    <div className="overflow-x-auto w-full">{children}</div>
    {footer && (
      <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/50 text-xs text-slate-400">
        {footer}
      </div>
    )}
  </div>
);

export interface ChartCardProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  reportingPeriod?: React.ReactNode;
  provenance?: React.ReactNode;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const ChartCard: React.FC<ChartCardProps> = ({
  title,
  subtitle,
  reportingPeriod,
  provenance,
  headerRight,
  children,
  className = '',
}) => (
  <div
    className={`p-5 bg-slate-900 border border-slate-800 rounded-xl flex flex-col justify-between space-y-4 ${className}`.trim()}
  >
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-3 border-b border-slate-800">
      <div className="space-y-0.5 min-w-0">
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
        {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {reportingPeriod && (
          <span className="text-[11px] font-mono tabular-nums text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
            {reportingPeriod}
          </span>
        )}
        {headerRight}
      </div>
    </div>
    <div className="min-w-0">{children}</div>
    {provenance && (
      <div className="pt-2.5 border-t border-slate-800/80 text-[11px] font-mono tabular-nums text-slate-500">
        {provenance}
      </div>
    )}
  </div>
);
