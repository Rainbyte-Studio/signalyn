/**
 * Universal Text and HTML Entity Normalizer for Signalyn Ingestion
 * 
 * Safely decodes HTML entities (hexadecimal, decimal, named), unwraps CDATA,
 * strips HTML markup while preserving meaningful spacing, handles double-encoding,
 * and normalizes Unicode (NFC) while preserving native Greek and multilingual characters.
 * 
 * Client- and server-safe (no Node.js-only imports).
 */

// Comprehensive named HTML entity dictionary (HTML5 + Greek + Typographic)
const NAMED_HTML_ENTITIES: Record<string, string> = {
  // Common standard XML/HTML entities
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',

  // Typographic & Punctuation
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  bull: '•',
  prime: '′',
  Prime: '″',
  lsaquo: '‹',
  rsaquo: '›',
  frasl: '/',
  oline: '‾',

  // Currency & Symbols
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  deg: '°',
  plusmn: '±',
  times: '×',
  divide: '÷',
  micro: 'µ',
  middot: '·',
  para: '¶',
  sect: '§',
  permil: '‰',
  dagger: '†',
  Dagger: '‡',

  // Greek Alphabet (Lower & Upper)
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  omicron: 'ο',
  pi: 'π',
  rho: 'ρ',
  sigmaf: 'ς',
  sigma: 'σ',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Alpha: 'Α',
  Beta: 'Β',
  Gamma: 'Γ',
  Delta: 'Δ',
  Epsilon: 'Ε',
  Zeta: 'Ζ',
  Eta: 'Η',
  Theta: 'Θ',
  Iota: 'Ι',
  Kappa: 'Κ',
  Lambda: 'Λ',
  Mu: 'Μ',
  Nu: 'Ν',
  Xi: 'Ξ',
  Omicron: 'Ο',
  Pi: 'Π',
  Rho: 'Ρ',
  Sigma: 'Σ',
  Tau: 'Τ',
  Upsilon: 'Υ',
  Phi: 'Φ',
  Chi: 'Χ',
  Psi: 'Ψ',
  Omega: 'Ω',
};

// Regex patterns for entity detection and extraction
const HEX_ENTITY_REGEX = /&#[xX]([0-9a-fA-F]{1,6});?/g;
const DEC_ENTITY_REGEX = /&#([0-9]{1,7});?/g;
const NAMED_ENTITY_REGEX = /&([a-zA-Z]{2,10});?/g;
const CDATA_REGEX = /<!\[CDATA\[([\s\S]*?)\]\]>/gi;
const SCRIPT_STYLE_REGEX = /<(?:script|style)\b[^<]*(?:(?!<\/(?:script|style)>)<[^<]*)*<\/(?:script|style)>/gi;
const BLOCK_TAGS_REGEX = /<\/?(?:p|div|br|li|ul|ol|tr|td|th|h[1-6]|hr|header|footer|section|article)\b[^>]*\/?>/gi;
const ALL_TAGS_REGEX = /<[^>]+>/g;

/**
 * Checks if a numeric code point is a valid Unicode scalar value.
 */
function isValidCodePoint(code: number): boolean {
  return (
    Number.isInteger(code) &&
    code >= 0 &&
    code <= 0x10ffff &&
    !(code >= 0xd800 && code <= 0xdfff)
  );
}

/**
 * Performs a single pass of HTML entity decoding.
 */
function decodeHtmlEntitiesSinglePass(text: string): string {
  if (!text.includes('&')) return text;

  let decoded = text;

  // 1. Hexadecimal entities: &#x3A4; or &#X3A4;
  decoded = decoded.replace(HEX_ENTITY_REGEX, (match, hex) => {
    try {
      const code = parseInt(hex, 16);
      if (isValidCodePoint(code)) {
        return String.fromCodePoint(code);
      }
    } catch {
      // ignore
    }
    return match;
  });

  // 2. Decimal entities: &#932; or &#39;
  decoded = decoded.replace(DEC_ENTITY_REGEX, (match, dec) => {
    try {
      const code = parseInt(dec, 10);
      if (isValidCodePoint(code)) {
        return String.fromCodePoint(code);
      }
    } catch {
      // ignore
    }
    return match;
  });

  // 3. Named entities: &quot;, &amp;, &tau;, etc.
  decoded = decoded.replace(NAMED_ENTITY_REGEX, (match, name) => {
    const replacement = NAMED_HTML_ENTITIES[name];
    return replacement !== undefined ? replacement : match;
  });

  return decoded;
}

