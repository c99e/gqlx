import type {
  ArgInfo,
  GqlResponse,
  BatchResponse,
  OperationInfo,
  SchemaIndex,
  SearchResult,
  TypeInfo,
} from "./types.js";

// ============================================================
// Argument & operation formatting
// ============================================================

export function formatArgs(args: ArgInfo[]): string {
  if (args.length === 0) return "";
  const parts = args.map((a) => {
    let s = `${a.name}: ${a.type}`;
    if (a.defaultValue !== null) s += ` = ${a.defaultValue}`;
    return s;
  });
  // Single line if short enough, multi-line otherwise
  const oneLine = `(${parts.join(", ")})`;
  if (oneLine.length <= 80) return oneLine;
  return `(\n  ${parts.join(",\n  ")}\n)`;
}

export function formatOperationSignature(op: OperationInfo): string {
  return `${op.name}${formatArgs(op.args)}: ${op.type}`;
}

// ============================================================
// Type SDL formatting
// ============================================================

/** Built-in scalars excluded from referenced-type expansion */
const BUILTIN_SCALARS = new Set(["String", "Int", "Float", "Boolean", "ID"]);

export interface FormatTypeOptions {
  /** SchemaIndex for expanding referenced enums/inputs inline */
  index?: SchemaIndex;
  /** Show descriptions on types, fields, enum values (default false) */
  verbose?: boolean;
  /** Filter fields/input fields by case-insensitive substring on name, type, or arg names */
  pattern?: string;
}

export function formatTypeSDL(typeInfo: TypeInfo, options?: FormatTypeOptions): string {
  const index = options?.index;
  const verbose = options?.verbose === true;
  const lines: string[] = [];

  if (verbose && typeInfo.description) {
    lines.push(`# ${typeInfo.description}`);
  }

  const needle = options?.pattern?.toLowerCase();

  function fieldMatches(name: string, type: string, argNames?: string[]): boolean {
    if (!needle) return true;
    if (name.toLowerCase().includes(needle)) return true;
    if (type.toLowerCase().includes(needle)) return true;
    if (argNames) {
      for (const a of argNames) {
        if (a.toLowerCase().includes(needle)) return true;
      }
    }
    return false;
  }

  switch (typeInfo.kind) {
    case "OBJECT":
    case "INTERFACE": {
      const keyword = typeInfo.kind === "INTERFACE" ? "interface" : "type";
      const impl = typeInfo.interfaces.length > 0 ? ` implements ${typeInfo.interfaces.join(" & ")}` : "";
      lines.push(`${keyword} ${typeInfo.name}${impl} {`);
      for (const f of typeInfo.fields) {
        if (!fieldMatches(f.name, f.type, f.args.map((a) => a.name))) continue;
        const args = formatArgs(f.args);
        const desc = verbose && f.description ? `  # ${f.description}` : "";
        const deprecated = f.isDeprecated ? " @deprecated" : "";
        lines.push(`  ${f.name}${args}: ${f.type}${deprecated}${desc}`);
      }
      lines.push("}");
      break;
    }

    case "INPUT_OBJECT": {
      lines.push(`input ${typeInfo.name} {`);
      for (const f of typeInfo.inputFields) {
        if (!fieldMatches(f.name, f.type)) continue;
        const def = f.defaultValue !== null ? ` = ${f.defaultValue}` : "";
        const desc = verbose && f.description ? `  # ${f.description}` : "";
        lines.push(`  ${f.name}: ${f.type}${def}${desc}`);
      }
      lines.push("}");
      break;
    }

    case "ENUM": {
      lines.push(`enum ${typeInfo.name} {`);
      for (const v of typeInfo.enumValues) {
        const deprecated = v.isDeprecated ? " @deprecated" : "";
        const desc = verbose && v.description ? `  # ${v.description}` : "";
        lines.push(`  ${v.name}${deprecated}${desc}`);
      }
      lines.push("}");
      break;
    }

    case "UNION": {
      lines.push(`union ${typeInfo.name} = ${typeInfo.possibleTypes.join(" | ")}`);
      break;
    }

    case "SCALAR": {
      lines.push(`scalar ${typeInfo.name}`);
      break;
    }
  }

  // Expand referenced enums and input types inline when index is provided
  if (index) {
    const referenced = collectReferencedTypes(typeInfo, index);
    if (referenced.length > 0) {
      lines.push("");
      lines.push("--- Referenced Types ---");
      for (const ref of referenced) {
        lines.push("");
        lines.push(formatTypeSDL(ref, { verbose })); // no index → no recursive expansion
      }
    }
  }

  return lines.join("\n");
}

/** Collect enums, inputs, and scalars (non-builtin) directly referenced by a type */
function collectReferencedTypes(typeInfo: TypeInfo, index: SchemaIndex): TypeInfo[] {
  const seen = new Set<string>();
  const result: TypeInfo[] = [];

  function addIfRelevant(typeName: string) {
    // Strip wrapping (NonNull, List) to get the base type name
    const base = typeName.replace(/[[\]!]/g, "");
    if (seen.has(base) || BUILTIN_SCALARS.has(base) || base === typeInfo.name) return;
    seen.add(base);

    const ref = index.types.get(base);
    if (!ref) return;
    // Only expand enums, inputs, and non-builtin scalars
    if (ref.kind === "ENUM" || ref.kind === "INPUT_OBJECT" || ref.kind === "SCALAR") {
      result.push(ref);
    }
  }

  for (const f of typeInfo.fields) {
    addIfRelevant(f.type);
    for (const a of f.args) addIfRelevant(a.type);
  }
  for (const f of typeInfo.inputFields) {
    addIfRelevant(f.type);
  }

  return result;
}

// ============================================================
// Search result formatting
// ============================================================

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

// ============================================================
// Execute response formatting
// ============================================================

/**
 * Format a single GraphQL execution response for display.
 */
export function formatExecuteResponse(
  response: GqlResponse,
  truncated: boolean,
  rawLength: number,
): string {
  let text = JSON.stringify(response, null, 2);

  if (truncated) {
    text += `\n\n[Response truncated: showing first 50KB of ${rawLength} bytes]`;
  }

  const hasErrors = Array.isArray(response.errors) && response.errors.length > 0;
  if (hasErrors) {
    const errorSummary = response.errors!.map((e) => e.message).join("; ");
    text = `GraphQL errors: ${errorSummary}\n\nFull response:\n${text}`;
  }

  return text;
}

/**
 * Format a batch execution response for display.
 */
export function formatBatchResponse(batch: BatchResponse): string {
  const text = JSON.stringify(batch, null, 2);
  const { summary } = batch;

  let output = `Batch complete: ${summary.succeeded}/${summary.total} succeeded`;
  if (summary.failed > 0) {
    output += `, ${summary.failed} failed`;
  }
  output += ` (${summary.chunks} chunk${summary.chunks === 1 ? "" : "s"})`;
  output += `\n\n${text}`;

  return output;
}
