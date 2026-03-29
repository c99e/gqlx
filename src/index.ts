/**
 * pi-graphql: GraphQL schema exploration and query execution for Shopify.
 *
 * Registers three tools:
 *   gql_search  — Search the schema for types, queries, mutations
 *   gql_type    — Get full type definitions
 *   gql_execute — Run queries and mutations
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

import type { SchemaIndex, ShopifyConfig } from "./types.js";
import { fetchIntrospection, parseIntrospection, formatTypeSDL } from "./schema.js";
import { searchSchema, formatSearchResults } from "./search.js";
import {
  configFromEnv,
  getEndpoint,
  getToken,
  buildHeaders,
  resetToken,
  executeOperation,
} from "./execute.js";

/**
 * Parse a .env file and merge into process.env.
 * Only sets vars that aren't already set (env takes precedence over file).
 */
function loadEnvFile(filepath: string): void {
  if (!existsSync(filepath)) return;

  const content = readFileSync(filepath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Strip optional "export " prefix
    const assignment = trimmed.startsWith("export ") ? trimmed.slice(7) : trimmed;
    const eqIndex = assignment.indexOf("=");
    if (eqIndex === -1) continue;

    const key = assignment.slice(0, eqIndex).trim();
    let value = assignment.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Don't override existing env vars
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export default function (pi: ExtensionAPI) {
  // ---------------------------------------------------------
  // State: cached per session
  // ---------------------------------------------------------
  let config: ShopifyConfig | null = null;
  let schemaIndex: SchemaIndex | null = null;
  let schemaError: string | null = null;

  function getConfig(): ShopifyConfig {
    if (!config) {
      config = configFromEnv();
    }
    return config;
  }

  async function getHeaders(): Promise<Record<string, string>> {
    const cfg = getConfig();
    const token = await getToken(cfg);
    return buildHeaders(token);
  }

  async function getSchema(signal?: AbortSignal): Promise<SchemaIndex> {
    if (schemaIndex) return schemaIndex;
    if (schemaError) throw new Error(schemaError);

    try {
      const cfg = getConfig();
      const headers = await getHeaders();
      const introspection = await fetchIntrospection(getEndpoint(cfg), headers, signal);
      schemaIndex = parseIntrospection(introspection);
      return schemaIndex;
    } catch (err) {
      schemaError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  // Load .env and reset cache on new session
  pi.on("session_start", async (_event, ctx) => {
    config = null;
    schemaIndex = null;
    schemaError = null;
    resetToken();
    loadEnvFile(resolve(ctx.cwd, ".env"));
  });

  // ---------------------------------------------------------
  // Tool: gql_search
  // ---------------------------------------------------------
  pi.registerTool({
    name: "gql_search",
    label: "GQL Search",
    description:
      'Search the GraphQL schema for queries, mutations, types, inputs, enums. ' +
      'Use this to discover available operations and types BEFORE constructing any GraphQL query. ' +
      'Pass "*" as pattern to list all items of a kind.',
    promptSnippet:
      "Search the GraphQL schema for queries, mutations, types, enums, and fields by pattern",
    promptGuidelines: [
      "ALWAYS use gql_search before writing any GraphQL query or mutation. Never guess field names or types.",
      'Start broad (e.g., pattern "user") then narrow down. Use kind filter to focus results.',
      'Use pattern "*" with a kind filter to list all available queries or mutations.',
    ],
    parameters: Type.Object({
      pattern: Type.String({
        description: 'Search term (case-insensitive substring match) or "*" to list all',
      }),
      kind: Type.Optional(
        StringEnum([
          "query",
          "mutation",
          "subscription",
          "type",
          "input",
          "enum",
          "scalar",
          "union",
          "interface",
          "all",
        ] as const)
      ),
      limit: Type.Optional(
        Type.Number({ description: "Max results (default 25)", minimum: 1, maximum: 100 })
      ),
    }),

    async execute(_toolCallId, params, signal) {
      const index = await getSchema(signal);
      const results = searchSchema(index, {
        pattern: params.pattern,
        kind: (params.kind as any) ?? "all",
        limit: params.limit ?? 25,
      });
      const formatted = formatSearchResults(results);

      return {
        content: [{ type: "text", text: formatted }],
        details: { resultCount: results.length },
      };
    },
  });

  // ---------------------------------------------------------
  // Tool: gql_type
  // ---------------------------------------------------------
  pi.registerTool({
    name: "gql_type",
    label: "GQL Type",
    description:
      "Get the full definition of a GraphQL type including all fields, arguments, and descriptions. " +
      "Referenced enums and input types are expanded inline.",
    promptSnippet:
      "Get full GraphQL type definition with fields, arguments, and referenced types",
    promptGuidelines: [
      "Use gql_type after gql_search to understand a type's fields and arguments before constructing queries.",
      "Check input types to see required fields before writing mutations.",
    ],
    parameters: Type.Object({
      name: Type.String({ description: "Exact type name (case-sensitive)" }),
      expand: Type.Optional(
        Type.Boolean({
          description: "Expand referenced enums and input types inline (default true)",
        })
      ),
    }),

    async execute(_toolCallId, params, signal) {
      const index = await getSchema(signal);
      const typeInfo = index.types.get(params.name);

      if (!typeInfo) {
        const lower = params.name.toLowerCase();
        const suggestions = Array.from(index.types.keys())
          .filter((k) => k.toLowerCase().includes(lower))
          .slice(0, 10);

        let msg = `Type "${params.name}" not found.`;
        if (suggestions.length > 0) {
          msg += `\n\nDid you mean: ${suggestions.join(", ")}`;
        }
        throw new Error(msg);
      }

      const expand = params.expand !== false;
      const formatted = formatTypeSDL(typeInfo, expand ? index : undefined);

      return {
        content: [{ type: "text", text: formatted }],
        details: { typeName: typeInfo.name, kind: typeInfo.kind },
      };
    },
  });

  // ---------------------------------------------------------
  // Tool: gql_execute
  // ---------------------------------------------------------
  pi.registerTool({
    name: "gql_execute",
    label: "GQL Execute",
    description:
      "Execute a GraphQL query or mutation against the configured endpoint. " +
      "Always use gql_search and gql_type first to understand the schema.",
    promptSnippet: "Execute a GraphQL query or mutation and return the JSON response",
    promptGuidelines: [
      "ALWAYS use gql_search and gql_type to understand the schema before constructing a query.",
      "Use variables for dynamic values instead of string interpolation.",
      "Request only the fields you need in the selection set.",
      "Check for errors in the response before processing data.",
    ],
    parameters: Type.Object({
      operation: Type.String({
        description: "The full GraphQL operation (query or mutation)",
      }),
      variables: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
          description: "Variables for the operation",
        })
      ),
    }),

    async execute(_toolCallId, params, signal) {
      const cfg = getConfig();
      const headers = await getHeaders();
      const { response, truncated, rawLength } = await executeOperation(
        getEndpoint(cfg),
        headers,
        params.operation,
        params.variables as Record<string, unknown> | undefined,
        { signal }
      );

      let text = JSON.stringify(response, null, 2);

      if (truncated) {
        text += `\n\n[Response truncated: showing first 50KB of ${rawLength} bytes]`;
      }

      const hasErrors = Array.isArray(response.errors) && response.errors.length > 0;
      if (hasErrors) {
        const errorSummary = response.errors!.map((e) => e.message).join("; ");
        text = `GraphQL errors: ${errorSummary}\n\nFull response:\n${text}`;
      }

      return {
        content: [{ type: "text", text }],
        details: { hasErrors, truncated, rawLength },
      };
    },
  });
}
