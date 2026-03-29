import { test, expect, describe } from "bun:test";
import { parseIntrospection, renderTypeRef, formatTypeSDL, formatOperationSignature } from "../src/schema.js";
import { TEST_INTROSPECTION, introspectionFromSDL } from "./helpers.js";
import type { IntrospectionTypeRef } from "../src/types.js";

const index = parseIntrospection(TEST_INTROSPECTION);

// ============================================================
// renderTypeRef
// ============================================================

describe("renderTypeRef", () => {
  test("simple named type", () => {
    const ref: IntrospectionTypeRef = { kind: "OBJECT", name: "User" };
    expect(renderTypeRef(ref)).toBe("User");
  });

  test("non-null type", () => {
    const ref: IntrospectionTypeRef = {
      kind: "NON_NULL",
      ofType: { kind: "OBJECT", name: "User" },
    };
    expect(renderTypeRef(ref)).toBe("User!");
  });

  test("list type", () => {
    const ref: IntrospectionTypeRef = {
      kind: "LIST",
      ofType: { kind: "OBJECT", name: "User" },
    };
    expect(renderTypeRef(ref)).toBe("[User]");
  });

  test("non-null list of non-null", () => {
    const ref: IntrospectionTypeRef = {
      kind: "NON_NULL",
      ofType: {
        kind: "LIST",
        ofType: {
          kind: "NON_NULL",
          ofType: { kind: "OBJECT", name: "User" },
        },
      },
    };
    expect(renderTypeRef(ref)).toBe("[User!]!");
  });

  test("scalar type", () => {
    const ref: IntrospectionTypeRef = { kind: "SCALAR", name: "String" };
    expect(renderTypeRef(ref)).toBe("String");
  });
});

// ============================================================
// parseIntrospection
// ============================================================

describe("parseIntrospection", () => {
  test("extracts queries", () => {
    expect(index.queries.length).toBe(4);
    const names = index.queries.map((q) => q.name);
    expect(names).toContain("user");
    expect(names).toContain("users");
    expect(names).toContain("post");
    expect(names).toContain("searchContent");
  });

  test("extracts mutations", () => {
    expect(index.mutations.length).toBe(4);
    const names = index.mutations.map((m) => m.name);
    expect(names).toContain("createUser");
    expect(names).toContain("updateUser");
    expect(names).toContain("deleteUser");
    expect(names).toContain("createPost");
  });

  test("extracts types (excluding root and builtins)", () => {
    expect(index.types.has("User")).toBe(true);
    expect(index.types.has("Post")).toBe(true);
    expect(index.types.has("UserRole")).toBe(true);
    expect(index.types.has("UserFilter")).toBe(true);
    expect(index.types.has("SearchResult")).toBe(true);

    // Root types excluded from types map
    expect(index.types.has("Query")).toBe(false);
    expect(index.types.has("Mutation")).toBe(false);

    // Introspection types excluded
    expect(index.types.has("__Schema")).toBe(false);
    expect(index.types.has("__Type")).toBe(false);
  });

  test("parses query arguments", () => {
    const userQuery = index.queries.find((q) => q.name === "user")!;
    expect(userQuery.args.length).toBe(1);
    expect(userQuery.args[0].name).toBe("id");
    expect(userQuery.args[0].type).toBe("ID!");
  });

  test("parses object type fields", () => {
    const user = index.types.get("User")!;
    expect(user.kind).toBe("OBJECT");
    const fieldNames = user.fields.map((f) => f.name);
    expect(fieldNames).toContain("id");
    expect(fieldNames).toContain("name");
    expect(fieldNames).toContain("email");
    expect(fieldNames).toContain("role");
    expect(fieldNames).toContain("posts");
  });

  test("parses field arguments", () => {
    const user = index.types.get("User")!;
    const postsField = user.fields.find((f) => f.name === "posts")!;
    expect(postsField.args.length).toBe(1);
    expect(postsField.args[0].name).toBe("first");
    expect(postsField.args[0].type).toBe("Int");
  });

  test("parses enum values", () => {
    const role = index.types.get("UserRole")!;
    expect(role.kind).toBe("ENUM");
    const vals = role.enumValues.map((v) => v.name);
    expect(vals).toEqual(["ADMIN", "USER", "MODERATOR"]);
  });

  test("parses input type fields", () => {
    const input = index.types.get("CreateUserInput")!;
    expect(input.kind).toBe("INPUT_OBJECT");
    const fieldNames = input.inputFields.map((f) => f.name);
    expect(fieldNames).toContain("name");
    expect(fieldNames).toContain("email");
    expect(fieldNames).toContain("role");
  });

  test("parses union possible types", () => {
    const union = index.types.get("SearchResult")!;
    expect(union.kind).toBe("UNION");
    expect(union.possibleTypes).toContain("User");
    expect(union.possibleTypes).toContain("Post");
  });
});

