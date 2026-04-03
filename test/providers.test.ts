import { test, expect, describe, spyOn } from "bun:test";
import {
  ShopifyProvider,
  LinearProvider,
  detectProviders,
  resolveProvider,
} from "../src/providers.js";

// ============================================================
// ShopifyProvider — config validation
// ============================================================

describe("ShopifyProvider", () => {
  test("throws when SHOPIFY_STORE is missing", () => {
    expect(() => new ShopifyProvider({})).toThrow("SHOPIFY_STORE");
  });

  test("throws when SHOPIFY_CLIENT_ID is missing", () => {
    expect(
      () => new ShopifyProvider({ SHOPIFY_STORE: "test.myshopify.com", SHOPIFY_CLIENT_SECRET: "s" }),
    ).toThrow("SHOPIFY_CLIENT_ID");
  });

  test("throws when SHOPIFY_CLIENT_SECRET is missing", () => {
    expect(
      () => new ShopifyProvider({ SHOPIFY_STORE: "test.myshopify.com", SHOPIFY_CLIENT_ID: "cid" }),
    ).toThrow("SHOPIFY_CLIENT_SECRET");
  });

  test("has name 'shopify'", () => {
    const p = new ShopifyProvider({
      SHOPIFY_STORE: "test.myshopify.com",
      SHOPIFY_CLIENT_ID: "cid",
      SHOPIFY_CLIENT_SECRET: "csecret",
    });
    expect(p.name).toBe("shopify");
  });

  // --- endpoint ---

  test("returns correct endpoint with default api version", () => {
    const p = new ShopifyProvider({
      SHOPIFY_STORE: "test.myshopify.com",
      SHOPIFY_CLIENT_ID: "cid",
      SHOPIFY_CLIENT_SECRET: "csecret",
    });
    expect(p.getEndpoint()).toBe("https://test.myshopify.com/admin/api/2026-01/graphql.json");
  });

  test("returns correct endpoint with custom api version", () => {
    const p = new ShopifyProvider({
      SHOPIFY_STORE: "test.myshopify.com",
      SHOPIFY_CLIENT_ID: "cid",
      SHOPIFY_CLIENT_SECRET: "csecret",
      SHOPIFY_API_VERSION: "2025-10",
    });
    expect(p.getEndpoint()).toBe("https://test.myshopify.com/admin/api/2025-10/graphql.json");
  });

  // --- headers ---

  test("getHeaders returns Shopify auth headers", async () => {
    const spy = spyOn(globalThis as any, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ access_token: "shp_tok" }));
    });

    const p = new ShopifyProvider({
      SHOPIFY_STORE: "test.myshopify.com",
      SHOPIFY_CLIENT_ID: "cid",
      SHOPIFY_CLIENT_SECRET: "csecret",
    });
    const headers = await p.getHeaders();
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Shopify-Access-Token"]).toBe("shp_tok");

    spy.mockRestore();
  });

  // --- caching ---

  test("caches token across multiple getHeaders calls", async () => {
    let callCount = 0;
    const spy = spyOn(globalThis as any, "fetch").mockImplementation(async () => {
      callCount++;
      return new Response(JSON.stringify({ access_token: "cached_tok" }));
    });

    const p = new ShopifyProvider({
      SHOPIFY_STORE: "test.myshopify.com",
      SHOPIFY_CLIENT_ID: "cid",
      SHOPIFY_CLIENT_SECRET: "csecret",
    });
    await p.getHeaders();
    await p.getHeaders();
    expect(callCount).toBe(1);

    spy.mockRestore();
  });

  // --- reset ---

  test("reset clears cached token so next getHeaders re-fetches", async () => {
    let callCount = 0;
    const spy = spyOn(globalThis as any, "fetch").mockImplementation(async () => {
      callCount++;
      return new Response(JSON.stringify({ access_token: `tok_${callCount}` }));
    });

    const p = new ShopifyProvider({
      SHOPIFY_STORE: "test.myshopify.com",
      SHOPIFY_CLIENT_ID: "cid",
      SHOPIFY_CLIENT_SECRET: "csecret",
    });
    await p.getHeaders();
    p.reset();
    await p.getHeaders();
    expect(callCount).toBe(2);

    spy.mockRestore();
  });

  // --- instance isolation ---

  test("two instances have independent token caches", async () => {
    let callCount = 0;
    const spy = spyOn(globalThis as any, "fetch").mockImplementation(async () => {
      callCount++;
      return new Response(JSON.stringify({ access_token: `tok_${callCount}` }));
    });

    const env = {
      SHOPIFY_STORE: "test.myshopify.com",
      SHOPIFY_CLIENT_ID: "cid",
      SHOPIFY_CLIENT_SECRET: "csecret",
    };
    const p1 = new ShopifyProvider(env);
    const p2 = new ShopifyProvider(env);

    const h1 = await p1.getHeaders();
    const h2 = await p2.getHeaders();

    expect(callCount).toBe(2);
    expect(h1["X-Shopify-Access-Token"]).toBe("tok_1");
    expect(h2["X-Shopify-Access-Token"]).toBe("tok_2");

    spy.mockRestore();
  });

  test("resetting one instance does not affect another", async () => {
    let callCount = 0;
    const spy = spyOn(globalThis as any, "fetch").mockImplementation(async () => {
      callCount++;
      return new Response(JSON.stringify({ access_token: `tok_${callCount}` }));
    });

    const env = {
      SHOPIFY_STORE: "test.myshopify.com",
      SHOPIFY_CLIENT_ID: "cid",
      SHOPIFY_CLIENT_SECRET: "csecret",
    };
    const p1 = new ShopifyProvider(env);
    const p2 = new ShopifyProvider(env);

    await p1.getHeaders();
    await p2.getHeaders();
    p1.reset();

    // p2 should still use its cached token
    const h2 = await p2.getHeaders();
    expect(h2["X-Shopify-Access-Token"]).toBe("tok_2");
    expect(callCount).toBe(2);

    spy.mockRestore();
  });

  // --- error propagation ---

  test("getHeaders throws on failed token exchange", async () => {
    const spy = spyOn(globalThis as any, "fetch").mockImplementation(async () => {
      return new Response("Unauthorized", { status: 401, statusText: "Unauthorized" });
    });

    const p = new ShopifyProvider({
      SHOPIFY_STORE: "test.myshopify.com",
      SHOPIFY_CLIENT_ID: "cid",
      SHOPIFY_CLIENT_SECRET: "csecret",
    });
    await expect(p.getHeaders()).rejects.toThrow("Shopify token exchange failed: 401");

    spy.mockRestore();
  });
});

