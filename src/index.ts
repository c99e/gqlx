/**
 * pi-graphql: GraphQL schema exploration and query execution.
 *
 * Supports multiple GraphQL providers (Shopify, Linear) via auto-detection
 * from environment variables. See providers.ts for the abstraction.
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
import { Text } from "@mariozechner/pi-tui";

import type { SchemaIndex, GqlProvider } from "./types.js";
import { fetchIntrospection, parseIntrospection } from "./schema.js";
import { searchSchema } from "./search.js";
import { executeOperation, executeBatch } from "./execute.js";
import { detectProvider } from "./providers.js";
import { sortSearchResults, formatTypeSDL, formatExecuteResponse, formatBatchResponse } from "./format.js";

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
  let provider: GqlProvider | null = null;
  let schemaIndex: SchemaIndex | null = null;
  let schemaError: string | null = null;

  function getProvider(): GqlProvider {
    if (!provider) {
      provider = detectProvider();
    }
    return provider;
  }

  async function getSchema(signal?: AbortSignal): Promise<SchemaIndex> {
    if (schemaIndex) return schemaIndex;
    if (schemaError) throw new Error(schemaError);

    try {
      const p = getProvider();
      const headers = await p.getHeaders();
      const introspection = await fetchIntrospection(p.getEndpoint(), headers, signal);
      schemaIndex = parseIntrospection(introspection);
      return schemaIndex;
    } catch (err) {
      schemaError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  // Load .env and reset cache on new session
  pi.on("session_start", async (_event, ctx) => {
    if (provider) provider.reset();
    provider = null;
    schemaIndex = null;
    schemaError = null;
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
      const sorted = sortSearchResults(results);

      return {
        content: [{ type: "text", text: JSON.stringify(sorted) }],
        details: { resultCount: sorted.length, results: sorted },
      };
    },

    renderCall(args, theme) {
      const t = new Text("", 0, 0);
      let content = theme.fg("toolTitle", theme.bold("gql_search "));
      content += theme.fg("muted", `"${args.pattern}"`);
      if (args.kind && args.kind !== "all") content += theme.fg("dim", ` (${args.kind})`);
      t.setText(content);
      return t;
    },

    renderResult(result, { expanded }, theme) {
      const t = new Text("", 0, 0);
      const count = (result.details as any)?.resultCount ?? 0;
      let content = theme.fg("success", `✓ ${count} result${count === 1 ? "" : "s"}`);
      if (expanded) {
        content += "\n" + (result.content?.[0] as any)?.text;
      }
      t.setText(content);
      return t;
    },
  });

  // ---------------------------------------------------------
  // Tool: gql_type
  // ---------------------------------------------------------
  pi.registerTool({
    name: "gql_type",
    label: "GQL Type",
    description:
      "Get the definition of a GraphQL type with fields, arguments, and referenced types. " +
      "Compact by default (names and types only). Use verbose for full descriptions. " +
      "Use pattern to filter fields by name or type substring.",
    promptSnippet:
      "Get GraphQL type definition with fields, arguments, and referenced types",
    promptGuidelines: [
      "Use gql_type after gql_search to understand a type's fields and arguments before constructing queries.",
      "Check input types to see required fields before writing mutations.",
      "Start with compact mode (default). Use verbose: true only when you need field descriptions.",
      "Use pattern to filter large types (50+ fields) to only show fields matching a substring.",
    ],
    parameters: Type.Object({
      name: Type.String({ description: "Exact type name (case-sensitive)" }),
      verbose: Type.Optional(
        Type.Boolean({
          description: "Include full descriptions on fields and types (default false)",
        })
      ),
      pattern: Type.Optional(
        Type.String({
          description: "Filter fields by case-insensitive substring match on field name or type",
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

      const verbose = params.verbose === true;
      const formatted = formatTypeSDL(typeInfo, { index, verbose, pattern: params.pattern });

      return {
        content: [{ type: "text", text: formatted }],
        details: { typeName: typeInfo.name, kind: typeInfo.kind },
      };
    },

    renderCall(args, theme) {
      const t = new Text("", 0, 0);
      let content = theme.fg("toolTitle", theme.bold("gql_type "));
      content += theme.fg("muted", args.name);
      if (args.verbose) content += theme.fg("dim", " (verbose)");
      if (args.pattern) content += theme.fg("dim", ` filter: "${args.pattern}"`);
      t.setText(content);
      return t;
    },

    renderResult(result, { expanded }, theme) {
      const t = new Text("", 0, 0);
      const d = result.details as any;
      let content = theme.fg("success", `✓ ${d?.typeName ?? "unknown"} (${d?.kind ?? "?"})`);
      if (expanded) {
        content += "\n" + (result.content?.[0] as any)?.text;
      }
      t.setText(content);
      return t;
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
      "Use batch to apply the same operation to many items — provide the operation template and an array of variable sets. The extension handles aliasing and chunking automatically.",
    ],
    parameters: Type.Object({
      operation: Type.String({
        description: "The full GraphQL operation (query or mutation)",
      }),
      variables: Type.Optional(
        Type.Record(Type.String(), Type.Unknown(), {
          description: "Variables for the operation (mutually exclusive with batch)",
        })
      ),
      batch: Type.Optional(
        Type.Array(
          Type.Record(Type.String(), Type.Unknown()),
          {
            description:
              "Array of variable sets for batch execution. " +
              "The extension constructs aliased operations from the template, " +
              "handles chunking, and collects per-item results. " +
              "Mutually exclusive with variables.",
          }
        )
      ),
    }),

    async execute(_toolCallId, params, signal) {
      // Mutual exclusivity check
      const hasVariables = params.variables != null && Object.keys(params.variables as object).length > 0;
      const hasBatch = params.batch != null && (params.batch as unknown[]).length > 0;

      if (hasVariables && hasBatch) {
        throw new Error(
          '"variables" and "batch" are mutually exclusive. ' +
          'Use "variables" for a single operation, or "batch" for multiple operations with the same template.'
        );
      }

      const p = getProvider();
      const headers = await p.getHeaders();

      // ---- Batch execution path ----
      if (hasBatch) {
        const batchItems = params.batch as Record<string, unknown>[];
        const batchResponse = await executeBatch(
          p.getEndpoint(),
          headers,
          params.operation,
          batchItems,
          { signal }
        );

        const output = formatBatchResponse(batchResponse);
        const { summary } = batchResponse;

        return {
          content: [{ type: "text", text: output }],
          details: {
            hasErrors: summary.failed > 0,
            batch: true,
            ...summary,
            response: batchResponse,
          } as Record<string, unknown>,
        };
      }

      // ---- Single execution path ----
      const { response, truncated, rawLength } = await executeOperation(
        p.getEndpoint(),
        headers,
        params.operation,
        params.variables as Record<string, unknown> | undefined,
        { signal }
      );

      const text = formatExecuteResponse(response, truncated, rawLength);
      const hasErrors = Array.isArray(response.errors) && response.errors.length > 0;

      return {
        content: [{ type: "text", text }],
        details: { hasErrors, truncated, rawLength, response },
      };
    },

    renderCall(args, theme) {
      const t = new Text("", 0, 0);
      let content = theme.fg("toolTitle", theme.bold("gql_execute "));
      if ((args as any).batch) {
        const count = ((args as any).batch as unknown[]).length;
        content += theme.fg("muted", `batch (${count} item${count === 1 ? "" : "s"})`);
      } else {
        // Show first line of operation, trimmed
        const firstLine = args.operation.trim().split("\n")[0].slice(0, 60);
        content += theme.fg("dim", firstLine);
      }
      t.setText(content);
      return t;
    },

    renderResult(result, { expanded }, theme) {
      const t = new Text("", 0, 0);
      const d = result.details as any;
      let content: string;

      if (d?.batch) {
        const ok = d.succeeded ?? 0;
        const total = d.total ?? 0;
        const failed = d.failed ?? 0;
        content = theme.fg(failed > 0 ? "warning" : "success",
          `✓ ${ok}/${total} succeeded${failed > 0 ? `, ${failed} failed` : ""}`);
      } else {
        const hasErrors = d?.hasErrors;
        const rawLength = d?.rawLength ?? 0;
        const kb = (rawLength / 1024).toFixed(1);
        if (hasErrors) {
          const errors = d?.response?.errors ?? [];
          const summary = errors.map((e: any) => e.message).join("; ");
          content = theme.fg("warning", `⚠ ${errors.length} error${errors.length === 1 ? "" : "s"}: ${summary}`);
        } else {
          content = theme.fg("success", `✓ ${kb}KB response`);
        }
        if (d?.truncated) content += theme.fg("dim", " (truncated)");
      }

      if (expanded) {
        content += "\n" + (result.content?.[0] as any)?.text;
      }
      t.setText(content);
      return t;
    },
  });
}
