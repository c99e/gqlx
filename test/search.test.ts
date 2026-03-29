import { test, expect, describe } from "bun:test";
import { parseIntrospection } from "../src/schema.js";
import { searchSchema, formatSearchResults } from "../src/search.js";
import { TEST_INTROSPECTION } from "./helpers.js";

const index = parseIntrospection(TEST_INTROSPECTION);

// ============================================================
// searchSchema
// ============================================================

describe("searchSchema", () => {
  test("wildcard returns all queries", () => {
    const results = searchSchema(index, { pattern: "*", kind: "query" });
    expect(results.length).toBe(4);
    expect(results.every((r) => r.kind === "query")).toBe(true);
  });

  test("wildcard returns all mutations", () => {
    const results = searchSchema(index, { pattern: "*", kind: "mutation" });
    expect(results.length).toBe(4);
    expect(results.every((r) => r.kind === "mutation")).toBe(true);
  });

  test("search by name substring", () => {
    const results = searchSchema(index, { pattern: "user" });
    expect(results.length).toBeGreaterThan(0);
    // Should find user query, users query, createUser mutation, User type, etc.
    const names = results.map((r) => r.name);
    expect(names).toContain("user");
    expect(names).toContain("users");
  });

  test("search is case-insensitive", () => {
    const lower = searchSchema(index, { pattern: "user" });
    const upper = searchSchema(index, { pattern: "USER" });
    const mixed = searchSchema(index, { pattern: "User" });
    expect(lower.length).toBe(upper.length);
    expect(lower.length).toBe(mixed.length);
  });

  test("filter by kind: query", () => {
    const results = searchSchema(index, { pattern: "user", kind: "query" });
    expect(results.every((r) => r.kind === "query")).toBe(true);
    const names = results.map((r) => r.name);
    expect(names).toContain("user");
    expect(names).toContain("users");
  });

  test("filter by kind: mutation", () => {
    const results = searchSchema(index, { pattern: "user", kind: "mutation" });
    expect(results.every((r) => r.kind === "mutation")).toBe(true);
    const names = results.map((r) => r.name);
    expect(names).toContain("createUser");
    expect(names).toContain("updateUser");
    expect(names).toContain("deleteUser");
  });

  test("filter by kind: enum", () => {
    const results = searchSchema(index, { pattern: "*", kind: "enum" });
    expect(results.every((r) => r.kind === "enum")).toBe(true);
    const names = results.map((r) => r.name);
    expect(names).toContain("UserRole");
    expect(names).toContain("PostStatus");
    expect(names).toContain("ContentType");
  });

  test("filter by kind: input", () => {
    const results = searchSchema(index, { pattern: "*", kind: "input" });
    expect(results.every((r) => r.kind === "input")).toBe(true);
    const names = results.map((r) => r.name);
    expect(names).toContain("UserFilter");
    expect(names).toContain("CreateUserInput");
    expect(names).toContain("UpdateUserInput");
    expect(names).toContain("CreatePostInput");
  });

  test("filter by kind: union", () => {
    const results = searchSchema(index, { pattern: "*", kind: "union" });
    const names = results.map((r) => r.name);
    expect(names).toContain("SearchResult");
  });

  test("searches within field names", () => {
    const results = searchSchema(index, { pattern: "email" });
    // Should find User type (has email field) and input types
    expect(results.length).toBeGreaterThan(0);
    const withParent = results.filter((r) => r.parentType);
    expect(withParent.length).toBeGreaterThan(0);
  });

  test("respects limit", () => {
    const results = searchSchema(index, { pattern: "*", limit: 3 });
    expect(results.length).toBe(3);
  });

  test("exact match scores highest", () => {
    const results = searchSchema(index, { pattern: "user", kind: "query" });
    // "user" (exact) should come before "users" (prefix)
    expect(results[0].name).toBe("user");
  });

  test("empty pattern works like wildcard", () => {
    const star = searchSchema(index, { pattern: "*", kind: "enum" });
    const empty = searchSchema(index, { pattern: "", kind: "enum" });
    expect(star.length).toBe(empty.length);
  });

  test("no results returns empty array", () => {
    const results = searchSchema(index, { pattern: "xyznonexistent" });
    expect(results).toEqual([]);
  });

  test("enum signature includes values preview", () => {
    const results = searchSchema(index, { pattern: "UserRole", kind: "enum" });
    expect(results.length).toBe(1);
    expect(results[0].signature).toContain("ADMIN");
    expect(results[0].signature).toContain("MODERATOR");
  });

  test("query signature includes args and return type", () => {
    const results = searchSchema(index, { pattern: "user", kind: "query" });
    const userResult = results.find((r) => r.name === "user")!;
    expect(userResult.signature).toContain("id: ID!");
    expect(userResult.signature).toContain(": User");
  });
});

// ============================================================
// formatSearchResults
// ============================================================

describe("formatSearchResults", () => {
  test("groups results by kind", () => {
    const results = searchSchema(index, { pattern: "user" });
    const formatted = formatSearchResults(results);
    expect(formatted).toContain("Query:");
    expect(formatted).toContain("Mutation:");
  });

  test("empty results", () => {
    const formatted = formatSearchResults([]);
    expect(formatted).toBe("No results found.");
  });

  test("indents signatures", () => {
    const results = searchSchema(index, { pattern: "*", kind: "query" });
    const formatted = formatSearchResults(results);
    const lines = formatted.split("\n");
    const signatureLines = lines.filter((l) => l.startsWith("  "));
    expect(signatureLines.length).toBeGreaterThan(0);
  });
});
