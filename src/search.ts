import type { SchemaIndex, SearchOptions, SearchResult } from "./types.js";
import { formatArgs } from "./schema.js";

/**
 * Search the schema index for types, queries, mutations, fields.
 *
 * Pattern matching is case-insensitive substring. Use "*" to list all.
 * Results are sorted: exact match > starts-with > contains.
 */
export function searchSchema(index: SchemaIndex, options: SearchOptions): SearchResult[] {
  const { pattern, kind = "all", limit = 25 } = options;
  const isWildcard = pattern === "*" || pattern === "";
  const needle = pattern.toLowerCase();

  const results: Array<SearchResult & { score: number }> = [];

  function score(name: string): number {
    if (isWildcard) return 0;
    const lower = name.toLowerCase();
    if (lower === needle) return 3; // exact
    if (lower.startsWith(needle)) return 2; // prefix
    return 1; // contains
  }

  function matches(text: string): boolean {
    if (isWildcard) return true;
    return text.toLowerCase().includes(needle);
  }

  function matchesAny(name: string, description: string | null): boolean {
    return matches(name) || (description !== null && matches(description));
  }

  // Search queries
  if (kind === "all" || kind === "query") {
    for (const op of index.queries) {
      if (matchesAny(op.name, op.description)) {
        results.push({
          kind: "query",
          name: op.name,
          signature: `query ${op.name}${formatArgs(op.args)}: ${op.type}`,
          description: op.description,
          score: score(op.name),
        });
      }
    }
  }

  // Search mutations
  if (kind === "all" || kind === "mutation") {
    for (const op of index.mutations) {
      if (matchesAny(op.name, op.description)) {
        results.push({
          kind: "mutation",
          name: op.name,
          signature: `mutation ${op.name}${formatArgs(op.args)}: ${op.type}`,
          description: op.description,
          score: score(op.name),
        });
      }
    }
  }

  // Search subscriptions
  if (kind === "all" || kind === "subscription") {
    for (const op of index.subscriptions) {
      if (matchesAny(op.name, op.description)) {
        results.push({
          kind: "subscription",
          name: op.name,
          signature: `subscription ${op.name}${formatArgs(op.args)}: ${op.type}`,
          description: op.description,
          score: score(op.name),
        });
      }
    }
  }

  // Search types
  const kindToGqlKind: Record<string, string[]> = {
    type: ["OBJECT", "INTERFACE"],
    input: ["INPUT_OBJECT"],
    enum: ["ENUM"],
    scalar: ["SCALAR"],
    union: ["UNION"],
    interface: ["INTERFACE"],
  };

  // Collect matching enum values as qualified results (e.g. CurrencyCode.EUR)
  function collectEnumValueMatches(typeInfo: { name: string; kind: string; enumValues: { name: string; description: string | null }[] }): void {
    if (typeInfo.kind !== "ENUM") return;
    for (const ev of typeInfo.enumValues) {
      if (matches(ev.name)) {
        results.push({
          kind: "enum",
          name: typeInfo.name,
          signature: `${typeInfo.name}.${ev.name}`,
          description: ev.description,
          parentType: typeInfo.name,
          score: 0, // enum value matches rank lowest
        });
      }
    }
  }

  const shouldSearchTypes =
    kind === "all" || kind in kindToGqlKind;

  if (shouldSearchTypes) {
    const allowedKinds = kind === "all" ? null : kindToGqlKind[kind] ?? null;

    for (const [, typeInfo] of index.types) {
      if (allowedKinds && !allowedKinds.includes(typeInfo.kind)) continue;

      // Match on type name or description
      if (matchesAny(typeInfo.name, typeInfo.description)) {
        results.push({
          kind: formatKind(typeInfo.kind),
          name: typeInfo.name,
          signature: formatTypeSignature(typeInfo),
          description: typeInfo.description,
          score: score(typeInfo.name),
        });
        // Also search enum values as separate results (skip for wildcards to avoid noise)
        if (!isWildcard) collectEnumValueMatches(typeInfo);
        continue;
      }

      // Also match on field names / enum values within types
      if (!isWildcard) {
        collectEnumValueMatches(typeInfo);

        for (const f of typeInfo.fields) {
          if (matches(f.name)) {
            results.push({
              kind: formatKind(typeInfo.kind),
              name: typeInfo.name,
              signature: `${typeInfo.name}.${f.name}: ${f.type}`,
              description: f.description,
              parentType: typeInfo.name,
              score: 0, // field matches rank lowest
            });
            break; // one match per type for field search
          }
        }
        for (const f of typeInfo.inputFields) {
          if (matches(f.name)) {
            results.push({
              kind: formatKind(typeInfo.kind),
              name: typeInfo.name,
              signature: `${typeInfo.name}.${f.name}: ${f.type}`,
              description: f.description,
              parentType: typeInfo.name,
              score: 0,
            });
            break;
          }
        }
      }
    }
  }

  // Sort by score descending, then alphabetically
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name);
  });

  const stripScore = ({ score: _, ...rest }: SearchResult & { score: number }): SearchResult => rest;

  // When kind is "all", apply limit per category so no single kind dominates.
  // Without this, types (which vastly outnumber queries/mutations in most schemas)
  // drown out the more actionable operation results.
  if (kind === "all") {
    const grouped = new Map<string, Array<SearchResult & { score: number }>>();
    for (const r of results) {
      const bucket = grouped.get(r.kind) ?? [];
      bucket.push(r);
      grouped.set(r.kind, bucket);
    }
    const merged: SearchResult[] = [];
    for (const [, items] of grouped) {
      merged.push(...items.slice(0, limit).map(stripScore));
    }
    return merged;
  }

  return results.slice(0, limit).map(stripScore);
}

