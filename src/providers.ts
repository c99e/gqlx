import type { GqlProvider, LinearConfig, ShopifyConfig } from './types.js';

const DEFAULT_API_VERSION = '2026-01';

// ============================================================
// Shopify config & auth
// ============================================================

export function configFromEnv(
  env: Record<string, string | undefined> = process.env,
): ShopifyConfig {
  const store = env.SHOPIFY_STORE;
  const clientId = env.SHOPIFY_CLIENT_ID;
  const clientSecret = env.SHOPIFY_CLIENT_SECRET;

  if (!store || !clientId || !clientSecret) {
    throw new Error(
      [
        'Missing Shopify configuration. Required environment variables:',
        '',
        '  SHOPIFY_STORE=your-store.myshopify.com',
        '  SHOPIFY_CLIENT_ID=your-client-id',
        '  SHOPIFY_CLIENT_SECRET=your-client-secret',
        '',
        'Optional:',
        `  SHOPIFY_API_VERSION=2026-01  (default)`,
      ].join('\n'),
    );
  }

  return {
    store,
    clientId,
    clientSecret,
    apiVersion: env.SHOPIFY_API_VERSION ?? DEFAULT_API_VERSION,
  };
}

export function getShopifyEndpoint(config: ShopifyConfig): string {
  return `https://${config.store}/admin/api/${config.apiVersion}/graphql.json`;
}

export async function exchangeToken(config: ShopifyConfig): Promise<string> {
  const tokenUrl = `https://${config.store}/admin/oauth/access_token`;
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Shopify token exchange failed: ${res.status} ${res.statusText}${text ? `\n${text.slice(0, 500)}` : ''}`,
    );
  }

  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

export function buildShopifyHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': token,
  };
}

// ============================================================
// Shopify provider
// ============================================================

export class ShopifyProvider implements GqlProvider {
  readonly name = 'shopify';
  private config: ShopifyConfig;
  private cachedToken: string | null = null;

  constructor(env: Record<string, string | undefined> = process.env) {
    this.config = configFromEnv(env);
  }

  getEndpoint(): string {
    return getShopifyEndpoint(this.config);
  }

  async getHeaders(): Promise<Record<string, string>> {
    if (!this.cachedToken) {
      this.cachedToken = await exchangeToken(this.config);
    }
    return buildShopifyHeaders(this.cachedToken);
  }

  reset(): void {
    this.cachedToken = null;
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
// Auto-detection (multi-provider)
// ============================================================

const NO_PROVIDERS_MESSAGE = [
  'No GraphQL provider configured. Set environment variables for one or more of:',
  '',
  'Shopify:',
  '  SHOPIFY_STORE=your-store.myshopify.com',
  '  SHOPIFY_CLIENT_ID=your-client-id',
  '  SHOPIFY_CLIENT_SECRET=your-client-secret',
  '',
  'Linear:',
  '  LINEAR_API_KEY=your-api-key',
].join('\n');

export function detectProviders(
  env: Record<string, string | undefined> = process.env,
): Map<string, GqlProvider> {
  const providers = new Map<string, GqlProvider>();

  const hasShopify = !!(
    env.SHOPIFY_STORE &&
    env.SHOPIFY_CLIENT_ID &&
    env.SHOPIFY_CLIENT_SECRET
  );
  const hasLinear = !!env.LINEAR_API_KEY;

  if (hasShopify) providers.set('shopify', new ShopifyProvider(env));
  if (hasLinear) providers.set('linear', new LinearProvider(env));

  return providers;
}

export function resolveProvider(
  providers: Map<string, GqlProvider>,
  name: string,
): GqlProvider {
  const key = name.toLowerCase();
  const provider = providers.get(key);
  if (provider) return provider;

  if (providers.size === 0) {
    throw new Error(NO_PROVIDERS_MESSAGE);
  }

  const available = Array.from(providers.keys()).join(', ');
  throw new Error(
    `Unknown provider "${name}". Available providers: ${available}`,
  );
}