// ============================================================
// formatOperationSignature
// ============================================================

describe("formatOperationSignature", () => {
  test("formats simple query", () => {
    const userQuery = index.queries.find((q) => q.name === "user")!;
    const sig = formatOperationSignature(userQuery);
    expect(sig).toBe("user(id: ID!): User");
  });

  test("formats query with multiple args", () => {
    const usersQuery = index.queries.find((q) => q.name === "users")!;
    const sig = formatOperationSignature(usersQuery);
    expect(sig).toContain("users(");
    expect(sig).toContain("filter: UserFilter");
    expect(sig).toContain("first: Int");
    expect(sig).toContain("after: String");
    expect(sig).toContain("): UserConnection!");
  });
});

// ============================================================
// formatTypeSDL
// ============================================================

describe("formatTypeSDL", () => {
  test("formats object type", () => {
    const user = index.types.get("User")!;
    const sdl = formatTypeSDL(user);
    expect(sdl).toContain("type User {");
    expect(sdl).toContain("  id: ID!");
    expect(sdl).toContain("  name: String!");
    expect(sdl).toContain("  role: UserRole!");
    expect(sdl).toContain("}");
  });

  test("formats enum type", () => {
    const role = index.types.get("UserRole")!;
    const sdl = formatTypeSDL(role);
    expect(sdl).toContain("enum UserRole {");
    expect(sdl).toContain("  ADMIN");
    expect(sdl).toContain("  USER");
    expect(sdl).toContain("  MODERATOR");
  });

  test("formats input type", () => {
    const input = index.types.get("CreateUserInput")!;
    const sdl = formatTypeSDL(input);
    expect(sdl).toContain("input CreateUserInput {");
    expect(sdl).toContain("  name: String!");
    expect(sdl).toContain("  email: String!");
  });

  test("formats union type", () => {
    const union = index.types.get("SearchResult")!;
    const sdl = formatTypeSDL(union);
    expect(sdl).toContain("union SearchResult = ");
    expect(sdl).toContain("User");
    expect(sdl).toContain("Post");
  });

  test("expands referenced enums when index provided", () => {
    const user = index.types.get("User")!;
    const sdl = formatTypeSDL(user, { index });
    expect(sdl).toContain("--- Referenced Types ---");
    expect(sdl).toContain("enum UserRole {");
  });

  test("does not expand without index", () => {
    const user = index.types.get("User")!;
    const sdl = formatTypeSDL(user);
    expect(sdl).not.toContain("--- Referenced Types ---");
  });

  test("includes field arguments in SDL", () => {
    const user = index.types.get("User")!;
    const sdl = formatTypeSDL(user);
    expect(sdl).toContain("posts(first: Int): [Post!]!");
  });
});

// ============================================================
// formatTypeSDL — compact vs verbose
// ============================================================

