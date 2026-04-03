# [gqlx](https://github.com/c99e/gqlx)

A [pi](https://github.com/badlogic/pi-mono) extension that gives the agent schema-aware GraphQL exploration and execution tools.

Instead of dumping a massive introspection schema into context, the agent **searches incrementally** — discovering types, understanding their structure, then constructing precise queries.

Supports multiple GraphQL providers out of the box:
- **Shopify** Admin API (OAuth client credentials)
- **Linear** API (API key)

## Tools

| Tool | Description |
|------|-------------|
| `gql_search` | Search the schema for queries, mutations, types, enums, and fields by pattern |
| `gql_type` | Get the full definition of a type — compact or verbose, with optional field filtering and inline expansion of referenced enums/inputs |
| `gql_execute` | Execute a single GraphQL query/mutation, or batch many operations in one call |

### Typical flow

1. Agent uses `gql_search` to find relevant queries/mutations
2. Agent uses `gql_type` to understand argument types and return shapes
3. Agent uses `gql_execute` to run the operation

## Install

### As a pi package

```bash
pi install git:github.com/c99e/gqlx
```

### For development

```bash
pi -e ~/path/to/gqlx
```

## Configuration

The extension auto-detects all configured providers from environment variables. Configure one or more of the following:

### Shopify

```bash
export SHOPIFY_STORE=your-store.myshopify.com
export SHOPIFY_CLIENT_ID=your-client-id
export SHOPIFY_CLIENT_SECRET=your-client-secret

# Optional
export SHOPIFY_API_VERSION=2026-01  # default
```

The extension exchanges these credentials for an access token via Shopify's OAuth `client_credentials` flow on first use. The token is cached for the duration of the pi session.

**Where to get credentials:**
1. Go to [Shopify Partners](https://partners.shopify.com/) or your store's admin
2. Create an app and install it on your store
3. Copy the **Client ID** and **Client Secret**

### Linear

```bash
export LINEAR_API_KEY=your-api-key
```

**Where to get an API key:** Go to [Linear Settings → API](https://linear.app/settings/api) and create a personal API key.

### Loading credentials

The extension loads `.env` from the working directory automatically on session start. Alternatively, use [direnv](https://direnv.net/) or source it before launching:

```bash
source .env && pi
```

## Tool Reference

### `gql_search`

Search the GraphQL schema for queries, mutations, types, inputs, enums, and fields.

| Parameter | Type | Description |
|-----------|------|-------------|
| `provider` | `string` | Provider name (e.g. `"shopify"`, `"linear"`) |
| `pattern` | `string` | Search term (case-insensitive substring) or `"*"` to list all |
| `kind` | `string?` | Filter by kind: `query`, `mutation`, `subscription`, `type`, `input`, `enum`, `scalar`, `union`, `interface`, or `all` (default) |
| `limit` | `number?` | Max results (default 25, max 100). When `kind` is `all`, applied per category so no single kind dominates |

**Features:**
- Searches type names, field names, descriptions, and **enum values** (e.g., searching `"EUR"` finds `CurrencyCode.EUR`)
- Results include compact signatures: field counts for types, value previews for enums, required-field counts for inputs
- When `kind` is `all`, the limit applies **per category** so no single kind dominates results

### `gql_type`

Get the full definition of a GraphQL type with fields, arguments, and referenced types.

| Parameter | Type | Description |
|-----------|------|-------------|
| `provider` | `string` | Provider name (e.g. `"shopify"`, `"linear"`) |
| `name` | `string` | Exact type name (case-sensitive) |
| `verbose` | `boolean?` | Include descriptions on types and fields (default `false`) |
| `pattern` | `string?` | Filter fields by case-insensitive substring match on field name, type, or argument names |

**Features:**
- **Compact mode** (default): shows field names and types only — minimal tokens
- **Verbose mode**: adds `# description` comments on the type and each field
- **Pattern filter**: show only fields matching a substring — especially useful on large types (e.g., `pattern: "seo"` on Shopify's `Product` type)
- Automatically expands referenced enums, inputs, and custom scalars inline
- Suggests similar type names on typos

### `gql_execute`

Execute a GraphQL query or mutation.

| Parameter | Type | Description |
|-----------|------|-------------|
| `provider` | `string` | Provider name (e.g. `"shopify"`, `"linear"`) |
| `operation` | `string` | The full GraphQL operation |
| `variables` | `object?` | Variables for a single operation |
| `batch` | `object[]?` | Array of variable sets for batch execution (mutually exclusive with `variables`) |

**Single execution:**
- Automatic retry with backoff on 429 rate limits (up to 3 retries)
- Large responses (>50KB) are truncated with a notice

**Batch execution:**
- Pass an operation template and an array of variable sets
- The extension constructs aliased operations, handles chunking (50 per request), and collects per-item results
- Summary line shows succeeded/failed counts
- Errors are mapped to individual batch items by GraphQL path

Example — update 50 Shopify products in one tool call:
```
operation: "mutation($id: ID!, $input: ProductInput!) { productUpdate(id: $id, input: $input) { product { id } userErrors { message } } }"
batch: [{"id": "gid://shopify/Product/1", "input": {"title": "New Title"}}, ...]
```

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

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on submitting changes and adding new providers.

## License

MIT
