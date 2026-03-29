import { test, expect, describe, beforeEach, spyOn } from "bun:test";
import {
  configFromEnv,
  getEndpoint,
  getToken,
  buildHeaders,
  resetToken,
  executeOperation,
} from "../src/execute.js";

// ============================================================
// configFromEnv
// ============================================================

describe("configFromEnv", () => {
  test("throws when store is missing", () => {
    expect(() => configFromEnv({})).toThrow("SHOPIFY_STORE");
  });

  test("throws when client_id is missing", () => {
    expect(() =>
      configFromEnv({ SHOPIFY_STORE: "test.myshopify.com", SHOPIFY_CLIENT_SECRET: "secret" })
    ).toThrow("SHOPIFY_CLIENT_ID");
  });

  test("throws when client_secret is missing", () => {
    expect(() =>
      configFromEnv({ SHOPIFY_STORE: "test.myshopify.com", SHOPIFY_CLIENT_ID: "id" })
    ).toThrow("SHOPIFY_CLIENT_SECRET");
  });

  test("returns config with defaults", () => {
    const config = configFromEnv({
      SHOPIFY_STORE: "test.myshopify.com",
      SHOPIFY_CLIENT_ID: "id",
      SHOPIFY_CLIENT_SECRET: "secret",
    });
    expect(config.store).toBe("test.myshopify.com");
    expect(config.clientId).toBe("id");
    expect(config.clientSecret).toBe("secret");
    expect(config.apiVersion).toBe("2026-01");
  });

  test("respects custom api version", () => {
    const config = configFromEnv({
      SHOPIFY_STORE: "test.myshopify.com",
      SHOPIFY_CLIENT_ID: "id",
      SHOPIFY_CLIENT_SECRET: "secret",
      SHOPIFY_API_VERSION: "2026-01",
    });
    expect(config.apiVersion).toBe("2026-01");
  });
});

// ============================================================
// getEndpoint
// ============================================================

describe("getEndpoint", () => {
  test("builds correct URL", () => {
    const url = getEndpoint({
      store: "test.myshopify.com",
      clientId: "id",
      clientSecret: "secret",
      apiVersion: "2026-01",
    });
    expect(url).toBe("https://test.myshopify.com/admin/api/2026-01/graphql.json");
  });
});

// ============================================================
// buildHeaders
// ============================================================

describe("buildHeaders", () => {
  test("includes Content-Type and auth header", () => {
    const headers = buildHeaders("tok_abc");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Shopify-Access-Token"]).toBe("tok_abc");
  });
});

// ============================================================
// getToken
// ============================================================

describe("getToken", () => {
  const config = {
    store: "test.myshopify.com",
    clientId: "cid",
    clientSecret: "csecret",
    apiVersion: "2026-01",
  };

  beforeEach(() => {
    resetToken();
  });

  test("exchanges credentials for token", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: any;

    const spy = spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      capturedUrl = url as string;
      capturedBody = JSON.parse((init as any).body);
      return new Response(JSON.stringify({ access_token: "shp_tok_123" }));
    });

    const token = await getToken(config);
    expect(token).toBe("shp_tok_123");
    expect(capturedUrl).toBe("https://test.myshopify.com/admin/oauth/access_token");
    expect(capturedBody.grant_type).toBe("client_credentials");
    expect(capturedBody.client_id).toBe("cid");
    expect(capturedBody.client_secret).toBe("csecret");

    spy.mockRestore();
  });

  test("caches token on subsequent calls", async () => {
    let callCount = 0;

    const spy = spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      return new Response(JSON.stringify({ access_token: "cached_tok" }));
    });

    await getToken(config);
    await getToken(config);
    expect(callCount).toBe(1);

    spy.mockRestore();
  });

  test("resetToken clears cache", async () => {
    let callCount = 0;

    const spy = spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      return new Response(JSON.stringify({ access_token: `tok_${callCount}` }));
    });

    const t1 = await getToken(config);
    resetToken();
    const t2 = await getToken(config);

    expect(t1).toBe("tok_1");
    expect(t2).toBe("tok_2");
    expect(callCount).toBe(2);

    spy.mockRestore();
  });

  test("throws on failed token exchange", async () => {
    const spy = spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response("Unauthorized", { status: 401, statusText: "Unauthorized" });
    });

    await expect(getToken(config)).rejects.toThrow("Shopify token exchange failed: 401");

    spy.mockRestore();
  });
});