describe("formatTypeSDL compact vs verbose", () => {
  const DESCRIBED_SDL = `
    type Query {
      "Get a product by ID"
      product(id: ID!): Product
    }

    type Mutation {
      "Create a new product"
      createProduct(input: CreateProductInput!): Product!
    }

    """A product in the catalog"""
    type Product {
      "Unique identifier"
      id: ID!
      "Product display name"
      title: String!
      "Current status"
      status: ProductStatus!
      "Product tags"
      tags: [String!]!
    }

    """Status of a product"""
    enum ProductStatus {
      "Product is active"
      ACTIVE
      "Product is in draft"
      DRAFT
      ARCHIVED
    }

    """Input for creating a product"""
    input CreateProductInput {
      "Product display name"
      title: String!
      "Initial status"
      status: ProductStatus
    }
  `;
  const describedIndex = parseIntrospection(introspectionFromSDL(DESCRIBED_SDL));

  // --- compact mode (default) ---

  test("compact mode omits type-level description", () => {
    const product = describedIndex.types.get("Product")!;
    const sdl = formatTypeSDL(product);
    expect(sdl).not.toContain("A product in the catalog");
  });

  test("compact mode omits field descriptions", () => {
    const product = describedIndex.types.get("Product")!;
    const sdl = formatTypeSDL(product);
    expect(sdl).not.toContain("Unique identifier");
    expect(sdl).not.toContain("Product display name");
    expect(sdl).not.toContain("Current status");
  });

  test("compact mode shows field names, types, and arguments", () => {
    const product = describedIndex.types.get("Product")!;
    const sdl = formatTypeSDL(product);
    expect(sdl).toContain("id: ID!");
    expect(sdl).toContain("title: String!");
    expect(sdl).toContain("status: ProductStatus!");
    expect(sdl).toContain("tags: [String!]!");
  });

  test("compact mode expands referenced types when index provided", () => {
    const product = describedIndex.types.get("Product")!;
    const sdl = formatTypeSDL(product, { index: describedIndex });
    expect(sdl).toContain("--- Referenced Types ---");
    expect(sdl).toContain("enum ProductStatus {");
  });

  test("compact enum omits value descriptions", () => {
    const status = describedIndex.types.get("ProductStatus")!;
    const sdl = formatTypeSDL(status);
    expect(sdl).not.toContain("# Product is active");
    expect(sdl).not.toContain("# Status of a product");
    expect(sdl).toContain("ACTIVE");
    expect(sdl).toContain("DRAFT");
  });

  test("compact input omits field descriptions", () => {
    const input = describedIndex.types.get("CreateProductInput")!;
    const sdl = formatTypeSDL(input);
    expect(sdl).not.toContain("# Input for creating a product");
    expect(sdl).not.toContain("# Product display name");
    expect(sdl).toContain("title: String!");
  });

  // --- verbose mode ---

  test("verbose mode includes type-level description", () => {
    const product = describedIndex.types.get("Product")!;
    const sdl = formatTypeSDL(product, { verbose: true });
    expect(sdl).toContain("# A product in the catalog");
  });

  test("verbose mode includes field descriptions", () => {
    const product = describedIndex.types.get("Product")!;
    const sdl = formatTypeSDL(product, { verbose: true });
    expect(sdl).toContain("# Unique identifier");
    expect(sdl).toContain("# Product display name");
    expect(sdl).toContain("# Current status");
  });

  test("verbose mode expands referenced types when index provided", () => {
    const product = describedIndex.types.get("Product")!;
    const sdl = formatTypeSDL(product, { index: describedIndex, verbose: true });
    expect(sdl).toContain("--- Referenced Types ---");
    expect(sdl).toContain("enum ProductStatus {");
  });

  test("verbose enum includes value descriptions", () => {
    const status = describedIndex.types.get("ProductStatus")!;
    const sdl = formatTypeSDL(status, { verbose: true });
    expect(sdl).toContain("# Status of a product");
    expect(sdl).toContain("# Product is active");
    expect(sdl).toContain("ACTIVE");
  });

  test("verbose input includes field descriptions", () => {
    const input = describedIndex.types.get("CreateProductInput")!;
    const sdl = formatTypeSDL(input, { verbose: true });
    expect(sdl).toContain("# Input for creating a product");
    expect(sdl).toContain("# Product display name");
  });

  // --- referenced type verbosity propagation ---

  test("referenced types in compact mode omit descriptions", () => {
    const product = describedIndex.types.get("Product")!;
    const sdl = formatTypeSDL(product, { index: describedIndex });
    expect(sdl).toContain("enum ProductStatus {");
    expect(sdl).not.toContain("# Status of a product");
    expect(sdl).not.toContain("# Product is active");
  });

  test("referenced types in verbose mode include descriptions", () => {
    const product = describedIndex.types.get("Product")!;
    const sdl = formatTypeSDL(product, { index: describedIndex, verbose: true });
    expect(sdl).toContain("enum ProductStatus {");
    expect(sdl).toContain("# Status of a product");
    expect(sdl).toContain("# Product is active");
  });
});

