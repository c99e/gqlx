import { describe, it, expect } from "bun:test";
import { formatExecuteResponse, formatBatchResponse, sortSearchResults } from "../src/format.js";
import type { GqlResponse, BatchResponse, SearchResult } from "../src/types.js";

// ============================================================
// sortSearchResults
// ============================================================

describe("sortSearchResults", () => {
  it("sorts results by kind in canonical order", () => {
    const results: SearchResult[] = [
      { kind: "type", name: "User", signature: "type User (3 fields)", description: null },
      { kind: "query", name: "user", signature: "query user(id: ID!): User", description: null },
      { kind: "enum", name: "Role", signature: "enum Role (2 values) { ADMIN, USER }", description: null },
      { kind: "mutation", name: "createUser", signature: "mutation createUser(...): User!", description: null },
    ];
    const sorted = sortSearchResults(results);

    expect(sorted[0].kind).toBe("query");
    expect(sorted[1].kind).toBe("mutation");
    expect(sorted[2].kind).toBe("type");
    expect(sorted[3].kind).toBe("enum");
  });

  it("preserves relative order within the same kind", () => {
    const results: SearchResult[] = [
      { kind: "query", name: "users", signature: "query users: [User!]!", description: null },
      { kind: "query", name: "user", signature: "query user(id: ID!): User", description: null },
    ];
    const sorted = sortSearchResults(results);

    expect(sorted[0].name).toBe("users");
    expect(sorted[1].name).toBe("user");
  });

  it("returns empty array for empty input", () => {
    expect(sortSearchResults([])).toEqual([]);
  });

  it("does not mutate the original array", () => {
    const results: SearchResult[] = [
      { kind: "type", name: "User", signature: "type User", description: null },
      { kind: "query", name: "user", signature: "query user", description: null },
    ];
    const original = [...results];
    sortSearchResults(results);
    expect(results).toEqual(original);
  });
});

// ============================================================
// formatExecuteResponse
// ============================================================

describe("formatExecuteResponse", () => {
  it("returns compact JSON for a clean response", () => {
    const response: GqlResponse = { data: { user: { id: "1", name: "Alice" } } };
    const result = formatExecuteResponse(response, false, 50);

    expect(result).toBe(JSON.stringify(response));
  });

  it("prepends error summary when response has errors", () => {
    const response: GqlResponse = {
      data: null,
      errors: [{ message: "Not found" }, { message: "Unauthorized" }],
    };
    const result = formatExecuteResponse(response, false, 30);

    expect(result).toStartWith("GraphQL errors: Not found; Unauthorized\n\n");
    expect(result).toContain(JSON.stringify(response));
  });

  it("appends truncation notice when truncated", () => {
    const response: GqlResponse = { data: { big: "data" } };
    const result = formatExecuteResponse(response, true, 100_000);

    expect(result).toContain("[Response truncated: showing first 50KB of 100000 bytes]");
  });

  it("shows both errors and truncation together", () => {
    const response: GqlResponse = {
      data: null,
      errors: [{ message: "Partial failure" }],
    };
    const result = formatExecuteResponse(response, true, 200_000);

    expect(result).toStartWith("GraphQL errors: Partial failure");
    expect(result).toContain("[Response truncated:");
  });

  it("handles response with empty errors array as no errors", () => {
    const response: GqlResponse = { data: { ok: true }, errors: [] };
    const result = formatExecuteResponse(response, false, 10);

    expect(result).not.toContain("GraphQL errors");
    expect(result).toBe(JSON.stringify(response));
  });
});

// ============================================================
// formatBatchResponse
// ============================================================

describe("formatBatchResponse", () => {
  it("summarizes a fully successful batch", () => {
    const batch: BatchResponse = {
      results: [
        { index: 0, data: { id: "1" }, errors: null },
        { index: 1, data: { id: "2" }, errors: null },
      ],
      summary: { total: 2, succeeded: 2, failed: 0, chunks: 1 },
    };
    const result = formatBatchResponse(batch);

    expect(result).toStartWith("Batch complete: 2/2 succeeded (1 chunk)\n\n");
    expect(result).toContain(JSON.stringify(batch));
  });

  it("reports failures in summary line", () => {
    const batch: BatchResponse = {
      results: [
        { index: 0, data: { id: "1" }, errors: null },
        { index: 1, data: null, errors: [{ message: "boom" }] },
      ],
      summary: { total: 2, succeeded: 1, failed: 1, chunks: 1 },
    };
    const result = formatBatchResponse(batch);

    expect(result).toContain("1/2 succeeded");
    expect(result).toContain("1 failed");
  });

  it("pluralizes chunks correctly", () => {
    const batch: BatchResponse = {
      results: [{ index: 0, data: {}, errors: null }],
      summary: { total: 1, succeeded: 1, failed: 0, chunks: 3 },
    };
    const result = formatBatchResponse(batch);

    expect(result).toContain("3 chunks");
  });

  it("uses singular chunk for single chunk", () => {
    const batch: BatchResponse = {
      results: [{ index: 0, data: {}, errors: null }],
      summary: { total: 1, succeeded: 1, failed: 0, chunks: 1 },
    };
    const result = formatBatchResponse(batch);

    expect(result).toContain("(1 chunk)");
    expect(result).not.toContain("1 chunks");
  });

  it("includes compact JSON body after summary", () => {
    const batch: BatchResponse = {
      results: [{ index: 0, data: { name: "test" }, errors: null }],
      summary: { total: 1, succeeded: 1, failed: 0, chunks: 1 },
    };
    const result = formatBatchResponse(batch);
    const jsonPart = result.slice(result.indexOf("\n\n") + 2);

    expect(JSON.parse(jsonPart)).toEqual(batch);
    // Verify it's compact (no indentation)
    expect(jsonPart).toBe(JSON.stringify(batch));
  });
});
