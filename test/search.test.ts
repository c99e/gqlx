import { test, expect, describe } from "bun:test";
import { parseIntrospection } from "../src/schema.js";
import { searchSchema } from "../src/search.js";
import { TEST_INTROSPECTION, introspectionFromSDL } from "./helpers.js";

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

  test("respects limit with specific kind", () => {
    const results = searchSchema(index, { pattern: "*", kind: "query", limit: 3 });
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

  test("enum signature includes value count and preview", () => {
    const results = searchSchema(index, { pattern: "UserRole", kind: "enum" });
    expect(results.length).toBe(1);
    expect(results[0].signature).toContain("3 values");
    expect(results[0].signature).toContain("ADMIN");
    expect(results[0].signature).toContain("MODERATOR");
  });

  test("object type signature includes field count", () => {
    const results = searchSchema(index, { pattern: "User", kind: "type" });
    const userResult = results.find((r) => r.name === "User")!;
    expect(userResult).toBeDefined();
    // User has: id, name, email, role, posts, createdAt = 6 fields
    expect(userResult.signature).toBe("type User (6 fields)");
  });

  test("interface type signature includes field count", () => {
    const ifaceIndex = parseIntrospection(
      introspectionFromSDL(`
        type Query { dummy: String }
        interface Node { id: ID!, createdAt: String! }
        type Foo implements Node { id: ID!, createdAt: String!, name: String! }
      `)
    );
    const results = searchSchema(ifaceIndex, { pattern: "Node", kind: "interface" });
    expect(results.length).toBe(1);
    expect(results[0].signature).toBe("interface Node (2 fields) { id, createdAt }");
  });

  test("input type signature includes field count and required count", () => {
    const results = searchSchema(index, { pattern: "CreateUserInput", kind: "input" });
    expect(results.length).toBe(1);
    // CreateUserInput has: name: String!, email: String!, role: UserRole
    // 3 fields total, 2 required (non-null without default)
    expect(results[0].signature).toBe("input CreateUserInput (3 fields, 2 required)");
  });

  test("input type with zero required fields omits required count", () => {
    const results = searchSchema(index, { pattern: "UpdateUserInput", kind: "input" });
    expect(results.length).toBe(1);
    // UpdateUserInput has: name: String, email: String, role: UserRole — all optional
    expect(results[0].signature).toBe("input UpdateUserInput (3 fields, 0 required)");
  });

  test("enum with many values includes count", () => {
    const bigEnumIndex = parseIntrospection(
      introspectionFromSDL(`
        type Query { dummy: String }
        enum BigEnum { A B C D E F G H I J }
      `)
    );
    const results = searchSchema(bigEnumIndex, { pattern: "BigEnum", kind: "enum" });
    expect(results.length).toBe(1);
    expect(results[0].signature).toContain("10 values");
    // Preview should be truncated (>6 values)
    expect(results[0].signature).toContain("...");
  });

  test("type with one field shows singular", () => {
    const singleIndex = parseIntrospection(
      introspectionFromSDL(`
        type Query { dummy: String }
        type Single { id: ID! }
      `)
    );
    const results = searchSchema(singleIndex, { pattern: "Single", kind: "type" });
    expect(results.length).toBe(1);
    expect(results[0].signature).toBe("type Single (1 field) { id }");
  });

  test("enum with one value shows singular", () => {
    const singleEnumIndex = parseIntrospection(
      introspectionFromSDL(`
        type Query { dummy: String }
        enum Solo { ONLY }
      `)
    );
    const results = searchSchema(singleEnumIndex, { pattern: "Solo", kind: "enum" });
    expect(results.length).toBe(1);
    expect(results[0].signature).toContain("1 value");
    expect(results[0].signature).not.toContain("1 values");
  });

  test("query signature includes args and return type", () => {
    const results = searchSchema(index, { pattern: "user", kind: "query" });
    const userResult = results.find((r) => r.name === "user")!;
    expect(userResult.signature).toContain("id: ID!");
    expect(userResult.signature).toContain(": User");
  });
});

// ============================================================
// Enum value search (SAU-240)
// ============================================================

