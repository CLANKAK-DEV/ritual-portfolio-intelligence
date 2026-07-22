import { describe, expect, it } from "vitest";
import { parsePortfolioAnalysis } from "../lib/portfolio";
import { getSafeRpcUrl, isSameOriginRequest, validateRpcRequest } from "../lib/rpc-security";

describe("RPC boundary", () => {
  it("allows bounded read methods and rejects administrative or write relay methods", () => {
    expect(validateRpcRequest({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [] }).ok).toBe(true);
    expect(validateRpcRequest({ jsonrpc: "2.0", id: 2, method: "eth_sendRawTransaction", params: [] }).ok).toBe(false);
    expect(validateRpcRequest({ jsonrpc: "2.0", id: 3, method: "debug_traceTransaction", params: [] }).ok).toBe(false);
    expect(validateRpcRequest([{ jsonrpc: "2.0", id: 4, method: "eth_chainId" }]).ok).toBe(false);
  });

  it("requires a safe upstream URL and same-origin browser requests", () => {
    expect(getSafeRpcUrl("https://rpc.ritualfoundation.org")).toBe("https://rpc.ritualfoundation.org/");
    expect(() => getSafeRpcUrl("http://rpc.example.test")).toThrow();
    expect(() => getSafeRpcUrl("https://user:secret@rpc.example.test")).toThrow();
    expect(isSameOriginRequest(new Request("https://app.example/api/rpc", { headers: { origin: "https://app.example" } }))).toBe(true);
    expect(isSameOriginRequest(new Request("https://app.example/api/rpc", { headers: { origin: "https://attacker.example" } }))).toBe(false);
  });
});

describe("Ritual LLM output boundary", () => {
  it("accepts the expected bounded schema", () => {
    expect(parsePortfolioAnalysis({
      riskScore: 42,
      grade: "A",
      riskLabel: "Moderate",
      summary: "Diversified portfolio.",
      observations: ["Stablecoin allocation is visible."],
      actions: [{ title: "Review", detail: "Review concentration monthly.", impact: "low" }],
    })).not.toBeNull();
  });

  it("rejects extra properties, invalid scores, and oversized model output", () => {
    expect(parsePortfolioAnalysis({
      riskScore: 101,
      grade: "A",
      riskLabel: "Moderate",
      summary: "x".repeat(1_501),
      observations: [],
      actions: [],
      html: "<script>unexpected()</script>",
    })).toBeNull();
  });
});
