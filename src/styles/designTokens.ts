/**
 * Signalyn UI P2.1 — Centralized Design System Tokens
 *
 * Defines the canonical color tokens, spacing scale (4px base unit),
 * border radius tokens, typography scale, card density variants,
 * button variants, and semantic badge definitions used across all modules.
 */

export const DESIGN_TOKENS = {
  colors: {
    background: {
      app: 'bg-slate-950',
      surfacePrimary: 'bg-slate-900',
      surfaceElevated: 'bg-slate-800/90',
      surfaceSubtle: 'bg-slate-900/60',
      surfaceInteractiveHover: 'hover:bg-slate-800/80',
    },
    text: {
      primary: 'text-slate-100',
      secondary: 'text-slate-300',
      muted: 'text-slate-400',
      disabled: 'text-slate-500',
    },
    border: {
      default: 'border-slate-800',
      subtle: 'border-slate-800/80',
      strong: 'border-slate-700',
      focus: 'focus-visible:ring-2 focus-visible:ring-indigo-500/80 focus-visible:outline-none',
    },
    semantic: {
      primaryAction: {
        bg: 'bg-indigo-600 hover:bg-indigo-500',
        text: 'text-indigo-400',
        border: 'border-indigo-500/40',
        subtleBg: 'bg-indigo-500/10',
      },
      verifiedSuccess: {
        bg: 'bg-emerald-600 hover:bg-emerald-500',
        text: 'text-emerald-400',
        border: 'border-emerald-500/30',
        subtleBg: 'bg-emerald-500/10',
      },
      warningReview: {
        bg: 'bg-amber-600 hover:bg-amber-500',
        text: 'text-amber-300',
        border: 'border-amber-500/30',
        subtleBg: 'bg-amber-500/10',
      },
      criticalError: {
        bg: 'bg-rose-600 hover:bg-rose-500',
        text: 'text-rose-400',
        border: 'border-rose-500/30',
        subtleBg: 'bg-rose-500/10',
      },
      informationalLikely: {
        bg: 'bg-sky-600 hover:bg-sky-500',
        text: 'text-sky-400',
        border: 'border-sky-500/30',
        subtleBg: 'bg-sky-500/10',
      },
      neutralInactive: {
        bg: 'bg-slate-800 hover:bg-slate-700',
        text: 'text-slate-400',
        border: 'border-slate-700',
        subtleBg: 'bg-slate-800/70',
      },
    },
  },

  /**
   * 4px Spacing Scale
   */
  spacingScalePx: {
    4: '1',   // 4px  (0.25rem)
    8: '2',   // 8px  (0.5rem)
    12: '3',  // 12px (0.75rem)
    16: '4',  // 16px (1rem)
    20: '5',  // 20px (1.25rem)
    24: '6',  // 24px (1.5rem)
    32: '8',  // 32px (2rem)
    40: '10', // 40px (2.5rem)
    48: '12', // 48px (3rem)
  },

  /**
   * Standardized Border Radius Tokens
   */
  radius: {
    badge: 'rounded',          // 4px-6px for compact semantic badges
    control: 'rounded-lg',     // 8px for buttons, inputs, selects
    card: 'rounded-xl',        // 12px for standard cards, panels, tables
    modal: 'rounded-2xl',      // 16px for dialogs and elevated overlays
  },

  /**
   * Standardized Typography Scale
   */
  typography: {
    pageTitle: 'text-xl sm:text-2xl font-bold text-slate-100 tracking-tight',
    sectionHeader: 'text-base font-semibold text-slate-100 tracking-tight',
    cardTitle: 'text-sm font-semibold text-slate-100 tracking-tight',
    kpiDisplayLarge: 'text-2xl md:text-3xl font-bold font-mono tabular-nums tracking-tight',
    kpiDisplayMedium: 'text-xl md:text-2xl font-bold font-mono tabular-nums tracking-tight',
    bodyPrimary: 'text-sm text-slate-200 leading-relaxed',
    bodySecondary: 'text-xs text-slate-400 leading-relaxed',
    tableHeader: 'text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-400',
    tableCell: 'text-xs text-slate-200',
    tableCellNumeric: 'text-xs font-mono tabular-nums text-slate-200 text-right',
    captionMetadata: 'text-[11px] font-mono tabular-nums text-slate-400',
    badgeLabel: 'text-[10px] font-mono font-semibold uppercase tracking-wider',
  },

  /**
   * Card Density Variants
   */
  cardPadding: {
    compact: 'p-3.5',
    standard: 'p-5',
    expanded: 'p-6',
  },

  /**
   * Table Row Density Modes
   */
  tableDensity: {
    compact: 'px-3 py-2 text-xs',
    comfortable: 'px-4 py-3 text-xs',
  },

  /**
   * Global Header Specification Tokens (UI P2.2.1)
   */
  header: {
    height: 'h-16 min-h-[64px] max-h-[64px] shrink-0',
    container:
      'h-16 min-h-[64px] max-h-[64px] shrink-0 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/80 px-4 md:px-6 flex items-center justify-between gap-3 sticky top-0 z-30',
    title: 'text-[15px] font-semibold text-slate-100 tracking-tight leading-tight truncate',
    subtitle: 'text-[11px] font-mono tabular-nums text-slate-400 leading-tight truncate hidden sm:block',
    controlHeight: 'h-8',
  },
} as const;

export type CardDensityVariant = keyof typeof DESIGN_TOKENS.cardPadding;

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'destructive'
  | 'icon';

export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export type SemanticStatusVariant =
  | 'verified'
  | 'likely'
  | 'review'
  | 'pending'
  | 'active'
  | 'unavailable'
  | 'error'
  | 'info'
  | 'neutral';

export const SEMANTIC_BADGE_STYLES: Record<
  SemanticStatusVariant,
  { defaultLabel: string; className: string }
> = {
  verified: {
    defaultLabel: 'Verified',
    className: 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30',
  },
  likely: {
    defaultLabel: 'Likely',
    className: 'bg-sky-500/10 text-sky-300 border border-sky-500/30',
  },
  review: {
    defaultLabel: 'Requires Review',
    className: 'bg-amber-500/10 text-amber-300 border border-amber-500/30',
  },
  pending: {
    defaultLabel: 'Pending',
    className: 'bg-amber-500/10 text-amber-300 border border-amber-500/30',
  },
  active: {
    defaultLabel: 'Active',
    className: 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30',
  },
  unavailable: {
    defaultLabel: 'Unavailable',
    className: 'bg-slate-800/90 text-slate-400 border border-slate-700',
  },
  error: {
    defaultLabel: 'Error',
    className: 'bg-rose-500/10 text-rose-300 border border-rose-500/30',
  },
  info: {
    defaultLabel: 'Info',
    className: 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/30',
  },
  neutral: {
    defaultLabel: 'Neutral',
    className: 'bg-slate-800/80 text-slate-300 border border-slate-700/80',
  },
};