// ============================================================
// LinearProvider — config validation
// ============================================================

describe("LinearProvider", () => {
  test("throws when LINEAR_API_KEY is missing", () => {
    expect(() => new LinearProvider({})).toThrow("LINEAR_API_KEY");
  });

  test("error message is helpful", () => {
    try {
      new LinearProvider({});
    } catch (e: any) {
      expect(e.message).toContain("LINEAR_API_KEY");
      expect(e.message).toContain("Linear");
    }
  });

  test("has name 'linear'", () => {
    const p = new LinearProvider({ LINEAR_API_KEY: "lin_api_key" });
    expect(p.name).toBe("linear");
  });

  // --- endpoint ---

  test("returns correct endpoint", () => {
    const p = new LinearProvider({ LINEAR_API_KEY: "lin_api_key" });
    expect(p.getEndpoint()).toBe("https://api.linear.app/graphql");
  });

  // --- headers ---

  test("getHeaders returns Authorization header with API key (no Bearer prefix)", async () => {
    const p = new LinearProvider({ LINEAR_API_KEY: "lin_api_key_123" });
    const headers = await p.getHeaders();
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Authorization"]).toBe("lin_api_key_123");
  });

  test("getHeaders does not include Bearer prefix", async () => {
    const p = new LinearProvider({ LINEAR_API_KEY: "lin_api_key_123" });
    const headers = await p.getHeaders();
    expect(headers["Authorization"]).not.toContain("Bearer");
  });

  // --- reset ---

  test("reset is a no-op and does not throw", () => {
    const p = new LinearProvider({ LINEAR_API_KEY: "lin_api_key" });
    expect(() => p.reset()).not.toThrow();
  });
});

// ============================================================
// detectProviders — multi-provider auto-detection
// ============================================================

