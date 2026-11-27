import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  seed: vi.fn(),
  catalog: vi.fn(() => new Map()),
  infer: vi.fn(),
  write: vi.fn(() => { throw new Error('Unexpected database mutation'); }),
}));
vi.mock('../src/server/serverFirestoreAdapter', () => ({
  getServerDb: mocks.getDb,
  cleanServerData: (value: unknown) => value,
}));
vi.mock('../src/server/firestoreAdmin', () => ({
  getServerIdentityStatus: () => ({ initialized: true, credentialMode: 'test' }),
  TARGET_PROJECT_ID: 'fixture-project',
  TARGET_DATABASE_ID: 'fixture-database',
}));
vi.mock('../src/server/retail/retailPipelineService', () => ({
  seedPilotCatalog: mocks.seed,
  getMemCatalog: mocks.catalog,
  getMemOffers: () => new Map(),
  getMemPriceHistory: () => new Map(),
  getMemReviews: () => new Map(),
  getMemSources: () => new Map(),
  persistRetailCatalogState: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('K_SERVICE', 'signalyn');
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubGlobal('fetch', mocks.infer.mockRejectedValue(new Error('Network disabled')));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function installDb(rows: Record<string, Record<string, unknown>[]>, failure?: string) {
  const read = vi.fn(async (name: string) => {
    if (failure === '*' || name === failure) throw new Error('Fixture read unavailable');
    const docs = (rows[name] ?? []).map((row) => ({ id: String(row.id), data: () => row }));
    return { docs, size: docs.length, empty: docs.length === 0, forEach: docs.forEach.bind(docs) };
  });
  mocks.getDb.mockReturnValue({
    collection: (name: string) => ({
      get: () => read(name),
      doc: () => ({ set: mocks.write, update: mocks.write, delete: mocks.write }),
      add: mocks.write,
    }),
    batch: mocks.write,
    runTransaction: mocks.write,
  });
  return read;
}

describe('production and zero-traffic revision startup dependencies', () => {
  const advisory = { id: 'adv-1', manufacturer: 'Huawei', title: 'Security advisory', status: 'ACTIVE' };
  const product = { id: 'catalog-1', name: 'Pura 80', brand: 'Huawei' };

  it.each([
    ['populated', { serviceAdvisories: [advisory], retailProducts: [product] }, undefined, true],
    ['empty database', {}, undefined, false],
    ['existing advisories and empty catalog', { serviceAdvisories: [advisory] }, undefined, true],
    ['catalog read failure', { serviceAdvisories: [advisory] }, 'retailProducts', true],
    ['Firestore down', {}, '*', false],
  ] as const)('hydrates %s without mutation or inference', async (_, rows, failure, catalogRead) => {
    const read = installDb(rows as Record<string, Record<string, unknown>[]>, failure);
    const { initializeServiceIntelligence } = await import('../src/server/service/servicePipelineService');
    const { evaluateStartupSchedulerPolicy } = await import('../src/server/schedulerSafetyGate');
    expect(evaluateStartupSchedulerPolicy({ K_SERVICE: 'signalyn', K_REVISION: 'candidate', ENABLE_IN_PROCESS_SCHEDULER: 'true', ENABLE_STARTUP_SERVICE_AUTO_SYNC: 'true' }))
      .toMatchObject({ enableInProcessCollectorTimer: false, enableStartupServiceAutoSync: false });
    await initializeServiceIntelligence();
    expect(read.mock.calls.some(([name]) => name === 'retailProducts')).toBe(catalogRead);
    expect(mocks.seed).not.toHaveBeenCalled();
    expect(mocks.catalog).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.infer).not.toHaveBeenCalled();
  });

  it('fails closed when asked to recompute against an unavailable production catalog', async () => {
    installDb({}, 'retailProducts');
    const { recomputeCatalogMatches } = await import('../src/server/service/servicePipelineService');
    await expect(recomputeCatalogMatches()).rejects.toThrow('catalog read failed');
    expect(mocks.seed).not.toHaveBeenCalled();
  });
});

describe('read-only workspace entry points', () => {
  it.each([undefined, '*'])('returns only count evidence from the Retail diagnostic (%s)', async (failure) => {
    installDb({ retailProducts: [{ id: 'product-1' }] }, failure);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('fixture@example.invalid')));
    const { getPersistenceDiagnostic } = await import('../src/server/retail/retailMigrationService');
    const result = await getPersistenceDiagnostic();
    expect(result.writePermitted).toBeNull();
    expect(result.directFirestoreCounts?.products ?? null).toBe(failure ? null : 1);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('keeps persistence probes and initialization on authorized POST routes', () => {
    const server = readFileSync('server.ts', 'utf8');
    expect(server).toMatch(/app\.get\('\/api\/service\/diagnostic\/persistence'[\s\S]*?getServicePersistenceDiagnostic\(false\)/);
    expect(server).toContain("app.post('/api/service/diagnostic/probe', requireAdminOrAuthorizedClient");
    expect(server).toContain("app.post('/api/retail/persistence/test', requireAdminOrAuthorizedClient");
    expect(server).toContain("app.post('/api/retail/seed', requireAdminOrAuthorizedClient");
    const workspace = readFileSync('src/context/AppContext.tsx', 'utf8');
    expect(workspace.match(/await seedFirestoreIfEmpty\(\)/g)).toHaveLength(1);
    expect(workspace).toMatch(/const resetMockData[\s\S]*?await seedFirestoreIfEmpty\(\)/);
  });
});


describe('production Retail read hydration', () => {
  it.each([
    ['populated', { retailMatchReviews: [{ id: 'review-1', createdAt: '2026-11-27' }] }, undefined, 1],
    ['empty', {}, undefined, 0],
    ['unavailable', {}, 'retailProducts', 0],
  ] as const)('handles a %s catalog without substituting pilot fixtures', async (_, rows, failure, expected) => {
    installDb(rows as Record<string, Record<string, unknown>[]>, failure);
    const { getRetailMatchReviews, getMemCatalog } =
      await vi.importActual<typeof import('../src/server/retail/retailPipelineService')>(
        '../src/server/retail/retailPipelineService',
      );
    if (failure) {
      await expect(getRetailMatchReviews()).rejects.toThrow('Fixture read unavailable');
    } else {
      expect(await getRetailMatchReviews()).toHaveLength(expected);
    }
    expect(getMemCatalog().size).toBe(0);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.infer).not.toHaveBeenCalled();
  });
});