function formatKind(kind: string): string {
  switch (kind) {
    case "OBJECT":
      return "type";
    case "INPUT_OBJECT":
      return "input";
    case "ENUM":
      return "enum";
    case "SCALAR":
      return "scalar";
    case "UNION":
      return "union";
    case "INTERFACE":
      return "interface";
    default:
      return kind.toLowerCase();
  }
}

function plural(n: number, singular: string, pluralForm: string): string {
  return n === 1 ? `${n} ${singular}` : `${n} ${pluralForm}`;
}

function countRequiredInputFields(inputFields: { type: string; defaultValue: string | null }[]): number {
  return inputFields.filter((f) => f.type.endsWith("!") && f.defaultValue === null).length;
}

function formatTypeSignature(t: { name: string; kind: string; fields: unknown[]; inputFields: { type: string; defaultValue: string | null }[]; enumValues: { name: string }[]; possibleTypes: string[] }): string {
  const kindLabel = formatKind(t.kind);

  switch (t.kind) {
    case "OBJECT":
    case "INTERFACE": {
      return `${kindLabel} ${t.name} (${plural(t.fields.length, "field", "fields")})`;
    }
    case "INPUT_OBJECT": {
      const total = t.inputFields.length;
      const required = countRequiredInputFields(t.inputFields);
      return `input ${t.name} (${plural(total, "field", "fields")}, ${plural(required, "required", "required")})`;
    }
    case "ENUM": {
      const vals = t.enumValues.map((v) => v.name);
      const preview = vals.length <= 6 ? vals.join(", ") : vals.slice(0, 5).join(", ") + ", ...";
      return `enum ${t.name} (${plural(vals.length, "value", "values")}) { ${preview} }`;
    }
    case "UNION": {
      return `union ${t.name} = ${t.possibleTypes.join(" | ")}`;
    }
    default:
      return `${kindLabel} ${t.name}`;
  }
}

/**
 * Format search results into a readable string for the LLM.
 */
export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return "No results found.";

  // Group by kind
  const groups = new Map<string, SearchResult[]>();
  for (const r of results) {
    const existing = groups.get(r.kind) ?? [];
    existing.push(r);
    groups.set(r.kind, existing);
  }

  const lines: string[] = [];
  const order = ["query", "mutation", "subscription", "type", "interface", "input", "enum", "union", "scalar"];

  for (const kind of order) {
    const items = groups.get(kind);
    if (!items) continue;

    lines.push(`${kind.charAt(0).toUpperCase() + kind.slice(1)}:`);
    for (const item of items) {
      lines.push(`  ${item.signature}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
