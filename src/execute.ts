import type { ExecuteOptions, GqlResponse, ShopifyConfig } from './types.js';

const DEFAULT_API_VERSION = '2026-01';

// ============================================================
// Shopify config
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

export function getEndpoint(config: ShopifyConfig): string {
  return `https://${config.store}/admin/api/${config.apiVersion}/graphql.json`;
}

// ============================================================
// Token exchange (client_credentials)
// ============================================================

let cachedToken: string | null = null;

export function resetToken(): void {
  cachedToken = null;
}

export async function getToken(config: ShopifyConfig): Promise<string> {
  if (cachedToken) return cachedToken;

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
  cachedToken = json.access_token;
  return cachedToken;
}

export function buildHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': token,
  };
}

// ============================================================
// Execute GraphQL operations
// ============================================================

const MAX_RESPONSE_SIZE = 50_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeOperation(
  endpoint: string,
  headers: Record<string, string>,
  operation: string,
  variables?: Record<string, unknown>,
  options?: ExecuteOptions,
): Promise<{ response: GqlResponse; truncated: boolean; rawLength: number }> {
  const {
    signal,
    maxRetries = DEFAULT_MAX_RETRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options ?? {};

  const body: Record<string, unknown> = { query: operation };
  if (variables && Object.keys(variables).length > 0) {
    body.variables = variables;
  }
  const bodyStr = JSON.stringify(body);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new Error('Aborted');

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: bodyStr,
        signal: signal ?? AbortSignal.timeout(timeoutMs),
      });
    } catch (err: any) {
      if (err?.name === 'TimeoutError') {
        throw new Error(`Request timed out after ${timeoutMs}ms`);
      }
      throw err;
    }

    if (res.status === 429) {
      if (attempt === maxRetries) {
        const text = await res.text().catch(() => '');
        throw new Error(
          `Rate limited after ${maxRetries + 1} attempts: ${text.slice(0, 500)}`,
        );
      }
      const retryAfter = res.headers.get('Retry-After');
      const waitMs = retryAfter
        ? parseFloat(retryAfter) * 1000
        : Math.min(1000 * 2 ** attempt, 30_000);
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `GraphQL request failed: ${res.status} ${res.statusText}${text ? `\n${text.slice(0, 1000)}` : ''}`,
      );
    }

    const rawText = await res.text();
    const rawLength = rawText.length;
    let truncated = false;

    let responseText = rawText;
    if (rawLength > MAX_RESPONSE_SIZE) {
      responseText = rawText.slice(0, MAX_RESPONSE_SIZE);
      truncated = true;
    }

    let response: GqlResponse;
    try {
      response = JSON.parse(truncated ? rawText : responseText);
    } catch {
      response = {
        data: null,
        errors: [
          {
            message: truncated
              ? `Response too large (${rawLength} bytes). Raw preview:\n${responseText}`
              : `Invalid JSON response:\n${responseText.slice(0, 1000)}`,
          },
        ],
      };
    }

    return { response, truncated, rawLength };
  }

  throw new Error('Unexpected: exhausted retries');
}