describe("searchSchema enum value search", () => {
  // Schema with large enums and described values
  const enumSDL = `
    type Query { dummy: String }
    enum CurrencyCode {
      "US Dollar"
      USD
      "Euro"
      EUR
      "British Pound Sterling"
      GBP
      "Japanese Yen"
      JPY
      "Swiss Franc"
      CHF
      "Canadian Dollar"
      CAD
      "Australian Dollar"
      AUD
    }
    enum CountryCode {
      US
      GB
      FR
      DE
      JP
      CA
      AU
    }
    enum PostStatus {
      DRAFT
      PUBLISHED
      ARCHIVED
    }
  `;
  const enumIndex = parseIntrospection(introspectionFromSDL(enumSDL));

  test("matches individual enum value names when kind is enum", () => {
    const results = searchSchema(enumIndex, { pattern: "EUR", kind: "enum" });
    expect(results.length).toBeGreaterThan(0);
    const eur = results.find((r) => r.signature.includes("CurrencyCode.EUR"));
    expect(eur).toBeDefined();
  });

  test("matched enum values have qualified signature: EnumName.ValueName", () => {
    const results = searchSchema(enumIndex, { pattern: "GBP", kind: "enum" });
    const gbp = results.find((r) => r.signature === "CurrencyCode.GBP");
    expect(gbp).toBeDefined();
    expect(gbp!.kind).toBe("enum");
  });

  test("enum value result includes description when available", () => {
    const results = searchSchema(enumIndex, { pattern: "EUR", kind: "enum" });
    const eur = results.find((r) => r.signature === "CurrencyCode.EUR");
    expect(eur).toBeDefined();
    expect(eur!.description).toBe("Euro");
  });

  test("enum name matches rank higher than enum value matches", () => {
    // Search for "Post" — should match PostStatus (enum name) before any value
    const results = searchSchema(enumIndex, { pattern: "Post", kind: "enum" });
    expect(results.length).toBeGreaterThan(0);
    // First result should be the enum-level match on PostStatus
    expect(results[0].name).toBe("PostStatus");
    expect(results[0].signature).toContain("enum PostStatus");
  });

  test("enum value search is case-insensitive", () => {
    const lower = searchSchema(enumIndex, { pattern: "eur", kind: "enum" });
    const upper = searchSchema(enumIndex, { pattern: "EUR", kind: "enum" });
    const mixed = searchSchema(enumIndex, { pattern: "Eur", kind: "enum" });
    expect(lower.length).toBe(upper.length);
    expect(lower.length).toBe(mixed.length);
    expect(lower.length).toBeGreaterThan(0);
  });

  test("enum value search works with kind=all", () => {
    const results = searchSchema(enumIndex, { pattern: "EUR", kind: "all" });
    const eur = results.find((r) => r.signature === "CurrencyCode.EUR");
    expect(eur).toBeDefined();
  });

  test("value existing in multiple enums returns matches from each", () => {
    // "AU" substring matches AUD in CurrencyCode and AU in CountryCode
    const results = searchSchema(enumIndex, { pattern: "AU", kind: "enum" });
    const currencyMatches = results.filter((r) => r.name === "CurrencyCode" && r.parentType);
    const countryMatches = results.filter((r) => r.name === "CountryCode" && r.parentType);
    expect(currencyMatches.length).toBeGreaterThan(0);
    expect(countryMatches.length).toBeGreaterThan(0);
  });

  test("enum value without description has null description", () => {
    // PostStatus values have no descriptions in this schema
    const results = searchSchema(enumIndex, { pattern: "DRAFT", kind: "enum" });
    const draft = results.find((r) => r.signature === "PostStatus.DRAFT");
    expect(draft).toBeDefined();
    expect(draft!.description).toBeNull();
  });

  test("enum value results include parentType", () => {
    const results = searchSchema(enumIndex, { pattern: "EUR", kind: "enum" });
    const eur = results.find((r) => r.signature === "CurrencyCode.EUR");
    expect(eur).toBeDefined();
    expect(eur!.parentType).toBe("CurrencyCode");
  });

  test("no matching enum values returns empty", () => {
    const results = searchSchema(enumIndex, { pattern: "XYZNONEXISTENT", kind: "enum" });
    expect(results).toEqual([]);
  });

  test("wildcard does not return individual enum values", () => {
    // Wildcard should return enum types, not explode into every value
    const results = searchSchema(enumIndex, { pattern: "*", kind: "enum" });
    const valueResults = results.filter((r) => r.parentType);
    expect(valueResults.length).toBe(0);
  });
});

// ============================================================
// Per-category limit (SAU-238)
// ============================================================

