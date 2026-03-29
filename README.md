# pi-graphql

A [pi](https://github.com/badlogic/pi-mono) extension that gives the agent schema-aware GraphQL exploration and execution tools for Shopify's Admin API.

Instead of dumping a massive introspection schema into context, the agent **searches incrementally** — discovering types, understanding their structure, then constructing precise queries.

## Tools

| Tool | Description |
|------|-------------|
| `gql_search` | Search the schema for queries, mutations, types, enums, fields by pattern |
| `gql_type` | Get the full definition of a type with fields, args, and inline expansion of referenced enums/inputs |
| `gql_execute` | Execute a GraphQL query or mutation |

### Typical flow

1. Agent uses `gql_search` to find relevant queries/mutations
2. Agent uses `gql_type` to understand argument types and return shapes
3. Agent uses `gql_execute` to run the operation

## Install

### As a pi package

```bash
pi install git:github.com/youruser/pi-graphql
```

### For development

```bash
pi -e ~/path/to/pi-graphql
```

## Configuration

Set environment variables before starting pi:

```bash
export SHOPIFY_STORE=your-store.myshopify.com
export SHOPIFY_CLIENT_ID=your-client-id
export SHOPIFY_CLIENT_SECRET=your-client-secret
```

Or use a `.env` file with [direnv](https://direnv.net/), or source it manually:

```bash
source .env && pi
```

The extension exchanges these credentials for an access token via Shopify's OAuth `client_credentials` flow on first use. The token is cached for the duration of the pi session.

### Optional

```bash
export SHOPIFY_API_VERSION=2026-01  # default
```

### Where to get credentials

1. Go to [Shopify Partners](https://partners.shopify.com/) or your store's admin
2. Create an app
3. Install it on your store
4. Copy the **Client ID** and **Client Secret**

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Test in pi
pi -e ./

# Type check
bunx tsc --noEmit
```

### Project structure

```
src/
├── index.ts      # Pi extension entry (tool registration)
├── types.ts      # All TypeScript types
├── schema.ts     # Introspection fetching, parsing, formatting
├── search.ts     # Schema search logic
└── execute.ts    # Shopify config, token exchange, GraphQL execution
test/
├── helpers.ts    # Test fixtures (builds introspection from SDL)
├── schema.test.ts
├── search.test.ts
└── execute.test.ts
```

Core logic (`schema.ts`, `search.ts`, `execute.ts`) is **pure and testable** — no pi imports. The thin `index.ts` wires them into pi's tool API.

> **Note:** The extension runs inside pi's Node.js runtime. Use standard Web/Node APIs (`fetch`, `node:fs`), not Bun-specific ones.

## License

MIT
