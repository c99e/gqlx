import { describe, it, expect } from "bun:test";
import { formatExecuteResponse, formatBatchResponse } from "../src/format.js";
import type { GqlResponse, BatchResponse } from "../src/types.js";

// ============================================================
// formatExecuteResponse
// ============================================================

describe("formatExecuteResponse", () => {
  it("returns pretty-printed JSON for a clean response", () => {
    const response: GqlResponse = { data: { user: { id: "1", name: "Alice" } } };
    const result = formatExecuteResponse(response, false, 50);

    expect(result).toBe(JSON.stringify(response, null, 2));
  });

  it("prepends error summary when response has errors", () => {
    const response: GqlResponse = {
      data: null,
      errors: [{ message: "Not found" }, { message: "Unauthorized" }],
    };
    const result = formatExecuteResponse(response, false, 30);

    expect(result).toStartWith("GraphQL errors: Not found; Unauthorized");
    expect(result).toContain("Full response:");
    expect(result).toContain('"Not found"');
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
    expect(result).toBe(JSON.stringify(response, null, 2));
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

    expect(result).toStartWith("Batch complete: 2/2 succeeded (1 chunk)");
    expect(result).toContain('"succeeded": 2');
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

  it("includes full JSON body after summary", () => {
    const batch: BatchResponse = {
      results: [{ index: 0, data: { name: "test" }, errors: null }],
      summary: { total: 1, succeeded: 1, failed: 0, chunks: 1 },
    };
    const result = formatBatchResponse(batch);
    const jsonPart = result.slice(result.indexOf("\n\n") + 2);

    expect(JSON.parse(jsonPart)).toEqual(batch);
  });
});