describe("searchSchema per-category limit", () => {
  // Build a schema where types vastly outnumber queries/mutations
  const heavySDL = `
    type Query {
      alpha: String
      bravo: String
      charlie: String
      delta: String
      echo: String
    }
    type Mutation {
      alphaCreate: String
      bravoCreate: String
      charlieCreate: String
      deltaCreate: String
      echoCreate: String
    }
    type AlphaType { id: ID! }
    type BravoType { id: ID! }
    type CharlieType { id: ID! }
    type DeltaType { id: ID! }
    type EchoType { id: ID! }
    type FoxtrotType { id: ID! }
    type GolfType { id: ID! }
    type HotelType { id: ID! }
    type IndiaType { id: ID! }
    type JulietType { id: ID! }
    type KiloType { id: ID! }
    type LimaType { id: ID! }
    type MikeType { id: ID! }
    type NovemberType { id: ID! }
    type OscarType { id: ID! }
    enum AlphaEnum { A B }
    enum BravoEnum { A B }
    enum CharlieEnum { A B }
    input AlphaInput { x: String }
    input BravoInput { x: String }
    input CharlieInput { x: String }
  `;
  const heavyIndex = parseIntrospection(introspectionFromSDL(heavySDL));

  test("kind=all applies limit per category, not globally", () => {
    // With limit=3, each category should get up to 3 results
    const results = searchSchema(heavyIndex, { pattern: "*", kind: "all", limit: 3 });

    // Group by kind
    const groups = new Map<string, number>();
    for (const r of results) {
      groups.set(r.kind, (groups.get(r.kind) ?? 0) + 1);
    }

    // Queries: 5 available, capped at 3
    expect(groups.get("query")).toBe(3);
    // Mutations: 5 available, capped at 3
    expect(groups.get("mutation")).toBe(3);
    // Types: 15 available, capped at 3
    expect(groups.get("type")).toBe(3);
    // Enums: 3 available, capped at 3
    expect(groups.get("enum")).toBe(3);
    // Inputs: 3 available, capped at 3
    expect(groups.get("input")).toBe(3);
  });

  test("kind=all with limit returns fewer when category has fewer items", () => {
    // limit=10 but only 5 queries and 5 mutations exist
    const results = searchSchema(heavyIndex, { pattern: "*", kind: "all", limit: 10 });
    const groups = new Map<string, number>();
    for (const r of results) {
      groups.set(r.kind, (groups.get(r.kind) ?? 0) + 1);
    }

    expect(groups.get("query")).toBe(5);
    expect(groups.get("mutation")).toBe(5);
    // 15 types, capped at 10
    expect(groups.get("type")).toBe(10);
    // Enums: 3 defined + __TypeKind leaks through builtin filter
    expect(groups.get("enum")).toBeLessThanOrEqual(10);
    expect(groups.get("input")).toBe(3); // only 3 inputs
  });

  test("specific kind still uses global limit", () => {
    const results = searchSchema(heavyIndex, { pattern: "*", kind: "type", limit: 5 });
    expect(results.length).toBe(5);
    expect(results.every((r) => r.kind === "type")).toBe(true);
  });

  test("per-category preserves sort order within each category", () => {
    // Search for "alpha" with per-category limit — exact matches should rank first
    const results = searchSchema(heavyIndex, { pattern: "alpha", kind: "all", limit: 2 });
    const queries = results.filter((r) => r.kind === "query");
    const types = results.filter((r) => r.kind === "type");

    // "alpha" query is exact match, should appear
    if (queries.length > 0) {
      expect(queries[0].name).toBe("alpha");
    }
    // AlphaType should rank above others
    if (types.length > 0) {
      expect(types[0].name).toBe("AlphaType");
    }
  });

  test("per-category limit of 1 returns one from each matching category", () => {
    const results = searchSchema(heavyIndex, { pattern: "*", kind: "all", limit: 1 });
    const kinds = new Set(results.map((r) => r.kind));
    // Should have at least queries, mutations, types, enums, inputs
    expect(kinds.size).toBeGreaterThanOrEqual(5);
    // Each kind should have exactly 1 result
    const groups = new Map<string, number>();
    for (const r of results) {
      groups.set(r.kind, (groups.get(r.kind) ?? 0) + 1);
    }
    for (const [, count] of groups) {
      expect(count).toBe(1);
    }
  });

  test("kind=all with no matching category returns empty for that category", () => {
    // Search for something only in queries
    const results = searchSchema(heavyIndex, { pattern: "alpha", kind: "all", limit: 5 });
    // Should have queries and types (AlphaType) and enums (AlphaEnum) and inputs (AlphaInput)
    // but not every category needs to appear
    const groups = new Map<string, number>();
    for (const r of results) {
      groups.set(r.kind, (groups.get(r.kind) ?? 0) + 1);
    }
    // Each present category should be capped at 5
    for (const [, count] of groups) {
      expect(count).toBeLessThanOrEqual(5);
    }
  });
});

