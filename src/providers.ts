import type { GqlProvider, LinearConfig, ShopifyConfig } from './types.js';
import {
  configFromEnv,
  getEndpoint as shopifyGetEndpoint,
  getToken,
  buildHeaders as shopifyBuildHeaders,
  resetToken,
} from './execute.js';

// ============================================================
// Shopify provider
// ============================================================

export class ShopifyProvider implements GqlProvider {
  readonly name = 'shopify';
  private config: ShopifyConfig;

  constructor(env: Record<string, string | undefined> = process.env) {
    this.config = configFromEnv(env);
  }

  getEndpoint(): string {
    return shopifyGetEndpoint(this.config);
  }

  async getHeaders(): Promise<Record<string, string>> {
    const token = await getToken(this.config);
    return shopifyBuildHeaders(token);
  }

  reset(): void {
    resetToken();
  }
}

// ============================================================
// Linear provider
// ============================================================

export class LinearProvider implements GqlProvider {
  readonly name = 'linear';
  private config: LinearConfig;

  constructor(env: Record<string, string | undefined> = process.env) {
    const apiKey = env.LINEAR_API_KEY;
    if (!apiKey) {
      throw new Error(
        [
          'Missing Linear configuration. Required environment variable:',
          '',
          '  LINEAR_API_KEY=your-api-key',
        ].join('\n'),
      );
    }
    this.config = { apiKey };
  }

  getEndpoint(): string {
    return 'https://api.linear.app/graphql';
  }

  async getHeaders(): Promise<Record<string, string>> {
    return {
      'Content-Type': 'application/json',
      Authorization: this.config.apiKey,
    };
  }

  reset(): void {
    // No cached state for API key auth
  }
}

// ============================================================
// Auto-detection
// ============================================================

export function detectProvider(
  env: Record<string, string | undefined> = process.env,
): GqlProvider {
  const hasShopify = !!(
    env.SHOPIFY_STORE &&
    env.SHOPIFY_CLIENT_ID &&
    env.SHOPIFY_CLIENT_SECRET
  );
  const hasLinear = !!env.LINEAR_API_KEY;

  if (hasShopify) return new ShopifyProvider(env);
  if (hasLinear) return new LinearProvider(env);

  throw new Error(
    [
      'No GraphQL provider detected. Set environment variables for one of:',
      '',
      'Shopify:',
      '  SHOPIFY_STORE=your-store.myshopify.com',
      '  SHOPIFY_CLIENT_ID=your-client-id',
      '  SHOPIFY_CLIENT_SECRET=your-client-secret',
      '',
      'Linear:',
      '  LINEAR_API_KEY=your-api-key',
    ].join('\n'),
  );
}