// ============================================================
// executeOperation
// ============================================================

describe("executeOperation", () => {
  const endpoint = "https://test.myshopify.com/admin/api/2026-01/graphql.json";
  const headers = buildHeaders("test_token");

  test("sends correct request", async () => {
    let capturedBody: any;

    const spy = spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedBody = JSON.parse((init as any).body);
      return new Response(JSON.stringify({ data: { shop: { name: "Test" } } }));
    });

    await executeOperation(endpoint, headers, "query { shop { name } }");
    expect(capturedBody.query).toBe("query { shop { name } }");

    spy.mockRestore();
  });

  test("includes auth header", async () => {
    let capturedHeaders: any;

    const spy = spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedHeaders = (init as any).headers;
      return new Response(JSON.stringify({ data: null }));
    });

    await executeOperation(endpoint, headers, "query { shop { name } }");
    expect(capturedHeaders["X-Shopify-Access-Token"]).toBe("test_token");

    spy.mockRestore();
  });

  test("includes variables in request body", async () => {
    let capturedBody: any;

    const spy = spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedBody = JSON.parse((init as any).body);
      return new Response(JSON.stringify({ data: null }));
    });

    await executeOperation(endpoint, headers, "query ($id: ID!) { node(id: $id) { id } }", {
      id: "gid://shopify/Product/123",
    });
    expect(capturedBody.variables).toEqual({ id: "gid://shopify/Product/123" });

    spy.mockRestore();
  });

  test("returns parsed response", async () => {
    const mockData = { data: { shop: { name: "Test Store" } } };

    const spy = spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify(mockData));
    });

    const { response, truncated } = await executeOperation(
      endpoint,
      headers,
      "query { shop { name } }"
    );
    expect(response.data).toEqual(mockData.data);
    expect(truncated).toBe(false);

    spy.mockRestore();
  });

  test("throws on HTTP error", async () => {
    const spy = spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response("Unauthorized", { status: 401, statusText: "Unauthorized" });
    });

    await expect(
      executeOperation(endpoint, headers, "query { shop { name } }")
    ).rejects.toThrow("401");

    spy.mockRestore();
  });

  test("retries on 429 rate limit", async () => {
    let callCount = 0;

    const spy = spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("Rate limited", { status: 429, headers: { "Retry-After": "0.01" } });
      }
      return new Response(JSON.stringify({ data: { ok: true } }));
    });

    const { response } = await executeOperation(endpoint, headers, "query { ok }");
    expect(response.data).toEqual({ ok: true });
    expect(callCount).toBe(2);

    spy.mockRestore();
  });

  test("gives up after max retries on 429", async () => {
    const spy = spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response("Rate limited", { status: 429, headers: { "Retry-After": "0.01" } });
    });

    await expect(
      executeOperation(endpoint, headers, "query { ok }", undefined, { maxRetries: 1 })
    ).rejects.toThrow("Rate limited");

    spy.mockRestore();
  });

  test("handles GraphQL errors in response", async () => {
    const spy = spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ data: null, errors: [{ message: "Not found" }] }));
    });

    const { response } = await executeOperation(endpoint, headers, "query { foo }");
    expect(response.errors![0].message).toBe("Not found");

    spy.mockRestore();
  });

  test("flags truncated large responses", async () => {
    const largeData = { data: { items: Array(1000).fill({ id: "x".repeat(100) }) } };

    const spy = spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify(largeData));
    });

    const { truncated, rawLength } = await executeOperation(
      endpoint,
      headers,
      "query { items { id } }"
    );
    expect(rawLength).toBeGreaterThan(50_000);
    expect(truncated).toBe(true);

    spy.mockRestore();
  });
});