// ============================================================
// formatTypeSDL — pattern filter (SAU-242)
// ============================================================

describe("formatTypeSDL pattern filter", () => {
  // Schema with a type that has many fields for pattern testing
  const LARGE_SDL = `
    type Query {
      product(id: ID!): Product
    }

    type Product {
      id: ID!
      title: String!
      description: String
      handle: String!
      vendor: String
      productType: String
      status: ProductStatus!
      tags: [String!]!
      createdAt: String!
      updatedAt: String!
      publishedAt: String
      priceRange: PriceRange!
      images(first: Int): [Image!]!
      variants(first: Int): [Variant!]!
      metafields(namespace: String, first: Int): [Metafield!]!
    }

    type PriceRange {
      minPrice: Money!
      maxPrice: Money!
    }

    type Money {
      amount: String!
      currencyCode: String!
    }

    type Image {
      id: ID!
      url: String!
      altText: String
    }

    type Variant {
      id: ID!
      title: String!
      price: Money!
    }

    type Metafield {
      id: ID!
      namespace: String!
      key: String!
      value: String!
    }

    enum ProductStatus {
      ACTIVE
      DRAFT
      ARCHIVED
    }

    input ProductInput {
      title: String!
      description: String
      handle: String
      vendor: String
      productType: String
      status: ProductStatus
      tags: [String!]
    }
  `;
  const largeIndex = parseIntrospection(introspectionFromSDL(LARGE_SDL));

  test("filters object type fields by name substring", () => {
    const product = largeIndex.types.get("Product")!;
    const sdl = formatTypeSDL(product, { pattern: "price" });
    expect(sdl).toContain("priceRange");
    expect(sdl).not.toContain("title");
    expect(sdl).not.toContain("description");
    expect(sdl).not.toContain("tags");
  });

  test("pattern matching is case-insensitive", () => {
    const product = largeIndex.types.get("Product")!;
    const lower = formatTypeSDL(product, { pattern: "price" });
    const upper = formatTypeSDL(product, { pattern: "PRICE" });
    const mixed = formatTypeSDL(product, { pattern: "Price" });
    expect(lower).toBe(upper);
    expect(lower).toBe(mixed);
  });

  test("filters fields by type substring", () => {
    const product = largeIndex.types.get("Product")!;
    const sdl = formatTypeSDL(product, { pattern: "Image" });
    expect(sdl).toContain("images");
    expect(sdl).not.toContain("title");
    expect(sdl).not.toContain("vendor");
  });

  test("matches field argument types", () => {
    const product = largeIndex.types.get("Product")!;
    const sdl = formatTypeSDL(product, { pattern: "namespace" });
    // metafields has a 'namespace' argument
    expect(sdl).toContain("metafields");
    expect(sdl).not.toContain("title");
    expect(sdl).not.toContain("vendor");
  });

  test("no matching fields produces empty body", () => {
    const product = largeIndex.types.get("Product")!;
    const sdl = formatTypeSDL(product, { pattern: "xyznonexistent" });
    expect(sdl).toContain("type Product");
    expect(sdl).toContain("{");
    expect(sdl).toContain("}");
    // No field lines between braces
    const fieldLines = sdl.split("\n").filter((l) => l.startsWith("  ") && !l.startsWith("  #"));
    expect(fieldLines.length).toBe(0);
  });

  test("omitting pattern returns all fields unchanged", () => {
    const product = largeIndex.types.get("Product")!;
    const withPattern = formatTypeSDL(product);
    const withoutPattern = formatTypeSDL(product, {});
    expect(withPattern).toBe(withoutPattern);
    expect(withPattern).toContain("title");
    expect(withPattern).toContain("priceRange");
    expect(withPattern).toContain("images");
  });

  test("filters input type fields by name substring", () => {
    const input = largeIndex.types.get("ProductInput")!;
    const sdl = formatTypeSDL(input, { pattern: "title" });
    expect(sdl).toContain("title");
    expect(sdl).not.toContain("vendor");
    expect(sdl).not.toContain("tags");
  });

  test("filters input type fields by type substring", () => {
    const input = largeIndex.types.get("ProductInput")!;
    const sdl = formatTypeSDL(input, { pattern: "ProductStatus" });
    expect(sdl).toContain("status");
    expect(sdl).not.toContain("title");
  });

  test("pattern with compact mode works correctly", () => {
    const product = largeIndex.types.get("Product")!;
    const sdl = formatTypeSDL(product, { pattern: "price", verbose: false });
    expect(sdl).toContain("priceRange");
    expect(sdl).not.toContain("title");
    // Compact mode — no descriptions
    expect(sdl).not.toContain("#");
  });

  test("pattern with verbose mode works correctly", () => {
    const describedSDL = `
      type Query { product(id: ID!): Product }
      """A product"""
      type Product {
        "Unique identifier"
        id: ID!
        "Product display name"
        title: String!
        "Current status"
        status: ProductStatus!
      }
      enum ProductStatus { ACTIVE DRAFT }
    `;
    const idx = parseIntrospection(introspectionFromSDL(describedSDL));
    const product = idx.types.get("Product")!;
    const sdl = formatTypeSDL(product, { pattern: "title", verbose: true });
    expect(sdl).toContain("title: String!");
    expect(sdl).toContain("# Product display name");
    expect(sdl).not.toContain("id: ID!");
    expect(sdl).not.toContain("status");
  });

  test("pattern does not affect enum type output", () => {
    const status = largeIndex.types.get("ProductStatus")!;
    const withPattern = formatTypeSDL(status, { pattern: "ACTIVE" });
    const withoutPattern = formatTypeSDL(status);
    expect(withPattern).toBe(withoutPattern);
  });

  test("pattern does not affect union type output", () => {
    const unionSDL = `
      type Query { search: SearchResult }
      union SearchResult = Product | Image
      type Product { id: ID! }
      type Image { id: ID! }
    `;
    const idx = parseIntrospection(introspectionFromSDL(unionSDL));
    const union = idx.types.get("SearchResult")!;
    const withPattern = formatTypeSDL(union, { pattern: "Product" });
    const withoutPattern = formatTypeSDL(union);
    expect(withPattern).toBe(withoutPattern);
  });

  test("pattern does not affect scalar type output", () => {
    const scalarSDL = `
      type Query { dummy: String }
      scalar JSON
    `;
    const idx = parseIntrospection(introspectionFromSDL(scalarSDL));
    const scalar = idx.types.get("JSON")!;
    const withPattern = formatTypeSDL(scalar, { pattern: "anything" });
    const withoutPattern = formatTypeSDL(scalar);
    expect(withPattern).toBe(withoutPattern);
  });

  test("pattern with index expands only referenced types from matching fields", () => {
    const product = largeIndex.types.get("Product")!;
    const sdl = formatTypeSDL(product, { index: largeIndex, pattern: "price" });
    expect(sdl).toContain("priceRange");
    // PriceRange references Money — but referenced types are for the type, not filtered
    // The main point: it should still expand referenced types from filtered fields
    expect(sdl).toContain("--- Referenced Types ---");
  });
});
