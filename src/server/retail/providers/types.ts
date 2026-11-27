/**
 * Signalyn Retail Price Intelligence - Modular Provider Interface (Phase P0.1)
 * 
 * Defines standard contracts for authorized retailer integrations:
 * - Direct authorized REST API
 * - Official merchant product feed (XML/JSON/CSV)
 * - Approved affiliate network feed
 * - Permitted structured product-page extraction (fail-closed if blocked)
 */

import {
  RetailSourceId,
  RetailerReadinessState,
  RetailAdapterResult,
  RetailSourceStatus,
} from '../../../types/retailPrice';

export interface ProviderIntegrationDetails {
  integrationMethod: string;
  requiredCredentials: string[];
  nextAction: string;
  authRequired: boolean;
  rateLimitRpm: number;
}

export interface RetailDataProvider {
  readonly id: RetailSourceId;
  readonly name: string;
  readonly websiteUrl: string;

  /**
   * Evaluates connectivity, access controls, and executes offer retrieval
   */
  fetchOffer(targetUrl: string, options?: { timeoutMs?: number; simulatedHtml?: string }): Promise<RetailAdapterResult>;

  /**
   * Returns current technical readiness state and documented next steps
   */
  getReadiness(): Promise<{
    status: RetailSourceStatus;
    readinessState: RetailerReadinessState;
    httpStatus?: number;
    error?: string;
    details: ProviderIntegrationDetails;
  }>;
}