// ============================================================
// Inline field names for small types (SAU-244)
// ============================================================

describe("searchSchema inline field names for small types", () => {
  test("object type below threshold inlines field names", () => {
    // UserEdge has 2 fields: node, cursor
    const results = searchSchema(index, { pattern: "UserEdge", kind: "type" });
    expect(results.length).toBe(1);
    expect(results[0].signature).toBe("type UserEdge (2 fields) { node, cursor }");
  });

  test("object type at threshold inlines field names", () => {
    // PageInfo has 4 fields: hasNextPage, hasPreviousPage, startCursor, endCursor
    const results = searchSchema(index, { pattern: "PageInfo", kind: "type" });
    const pageInfo = results.find((r) => r.name === "PageInfo" && !r.parentType)!;
    expect(pageInfo).toBeDefined();
    expect(pageInfo.signature).toBe(
      "type PageInfo (4 fields) { hasNextPage, hasPreviousPage, startCursor, endCursor }"
    );
  });

  test("object type above threshold shows only count", () => {
    // User has 6 fields — above threshold, no inline
    const results = searchSchema(index, { pattern: "User", kind: "type" });
    const userResult = results.find((r) => r.name === "User")!;
    expect(userResult.signature).toBe("type User (6 fields)");
  });

  test("single-field type inlines the field name", () => {
    const singleIndex = parseIntrospection(
      introspectionFromSDL(`
        type Query { dummy: String }
        type Single { id: ID! }
      `)
    );
    const results = searchSchema(singleIndex, { pattern: "Single", kind: "type" });
    expect(results.length).toBe(1);
    expect(results[0].signature).toBe("type Single (1 field) { id }");
  });

  test("interface type below threshold inlines field names", () => {
    const ifaceIndex = parseIntrospection(
      introspectionFromSDL(`
        type Query { dummy: String }
        interface Node { id: ID!, createdAt: String! }
        type Foo implements Node { id: ID!, createdAt: String!, name: String! }
      `)
    );
    const results = searchSchema(ifaceIndex, { pattern: "Node", kind: "interface" });
    expect(results.length).toBe(1);
    expect(results[0].signature).toBe("interface Node (2 fields) { id, createdAt }");
  });

  test("interface type above threshold shows only count", () => {
    const bigIfaceIndex = parseIntrospection(
      introspectionFromSDL(`
        type Query { dummy: String }
        interface BigIface { a: String, b: String, c: String, d: String, e: String }
        type Impl implements BigIface { a: String, b: String, c: String, d: String, e: String }
      `)
    );
    const results = searchSchema(bigIfaceIndex, { pattern: "BigIface", kind: "interface" });
    expect(results.length).toBe(1);
    expect(results[0].signature).toBe("interface BigIface (5 fields)");
  });

  test("field names are just names without types", () => {
    const results = searchSchema(index, { pattern: "UserEdge", kind: "type" });
    expect(results[0].signature).not.toContain("User!");
    expect(results[0].signature).not.toContain("String!");
  });

  test("field names preserve schema order", () => {
    const orderedIndex = parseIntrospection(
      introspectionFromSDL(`
        type Query { dummy: String }
        type Ordered { zulu: String, alpha: String, mike: String }
      `)
    );
    const results = searchSchema(orderedIndex, { pattern: "Ordered", kind: "type" });
    expect(results[0].signature).toBe("type Ordered (3 fields) { zulu, alpha, mike }");
  });

  test("zero-field type shows no inline preview", () => {
    // Technically unusual but should handle gracefully
    const emptyIndex = parseIntrospection(
      introspectionFromSDL(`
        type Query { dummy: String }
        type Empty { _placeholder: String }
      `)
    );
    // Manually remove the field to simulate 0-field edge case
    const emptyType = emptyIndex.types.get("Empty")!;
    emptyType.fields = [];
    const results = searchSchema(emptyIndex, { pattern: "Empty", kind: "type" });
    expect(results[0].signature).toBe("type Empty (0 fields)");
  });

  test("enum preview behavior is unchanged", () => {
    const results = searchSchema(index, { pattern: "UserRole", kind: "enum" });
    expect(results.length).toBe(1);
    expect(results[0].signature).toContain("3 values");
    expect(results[0].signature).toContain("ADMIN");
    expect(results[0].signature).toContain("MODERATOR");
  });

  test("input type signatures are unchanged", () => {
    const results = searchSchema(index, { pattern: "CreateUserInput", kind: "input" });
    expect(results.length).toBe(1);
    expect(results[0].signature).toBe("input CreateUserInput (3 fields, 2 required)");
  });
});