describe("detectProviders", () => {
  test("returns empty map when no provider vars are present", () => {
    const providers = detectProviders({});
    expect(providers.size).toBe(0);
  });

  test("detects Shopify when all Shopify vars are present", () => {
    const providers = detectProviders({
      SHOPIFY_STORE: "test.myshopify.com",
      SHOPIFY_CLIENT_ID: "cid",
      SHOPIFY_CLIENT_SECRET: "csecret",
    });
    expect(providers.size).toBe(1);
    expect(providers.has("shopify")).toBe(true);
    expect(providers.get("shopify")!.name).toBe("shopify");
  });

  test("detects Linear when LINEAR_API_KEY is present", () => {
    const providers = detectProviders({ LINEAR_API_KEY: "lin_key" });
    expect(providers.size).toBe(1);
    expect(providers.has("linear")).toBe(true);
    expect(providers.get("linear")!.name).toBe("linear");
  });

  test("detects both when both sets of vars are present", () => {
    const providers = detectProviders({
      SHOPIFY_STORE: "test.myshopify.com",
      SHOPIFY_CLIENT_ID: "cid",
      SHOPIFY_CLIENT_SECRET: "csecret",
      LINEAR_API_KEY: "lin_key",
    });
    expect(providers.size).toBe(2);
    expect(providers.has("shopify")).toBe(true);
    expect(providers.has("linear")).toBe(true);
  });

  test("partial Shopify vars do not trigger Shopify detection", () => {
    const providers = detectProviders({ SHOPIFY_STORE: "test.myshopify.com" });
    expect(providers.has("shopify")).toBe(false);
  });

  test("detects Linear when only partial Shopify vars exist alongside LINEAR_API_KEY", () => {
    const providers = detectProviders({
      SHOPIFY_STORE: "test.myshopify.com",
      LINEAR_API_KEY: "lin_key",
    });
    expect(providers.size).toBe(1);
    expect(providers.has("linear")).toBe(true);
    expect(providers.has("shopify")).toBe(false);
  });

  test("each detected provider has a working getEndpoint", () => {
    const providers = detectProviders({
      SHOPIFY_STORE: "test.myshopify.com",
      SHOPIFY_CLIENT_ID: "cid",
      SHOPIFY_CLIENT_SECRET: "csecret",
      LINEAR_API_KEY: "lin_key",
    });
    expect(providers.get("shopify")!.getEndpoint()).toContain("test.myshopify.com");
    expect(providers.get("linear")!.getEndpoint()).toBe("https://api.linear.app/graphql");
  });

  test("each detected provider has working getHeaders", async () => {
    const spy = spyOn(globalThis as any, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ access_token: "shp_tok" }));
    });

    const providers = detectProviders({
      SHOPIFY_STORE: "test.myshopify.com",
      SHOPIFY_CLIENT_ID: "cid",
      SHOPIFY_CLIENT_SECRET: "csecret",
      LINEAR_API_KEY: "lin_key",
    });

    const shopifyHeaders = await providers.get("shopify")!.getHeaders();
    expect(shopifyHeaders["X-Shopify-Access-Token"]).toBe("shp_tok");

    const linearHeaders = await providers.get("linear")!.getHeaders();
    expect(linearHeaders["Authorization"]).toBe("lin_key");

    spy.mockRestore();
  });
});

// ============================================================
// resolveProvider — provider lookup with error messages
// ============================================================

describe("resolveProvider", () => {
  test("returns the provider when name matches", () => {
    const providers = detectProviders({ LINEAR_API_KEY: "lin_key" });
    const provider = resolveProvider(providers, "linear");
    expect(provider.name).toBe("linear");
  });

  test("name matching is case-insensitive", () => {
    const providers = detectProviders({ LINEAR_API_KEY: "lin_key" });
    const provider = resolveProvider(providers, "Linear");
    expect(provider.name).toBe("linear");
  });

  test("throws when name does not match any configured provider", () => {
    const providers = detectProviders({ LINEAR_API_KEY: "lin_key" });
    expect(() => resolveProvider(providers, "shopify")).toThrow();
  });

  test("error for invalid name lists available providers", () => {
    const providers = detectProviders({
      SHOPIFY_STORE: "test.myshopify.com",
      SHOPIFY_CLIENT_ID: "cid",
      SHOPIFY_CLIENT_SECRET: "csecret",
      LINEAR_API_KEY: "lin_key",
    });
    try {
      resolveProvider(providers, "github");
    } catch (e: any) {
      expect(e.message).toContain("shopify");
      expect(e.message).toContain("linear");
    }
  });

  test("throws when no providers are configured", () => {
    const providers = detectProviders({});
    expect(() => resolveProvider(providers, "linear")).toThrow();
  });

  test("error for no providers lists all supported types and env vars", () => {
    const providers = detectProviders({});
    try {
      resolveProvider(providers, "linear");
    } catch (e: any) {
      expect(e.message).toContain("Shopify");
      expect(e.message).toContain("SHOPIFY_STORE");
      expect(e.message).toContain("SHOPIFY_CLIENT_ID");
      expect(e.message).toContain("SHOPIFY_CLIENT_SECRET");
      expect(e.message).toContain("Linear");
      expect(e.message).toContain("LINEAR_API_KEY");
    }
  });
});
