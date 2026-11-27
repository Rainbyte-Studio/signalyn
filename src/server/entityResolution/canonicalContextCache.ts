import { getServerDb } from '../serverFirestoreAdapter';
import { Company, Product, IntelligenceSettings } from '../../types';
import {
  CANONICAL_COMPANIES_REGISTRY,
  CANONICAL_PRODUCTS_REGISTRY,
  getMergedCanonicalCompanies,
  getMergedCanonicalProducts,
} from '../../services/canonicalEntities';
import { INITIAL_SETTINGS } from '../../repositories/mock/initialData';

export interface CanonicalContext {
  companies: Company[];
  products: Product[];
  settings: IntelligenceSettings;
  canonicalCompanies: Company[];
  canonicalProducts: Product[];
  loadedAt: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL maximum

let cachedContext: CanonicalContext | null = null;
let inflightPromise: Promise<CanonicalContext> | null = null;

/**
 * Returns the cached server-side canonical intelligence context.
 * If expired or uninitialized, loads companies, products, and settings from Firestore once.
 */
export async function getCanonicalContext(options?: {
  forceRefresh?: boolean;
}): Promise<CanonicalContext> {
  const now = Date.now();

  if (
    !options?.forceRefresh &&
    cachedContext &&
    now - cachedContext.loadedAt < CACHE_TTL_MS
  ) {
    return cachedContext;
  }

  // Deduplicate concurrent loads
  if (inflightPromise && !options?.forceRefresh) {
    return inflightPromise;
  }

  inflightPromise = (async () => {
    try {
      const db = getServerDb();
      const [companiesSnap, productsSnap, settingsSnap] = await Promise.all([
        db.collection('companies').get(),
        db.collection('products').get(),
        db.collection('settings').doc('intelligence').get(),
      ]);

      const firestoreCompanies = companiesSnap.docs.map(
        (d) => ({ id: d.id, ...d.data() } as Company)
      );
      const firestoreProducts = productsSnap.docs.map(
        (d) => ({ id: d.id, ...d.data() } as Product)
      );

      const isSettingsDocExists = typeof settingsSnap.exists === 'function'
        ? (settingsSnap as any).exists()
        : Boolean(settingsSnap.exists);

      const settings: IntelligenceSettings = isSettingsDocExists
        ? (settingsSnap.data() as IntelligenceSettings)
        : INITIAL_SETTINGS;

      const canonicalCompanies = getMergedCanonicalCompanies(firestoreCompanies);
      const canonicalProducts = getMergedCanonicalProducts(firestoreProducts);

      cachedContext = {
        companies: firestoreCompanies,
        products: firestoreProducts,
        settings,
        canonicalCompanies,
        canonicalProducts,
        loadedAt: Date.now(),
      };

      return cachedContext;
    } catch (err) {
      console.warn('[CanonicalContextCache] Failed to load from Firestore, falling back to static registry:', err);
      // Safe cold-start fallback
      return {
        companies: [],
        products: [],
        settings: INITIAL_SETTINGS,
        canonicalCompanies: CANONICAL_COMPANIES_REGISTRY,
        canonicalProducts: CANONICAL_PRODUCTS_REGISTRY,
        loadedAt: Date.now(),
      };
    } finally {
      inflightPromise = null;
    }
  })();

  return inflightPromise;
}

/**
 * Explicitly invalidates the canonical context cache.
 * Must be invoked whenever:
 * - A Company or Product is promoted from EntityReview
 * - Settings are updated
 * - Companies or Products are created/updated
 */
export function invalidateCanonicalContextCache(): void {
  cachedContext = null;
  inflightPromise = null;
}