/**
 * Decodes HTML entities with bounded multi-pass resolution (for nested / double-encoded entities like &amp;#x3A4;)
 * Strictly bounded to maxPasses (default 3) to prevent infinite loops.
 */
export function decodeHtmlEntities(input: string, maxPasses = 3): string {
  if (!input || typeof input !== 'string') return '';
  if (!input.includes('&')) return input;

  let current = input;
  for (let pass = 0; pass < maxPasses; pass++) {
    const next = decodeHtmlEntitiesSinglePass(current);
    if (next === current) break;
    current = next;
    // Early exit if no more ampersands remain
    if (!current.includes('&')) break;
  }

  return current;
}

export interface NormalizeTextOptions {
  maxLength?: number;
  preserveNewlines?: boolean;
}

/**
 * Central text normalization function for Signalyn ingestion.
 * 
 * Pipeline:
 * 1. Unwrap CDATA sections
 * 2. Remove script and style elements
 * 3. Convert block-level tags and line-breaks into spaces/newlines
 * 4. Strip remaining HTML markup
 * 5. Decode HTML entities (named, decimal, hex, double-encoded)
 * 6. Replace non-breaking spaces (\u00A0) with standard spaces
 * 7. Collapse malformed whitespace
 * 8. Unicode NFC normalization (preserving Greek accents and Unicode characters)
 * 9. Optional length boundary enforcement
 */
export function normalizeArticleText(
  input: string | null | undefined,
  options: NormalizeTextOptions = {}
): string {
  if (input === null || input === undefined) return '';
  if (typeof input !== 'string') return String(input);

  let text = input;

  // 1. Unwrap CDATA sections: <![CDATA[ ... ]]>
  if (text.includes('<![CDATA[')) {
    text = text.replace(CDATA_REGEX, '$1');
  }

  // 2. Remove script and style blocks completely
  if (/<(?:script|style)/i.test(text)) {
    text = text.replace(SCRIPT_STYLE_REGEX, '');
  }

  // 3. Convert meaningful block tags and line breaks to spacing
  if (/<[a-zA-Z/]/i.test(text)) {
    const separator = options.preserveNewlines ? '\n' : ' ';
    text = text.replace(BLOCK_TAGS_REGEX, separator);
    // Strip all remaining HTML tags
    text = text.replace(ALL_TAGS_REGEX, '');
  }

  // 4. Decode HTML entities (up to 3 passes for double-encoded entities like &amp;#x3A4;)
  text = decodeHtmlEntities(text, 3);

  // 4b. Clean any malformed truncated entities left over from feed cutoff (e.g. 'ξεκ&#...' or 'τη&#')
  if (text.includes('&#') || /&[a-zA-Z]{0,6}(?:\.\.\.|\u2026|$)/.test(text)) {
    text = text
      .replace(/&#[xX]?[0-9a-fA-F]*(?=\s|\.\.\.|\u2026|$)/g, '')
      .replace(/&(?:[a-zA-Z]{1,8})?(?=\.\.\.|\u2026|$)/g, '');
  }

  // 5. Replace non-breaking spaces and zero-width spaces
  text = text.replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, ' ');

  // 6. Whitespace normalization
  if (options.preserveNewlines) {
    // Normalize newlines, collapse horizontal whitespace on each line
    text = text
      .split('\n')
      .map((line) => line.replace(/[^\S\r\n]+/g, ' ').trim())
      .filter((line, idx, arr) => line.length > 0 || (idx > 0 && arr[idx - 1].length > 0))
      .join('\n')
      .trim();
  } else {
    // Single-line collapse
    text = text.replace(/\s+/g, ' ').trim();
  }

  // 7. Unicode NFC normalization (preserves Greek characters, accents, and punctuation)
  text = text.normalize('NFC');

  // 8. Length bounding if specified
  if (options.maxLength && options.maxLength > 0 && text.length > options.maxLength) {
    text = text.slice(0, options.maxLength).trim();
  }

  return text;
}
