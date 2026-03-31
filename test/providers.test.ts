import { test, expect, describe, spyOn } from "bun:test";
import {
  ShopifyProvider,
  LinearProvider,
  detectProvider,
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
// detectProvider — auto-detection
// ============================================================

describe("detectProvider", () => {
  test("detects Shopify when all Shopify vars are present", () => {
    const provider = detectProvider({
      SHOPIFY_STORE: "test.myshopify.com",
      SHOPIFY_CLIENT_ID: "cid",
      SHOPIFY_CLIENT_SECRET: "csecret",
    });
    expect(provider.name).toBe("shopify");
  });

  test("detects Linear when LINEAR_API_KEY is present", () => {
    const provider = detectProvider({ LINEAR_API_KEY: "lin_key" });
    expect(provider.name).toBe("linear");
  });

  test("prefers Shopify when both provider vars are present", () => {
    const provider = detectProvider({
      SHOPIFY_STORE: "test.myshopify.com",
      SHOPIFY_CLIENT_ID: "cid",
      SHOPIFY_CLIENT_SECRET: "csecret",
      LINEAR_API_KEY: "lin_key",
    });
    expect(provider.name).toBe("shopify");
  });

  test("throws when no provider vars are present", () => {
    expect(() => detectProvider({})).toThrow("No GraphQL provider detected");
  });

  test("error message lists all available providers and their vars", () => {
    try {
      detectProvider({});
    } catch (e: any) {
      expect(e.message).toContain("Shopify");
      expect(e.message).toContain("SHOPIFY_STORE");
      expect(e.message).toContain("SHOPIFY_CLIENT_ID");
      expect(e.message).toContain("SHOPIFY_CLIENT_SECRET");
      expect(e.message).toContain("Linear");
      expect(e.message).toContain("LINEAR_API_KEY");
    }
  });

  test("partial Shopify vars do not trigger Shopify detection", () => {
    expect(() => detectProvider({ SHOPIFY_STORE: "test.myshopify.com" })).toThrow(
      "No GraphQL provider detected",
    );
  });

  test("detects Linear when only partial Shopify vars exist alongside LINEAR_API_KEY", () => {
    const provider = detectProvider({
      SHOPIFY_STORE: "test.myshopify.com",
      LINEAR_API_KEY: "lin_key",
    });
    expect(provider.name).toBe("linear");
  });

  test("returns a provider with working getEndpoint", () => {
    const provider = detectProvider({ LINEAR_API_KEY: "lin_key" });
    expect(provider.getEndpoint()).toBe("https://api.linear.app/graphql");
  });

  test("returns a provider with working getHeaders", async () => {
    const provider = detectProvider({ LINEAR_API_KEY: "lin_key" });
    const headers = await provider.getHeaders();
    expect(headers["Authorization"]).toBe("lin_key");
  });
});
