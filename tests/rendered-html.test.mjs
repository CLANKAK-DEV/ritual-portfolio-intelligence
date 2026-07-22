import assert from "node:assert/strict";
import test from "node:test";

async function request(path = "/", init = { headers: { accept: "text/html" } }) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the portfolio intelligence product", async () => {
  const response = await request();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");

  const html = await response.text();
  assert.match(html, /<title>Ritual Portfolio Intelligence/i);
  assert.match(html, /Portfolio intelligence/i);
  assert.match(html, /Built native on Ritual/i);
  assert.match(html, /Decision support only/i);
  assert.doesNotMatch(html, /Your site is taking shape/i);
  assert.match(html, /initialSnapshot/);
  assert.match(html, /riskScore/);
});

test("rejects unsafe RPC relay methods before contacting the upstream", async () => {
  const response = await request("/api/rpc", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: ["0x00"] }),
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await response.json(), { error: "This JSON-RPC method is not allowed." });
});

test("rejects cross-origin RPC requests and invalid portfolio addresses", async () => {
  const crossOrigin = await request("/api/rpc", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://attacker.example" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId" }),
  });
  assert.equal(crossOrigin.status, 403);

  const invalidPortfolio = await request("/api/portfolio?address=not-a-wallet", {
    headers: { accept: "application/json" },
  });
  assert.equal(invalidPortfolio.status, 400);
  assert.equal(invalidPortfolio.headers.get("x-content-type-options"), "nosniff");
});
