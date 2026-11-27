/**
 * Signalyn Retail Price Intelligence - Crawler Driver (Phase P1.0)
 * 
 * Legitimate, modular driver supporting:
 * Strategy A: Static HTML extraction using native Node.js 22 fetch + Cheerio.
 * Strategy B: Headless browser automation driver abstraction (Playwright compatible interface).
 * 
 * Strict Compliance:
 * - Does not attempt WAF evasion, CAPTCHA bypass, or fingerprint spoofing.
 * - Stops immediately on HTTP 401/403 (Perimeter access denial).
 * - Enforces server-side IPv4 result order to avoid Akamai IPv6 misrouting.
 * - Enforces polite request delays between pages to respect retailer infrastructure.
 */

import dns from 'dns';
import { RetailCrawlerStrategy } from '../../../types/retailPrice';
import { PLAISIO_REQUEST_HEADERS } from '../plaisioAdapter';

// Ensure IPv4 first DNS order for Node 22 runtime
try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  // Graceful fallback
}

export interface FetchPageResult {
  html?: string;
  httpStatus: number;
  serverHeader: string;
  durationMs: number;
  isTerminalBlocked: boolean;
  error?: string;
}

export class CrawlerDriver {
  /**
   * Fetches a category page using the selected legitimate strategy.
   * In AUTO mode, starts with static HTTP fetch first and never uses browser automation to bypass 401/403 blocks.
   */
  public static async fetchPage(
    url: string,
    strategy: RetailCrawlerStrategy = 'AUTO',
    timeoutSeconds = 12
  ): Promise<FetchPageResult> {
    const startTime = Date.now();

    if (strategy === 'BROWSER_AUTOMATION') {
      return this.fetchWithBrowser(url, timeoutSeconds, startTime);
    }

    return this.fetchWithStatic(url, timeoutSeconds, startTime);
  }

  /**
   * Attempts headless Playwright rendering only when permitted (never after 401/403)
   * and only if Playwright + Chromium are available in the runtime environment.
   */
  public static async tryBrowserRender(
    url: string,
    timeoutSeconds = 12
  ): Promise<FetchPageResult | null> {
    const startTime = Date.now();
    try {
      const pkgName = 'playwright';
      const playwright = await import(/* @vite-ignore */ pkgName).catch(() => null);
      if (!playwright || !(playwright as any).chromium) {
        return null;
      }
      return await this.fetchWithBrowser(url, timeoutSeconds, startTime);
    } catch {
      return null;
    }
  }

  /**
   * Strategy A: Native Node.js fetch with modern navigation headers.
   */
  private static async fetchWithStatic(
    url: string,
    timeoutSeconds: number,
    startTime: number
  ): Promise<FetchPageResult> {
    const controller = new AbortController();
    const timeoutMs = timeoutSeconds * 1000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: PLAISIO_REQUEST_HEADERS,
        redirect: 'follow',
      });

      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      const serverHeader = res.headers.get('server') || 'Unknown';

      // Immediate terminal stop on perimeter/WAF blocks
      if (res.status === 403 || res.status === 401) {
        return {
          httpStatus: res.status,
          serverHeader,
          durationMs,
          isTerminalBlocked: true,
          error: `Access Denied by perimeter edge (${serverHeader}) with HTTP ${res.status}. Data center IP blocked or requires merchant authorization.`,
        };
      }

      if (!res.ok) {
        return {
          httpStatus: res.status,
          serverHeader,
          durationMs,
          isTerminalBlocked: false,
          error: `HTTP Error ${res.status}: ${res.statusText}`,
        };
      }

      const html = await res.text();
      return {
        html,
        httpStatus: res.status,
        serverHeader,
        durationMs,
        isTerminalBlocked: false,
      };
    } catch (err: unknown) {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);
      return {
        httpStatus: 0,
        serverHeader: 'None',
        durationMs,
        isTerminalBlocked: false,
        error: `Network/Fetch error: ${message}`,
      };
    }
  }

  /**
   * Strategy B: Headless Browser Driver abstraction.
   * Note: In Cloud Run production environments without installed Chromium,
   * falls back safely to static fetch without failing the pipeline.
   * Does NOT attempt WAF bypass or stealth fingerprinting.
   */
  private static async fetchWithBrowser(
    url: string,
    timeoutSeconds: number,
    startTime: number
  ): Promise<FetchPageResult> {
    // If Playwright is not natively installed in the container, delegate gracefully to static fetch
    try {
      // Dynamic import to avoid hard dependency crash if Playwright is absent
      const pkgName = 'playwright';
      const playwright = await import(/* @vite-ignore */ pkgName).catch(() => null);
      if (!playwright) {
        // Fall back gracefully to static fetch
        return this.fetchWithStatic(url, timeoutSeconds, startTime);
      }

      const browser = await (playwright as any).chromium.launch({ headless: true });
      const context = await browser.newContext({
        userAgent: PLAISIO_REQUEST_HEADERS['User-Agent'],
      });
      const page = await context.newPage();

      let httpStatus = 200;
      let serverHeader = 'Browser';

      const response = await page.goto(url, {
        timeout: timeoutSeconds * 1000,
        waitUntil: 'domcontentloaded',
      });

      if (response) {
        httpStatus = response.status();
        const headers = response.headers();
        serverHeader = headers['server'] || 'Browser';
      }

      if (httpStatus === 403 || httpStatus === 401) {
        await browser.close();
        return {
          httpStatus,
          serverHeader,
          durationMs: Date.now() - startTime,
          isTerminalBlocked: true,
          error: `Browser navigation returned HTTP ${httpStatus} (${serverHeader}). Perimeter access restricted.`,
        };
      }

      const html = await page.content();
      await browser.close();

      return {
        html,
        httpStatus,
        serverHeader,
        durationMs: Date.now() - startTime,
        isTerminalBlocked: false,
      };
    } catch (err: unknown) {
      // Fall back to static fetch on browser runtime error
      console.warn('[CrawlerDriver] Browser automation unavailable, falling back to static fetch:', err instanceof Error ? err.message : String(err));
      return this.fetchWithStatic(url, timeoutSeconds, startTime);
    }
  }

  /**
   * Polite request delay between category page fetches
   */
  public static async delay(seconds: number): Promise<void> {
    if (seconds <= 0) return;
    const ms = Math.min(seconds * 1000, 15000); // capped at 15s safety limit
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
