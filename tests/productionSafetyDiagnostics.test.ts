import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { aiIntelligenceService } from '../src/services/aiIntelligenceService';
import { DELETION_SAFETY_ROUTES } from '../src/types/productionSafetyDiagnostics';

vi.mock('../src/services/apiSessionClient', () => ({
  getAuthorizedApiHeaders: async () => ({ Authorization: 'Bearer fixture', 'Content-Type': 'application/json' }),
}));

const backend = {
  environment: { permanentDeletionEnabled: false },
  release: { appVersion: 'fixture', sourceFingerprint: 'src-fixture' },
  transaction: { status: 'PASS', stage: 'complete', cleanupVerified: true },
};

afterEach(() => vi.unstubAllGlobals());

describe('Production safety diagnostics', () => {
  it('sends exactly the unconfirmed body to both endpoints using the existing session', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(backend))
      .mockImplementation(async () => Response.json({ code: 'PERMANENT_ARTICLE_DELETION_DISABLED' }, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const report = await aiIntelligenceService.runProductionSafetyChecks();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/admin/production-safety-diagnostics', ...DELETION_SAFETY_ROUTES,
    ]);
    for (const [, options] of fetchMock.mock.calls.slice(1)) {
      expect(options).toMatchObject({
        method: 'POST', body: '{"dryRun":false}', redirect: 'error',
        headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
      });
    }
    expect(report.deletion.map(({ status, httpStatus }) => [status, httpStatus])).toEqual([['PASS', 503], ['PASS', 503]]);
    expect(JSON.stringify(report)).not.toContain('Bearer');
  });

  it('distinguishes unexpected safeguards from an unauthorized response', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json(backend))
      .mockResolvedValueOnce(Response.json({ code: 'OTHER' }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({}, { status: 403 })));
    const report = await aiIntelligenceService.runProductionSafetyChecks();
    expect(report.deletion.map(({ status }) => status)).toEqual(['FAIL', 'UNVERIFIED']);
  });

  it.each([401, 403, 429])('does not probe the deletion endpoints after HTTP %s', async (httpStatus) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({}, { status: httpStatus }));
    vi.stubGlobal('fetch', fetchMock);
    const report = await aiIntelligenceService.runProductionSafetyChecks();
    expect(report.deletion.every(({ status }) => status === 'UNVERIFIED')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a PASS response did not verify cleanup', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({
      ...backend, transaction: { ...backend.transaction, cleanupVerified: false },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(aiIntelligenceService.runProductionSafetyChecks()).rejects.toThrow('Unexpected safety diagnostic response');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mounts the probe on the strict Firebase admin route with an additional UID rate limit', () => {
    const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
    expect(server).toContain("app.post('/api/admin/production-safety-diagnostics', requireStrictAdminUser,");
    expect(server).toContain("checkRateLimit('production-safety:' + uid, 1, 60_000)");
  });
});
