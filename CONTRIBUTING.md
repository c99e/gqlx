# Contributing to gqlx

Thanks for your interest in contributing! This document covers setup, conventions, and how to add new GraphQL providers.

## Setup

```bash
# Clone and install
git clone https://github.com/c99e/gqlx.git
cd gqlx
bun install

# Run tests
bun test

# Type check
bunx tsc --noEmit

# Test in pi (loads the extension from your local checkout)
pi -e ./
```

## Development guidelines

- **Bun** for dev tooling (`bun test`, `bun install`), but **no Bun-specific APIs** in `src/` files. The extension runs inside pi's Node.js runtime via jiti — use `fetch`, `node:fs`, `node:path`, etc.
- **Tests first.** Write failing tests before implementation (red → green → refactor).
- **TypeScript strict mode.** `bunx tsc --noEmit` must pass.
- **Keep tool output token-efficient.** The LLM reads every byte. Prefer compact formats; use verbose/expanded modes as opt-in.

## Pull requests

1. Fork the repo and create a feature branch
2. Make your changes with tests
3. Run `bun test` and `bunx tsc --noEmit` — both must pass
4. Open a PR with a clear description of what and why

## Project structure

```
src/
  index.ts      — Extension entry point, tool registration, TUI renderers
  types.ts      — All TypeScript interfaces (introspection, schema index, providers)
  schema.ts     — Introspection query, fetch, and parsing into SchemaIndex
  search.ts     — Schema search with scoring, filtering, signatures
  format.ts     — SDL formatting, response formatting, result sorting
  execute.ts    — GraphQL execution, retry logic, batch/alias construction
  providers.ts  — Provider abstraction, Shopify + Linear implementations
test/
  helpers.ts    — Test utilities (SDL → introspection helper, shared test schema)
  *.test.ts     — Unit tests per module
```

## Adding a new provider

The extension supports multiple GraphQL APIs through the `GqlProvider` interface. Adding a new one takes three steps:

### 1. Implement the interface

The interface is in `src/types.ts`:

```ts
interface GqlProvider {
  readonly name: string;
  getEndpoint(): string;
  getHeaders(): Promise<Record<string, string>>;
  reset(): void;
}
```

Create a new class in `src/providers.ts`:

```ts
export class ExampleProvider implements GqlProvider {
  readonly name = 'example';
  private config: { apiKey: string };

  constructor(env: Record<string, string | undefined> = process.env) {
    const apiKey = env.EXAMPLE_API_KEY;
    if (!apiKey) {
      throw new Error(
        'Missing Example configuration. Required:\n\n  EXAMPLE_API_KEY=your-api-key'
      );
    }
    this.config = { apiKey };
  }

  getEndpoint(): string {
    return 'https://api.example.com/graphql';
  }

  async getHeaders(): Promise<Record<string, string>> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
    };
  }

  reset(): void {
    // Clear any cached tokens/state. No-op for simple API key auth.
  }
}
```

Key points:
- Accept `env` as a constructor parameter (defaults to `process.env`) so tests can inject values without touching the real environment.
- Throw a helpful error with the exact variable names if config is missing.
- If auth involves token exchange (like Shopify's OAuth), cache the token in an instance field and clear it in `reset()`.

### 2. Register in auto-detection

Update `detectProvider()` in `src/providers.ts` to check for your provider's env vars:

```ts
export function detectProvider(env = process.env): GqlProvider {
  // ... existing checks ...

  const hasExample = !!env.EXAMPLE_API_KEY;

  if (hasShopify) return new ShopifyProvider(env);
  if (hasLinear) return new LinearProvider(env);
  if (hasExample) return new ExampleProvider(env);  // add here

  throw new Error(
    // ... update the error message to list the new provider ...
  );
}
```

Order matters — the first matching provider wins when multiple sets of env vars are present.

### 3. Add tests

Add tests to `test/providers.test.ts` following the existing pattern:

```ts
describe('ExampleProvider', () => {
  test('throws when EXAMPLE_API_KEY is missing', () => {
    expect(() => new ExampleProvider({})).toThrow('EXAMPLE_API_KEY');
  });

  test('returns correct endpoint', () => {
    const p = new ExampleProvider({ EXAMPLE_API_KEY: 'key' });
    expect(p.getEndpoint()).toBe('https://api.example.com/graphql');
  });

  test('getHeaders includes auth', async () => {
    const p = new ExampleProvider({ EXAMPLE_API_KEY: 'key' });
    const h = await p.getHeaders();
    expect(h['Authorization']).toBe('Bearer key');
  });
});
```

Also update the `detectProvider` tests to cover the new provider.

### 4. Document

Update the README:
- Add a configuration section with the required env vars
- Update `.env.example` with commented-out example values
- Add to the "no provider detected" error message in `detectProvider()`
