/**
 * Signalyn Retail Price Intelligence - Parser & Normalization Utilities
 * 
 * Safe normalization for:
 * 1. Greek currency & price strings to integer EUR cents.
 * 2. Strict non-zero price validation (failures are never €0).
 * 3. Schema.org / JSON-LD Product & Offer extraction.
 * 4. Robots.txt compliance check.
 */

/**
 * Normalizes any Greek or international price representation into integer EUR cents.
 * Returns null if missing, zero, or unparseable.
 * 
 * Examples:
 * - "1.099,00 €" -> 109900
 * - "1099,00"    -> 109900
 * - "1,099.00"   -> 109900
 * - "449 €"      -> 44900
 * - 449.99       -> 44999
 * - 0 or "0 €"   -> null (Zero prices are strictly treated as missing data)
 */
export function parsePriceToCents(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === 'number') {
    if (isNaN(raw) || raw <= 0) return null;
    return Math.round(raw * 100);
  }

  const clean = raw.trim();
  if (!clean) return null;

  // Remove currency signs, letters, and non-numeric punctuation except comma and period
  // e.g., "1.099,00 €" -> "1.099,00"
  const stripped = clean.replace(/[^0-9.,]/g, '').trim();
  if (!stripped) return null;

  let normalized = stripped;

  // Detect European notation: "1.099,00" (thousands dot, decimal comma)
  if (stripped.includes('.') && stripped.includes(',')) {
    if (stripped.indexOf('.') < stripped.indexOf(',')) {
      // 1.099,00 -> remove dot, replace comma with dot -> 1099.00
      normalized = stripped.replace(/\./g, '').replace(',', '.');
    } else {
      // 1,099.00 -> remove comma -> 1099.00
      normalized = stripped.replace(/,/g, '');
    }
  } else if (stripped.includes(',')) {
    // "1099,00" or "449,50" -> 1099.00
    normalized = stripped.replace(',', '.');
  } else if (stripped.includes('.')) {
    // Check if it's thousands separator without decimals (e.g. "1.099")
    const parts = stripped.split('.');
    if (parts.length === 2 && parts[1].length === 3) {
      // Likely "1.099" meaning €1,099.00
      normalized = parts[0] + parts[1];
    }
  }

  const parsedFloat = parseFloat(normalized);
  if (isNaN(parsedFloat) || parsedFloat <= 0) {
    return null; // Zero or negative is invalid
  }

  const cents = Math.round(parsedFloat * 100);
  return cents > 0 ? cents : null;
}

/**
 * Extracts JSON-LD schema.org Product structures from HTML body.
 * Supports:
 * - Direct @type: "Product"
 * - Arrays of Products
 * - @graph containers
 * - Category listing @type: "ItemList" with itemListElement containing ListItem (item: Product) or direct Product
 */
export function extractJsonLdProducts(html: string): Array<Record<string, unknown>> {
  const products: Array<Record<string, unknown>> = [];
  const scriptRegex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  function collectFromNode(node: unknown): void {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (const item of node) {
        collectFromNode(item);
      }
      return;
    }

    const obj = node as Record<string, unknown>;
    const rawType = obj['@type'];
    const types = Array.isArray(rawType) ? rawType.map(String) : [String(rawType || '')];

    const isProduct = types.some((t) => t === 'Product' || t === 'http://schema.org/Product' || t === 'https://schema.org/Product');

    if (isProduct) {
      products.push(obj);
      return;
    }

    const isItemList = types.some((t) => t === 'ItemList' || t === 'http://schema.org/ItemList' || t === 'https://schema.org/ItemList');

    if (isItemList) {
      const elements = obj['itemListElement'];
      if (Array.isArray(elements)) {
        for (const el of elements) {
          if (!el || typeof el !== 'object') continue;
          const elObj = el as Record<string, unknown>;
          if (elObj['item'] && typeof elObj['item'] === 'object') {
            collectFromNode(elObj['item']);
          } else {
            collectFromNode(elObj);
          }
        }
      }
    }

    if (Array.isArray(obj['@graph'])) {
      collectFromNode(obj['@graph']);
    }
  }

  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const content = match[1].trim();
      const parsed = JSON.parse(content);
      collectFromNode(parsed);
    } catch {
      // Ignore unparseable JSON-LD blocks
    }
  }

  return products;
}

/**
 * Parses OpenGraph and Meta tags from HTML
 */
export function extractMetaTags(html: string): Record<string, string> {
  const metaTags: Record<string, string> = {};
  const metaRegex = /<meta\b[^>]*?(?:name|property)=["']([^"']+)["'][^>]*?content=["']([^"']*)["'][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = metaRegex.exec(html)) !== null) {
    const key = match[1].toLowerCase();
    const val = match[2];
    metaTags[key] = val;
  }

  // Also support reverse attribute ordering: content before property/name
  const metaRegexRev = /<meta\b[^>]*?content=["']([^"']*)["'][^>]*?(?:name|property)=["']([^"']+)["'][^>]*>/gi;
  while ((match = metaRegexRev.exec(html)) !== null) {
    const val = match[1];
    const key = match[2].toLowerCase();
    if (!metaTags[key]) {
      metaTags[key] = val;
    }
  }

  return metaTags;
}
