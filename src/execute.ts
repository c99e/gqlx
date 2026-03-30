import type {
  ExecuteOptions,
  GqlResponse,
  ShopifyConfig,
  BatchExecuteOptions,
  BatchResult,
  BatchResponse,
} from './types.js';

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

// ============================================================
// Batch execution
// ============================================================

const DEFAULT_CHUNK_SIZE = 50;

/**
 * Parse a GraphQL operation template into its constituent parts.
 * Extracts: operation type, optional name, variable definitions, and body.
 */
function parseOperationTemplate(operation: string): {
  opType: string;
  opName: string;
  varDefs: Array<{ name: string; type: string }>;
  body: string;
} {
  // Match: (mutation|query|subscription) OptionalName($var: Type!, ...) { body }
  const headerRe =
    /^\s*(mutation|query|subscription)\s*([A-Za-z_]\w*)?\s*(?:\(([^)]*)\))?\s*\{/;
  const m = operation.match(headerRe);
  if (!m) {
    throw new Error(
      'Cannot parse operation template. Expected: mutation|query($var: Type) { ... }',
    );
  }

  const opType = m[1];
  const opName = m[2] ?? '';
  const rawVars = m[3] ?? '';

  // Parse variable definitions: "$id: ID!, $input: SomeInput!"
  const varDefs: Array<{ name: string; type: string }> = [];
  if (rawVars.trim()) {
    // Split on commas that are not inside brackets
    const parts = splitVarDefs(rawVars);
    for (const part of parts) {
      const vMatch = part.trim().match(/^\$(\w+)\s*:\s*(.+)$/);
      if (vMatch) {
        varDefs.push({ name: vMatch[1], type: vMatch[2].trim() });
      }
    }
  }

  // Extract body: everything between outermost { }
  const firstBrace = operation.indexOf('{');
  const lastBrace = operation.lastIndexOf('}');
  const body = operation.slice(firstBrace + 1, lastBrace).trim();

  return { opType, opName, varDefs, body };
}

/**
 * Split variable definition string on commas, respecting bracket nesting.
 * e.g. "$id: ID!, $ids: [ID!]!" → ["$id: ID!", "$ids: [ID!]!"]
 */
function splitVarDefs(raw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of raw) {
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/**
 * Rename variable references in a body string.
 * Replaces $name with $name_suffix, ensuring whole-name matching
 * (so $id doesn't clobber $ids).
 */
function renameVarsInBody(
  body: string,
  varNames: string[],
  suffix: number,
): string {
  // Sort by length descending so longer names are replaced first
  const sorted = [...varNames].sort((a, b) => b.length - a.length);
  let result = body;
  for (const name of sorted) {
    // Match $name followed by a non-word character (or end of string)
    const re = new RegExp(`\\$${name}(?=\\W|$)`, 'g');
    result = result.replace(re, `$${name}_${suffix}`);
  }
  return result;
}

/**
 * Build a single aliased GraphQL operation from a template and batch of variable sets.
 */
export function buildAliasedOperation(
  operation: string,
  batchItems: Record<string, unknown>[],
): { query: string; variables: Record<string, unknown> } {
  if (batchItems.length === 0) {
    throw new Error('Batch array must not be empty');
  }

  const { opType, varDefs, body } = parseOperationTemplate(operation);
  const varNames = varDefs.map((v) => v.name);

  const allVarDefs: string[] = [];
  const allFields: string[] = [];
  const allVariables: Record<string, unknown> = {};

  for (let i = 0; i < batchItems.length; i++) {
    // Renamed variable definitions
    for (const vd of varDefs) {
      allVarDefs.push(`$${vd.name}_${i}: ${vd.type}`);
    }

    // Aliased body with renamed variable references
    const renamedBody = renameVarsInBody(body, varNames, i);
    allFields.push(`op_${i}: ${renamedBody}`);

    // Combined variables
    const item = batchItems[i];
    for (const vd of varDefs) {
      allVariables[`${vd.name}_${i}`] = item[vd.name];
    }
  }

  const query = `${opType}(${allVarDefs.join(', ')}) {\n  ${allFields.join('\n  ')}\n}`;
  return { query, variables: allVariables };
}

/**
 * Extract per-item results from an aliased batch response.
 */
export function collectBatchResults(
  response: GqlResponse,
  batchSize: number,
): BatchResult[] {
  const data = response.data as Record<string, unknown> | null | undefined;
  const errors = response.errors ?? [];

  // Classify errors: those with a path starting with op_N go to that item,
  // those without a path (or unresolvable path) go to all items.
  const perItemErrors = new Map<number, Array<{ message: string; [k: string]: unknown }>>();
  const globalErrors: Array<{ message: string; [k: string]: unknown }> = [];

  for (const err of errors) {
    const path = err.path;
    if (path && path.length > 0 && typeof path[0] === 'string') {
      const aliasMatch = (path[0] as string).match(/^op_(\d+)$/);
      if (aliasMatch) {
        const idx = parseInt(aliasMatch[1], 10);
        if (!perItemErrors.has(idx)) perItemErrors.set(idx, []);
        perItemErrors.get(idx)!.push(err as any);
        continue;
      }
    }
    globalErrors.push(err as any);
  }

  const results: BatchResult[] = [];
  for (let i = 0; i < batchSize; i++) {
    const itemData = data ? (data[`op_${i}`] ?? null) : null;
    const itemErrors = [
      ...(perItemErrors.get(i) ?? []),
      ...globalErrors,
    ];
    results.push({
      index: i,
      data: itemData,
      errors: itemErrors.length > 0 ? itemErrors : null,
    });
  }

  return results;
}

/**
 * Execute a batch of operations by constructing aliased operations,
 * chunking large batches, and collecting results.
 */
export async function executeBatch(
  endpoint: string,
  headers: Record<string, string>,
  operation: string,
  batchItems: Record<string, unknown>[],
  options?: BatchExecuteOptions,
): Promise<BatchResponse> {
  const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const results: BatchResult[] = [];
  let chunkCount = 0;

  for (let offset = 0; offset < batchItems.length; offset += chunkSize) {
    const chunk = batchItems.slice(offset, offset + chunkSize);
    const { query, variables } = buildAliasedOperation(operation, chunk);

    const { response } = await executeOperation(
      endpoint,
      headers,
      query,
      variables,
      options,
    );

    const chunkResults = collectBatchResults(response, chunk.length);
    // Re-index results to global batch indices
    for (const r of chunkResults) {
      results.push({ ...r, index: offset + r.index });
    }
    chunkCount++;
  }

  const failed = results.filter((r) => r.errors !== null).length;
  return {
    results,
    summary: {
      total: batchItems.length,
      succeeded: batchItems.length - failed,
      failed,
      chunks: chunkCount,
    },
  };
}
