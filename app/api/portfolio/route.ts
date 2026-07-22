import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { makeDemoSnapshot, type PortfolioSnapshot } from "@/lib/portfolio";

export const runtime = "edge";

function normalizeProviderPayload(address: string, payload: unknown): PortfolioSnapshot | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as Partial<PortfolioSnapshot>;
  if (!Array.isArray(candidate.assets) || typeof candidate.totalValueUsd !== "number") return null;
  return {
    ...makeDemoSnapshot(address),
    ...candidate,
    address,
    updatedAt: new Date().toISOString(),
    source: "provider",
  } as PortfolioSnapshot;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const address = url.searchParams.get("address") ?? "";
  if (!isAddress(address)) {
    return NextResponse.json({ error: "A valid EVM wallet address is required." }, { status: 400 });
  }

  const providerTemplate = process.env.PORTFOLIO_API_URL_TEMPLATE;
  if (providerTemplate) {
    try {
      const providerUrl = providerTemplate.replace("{address}", address);
      const response = await fetch(providerUrl, {
        headers: process.env.PORTFOLIO_API_KEY
          ? { Authorization: `Bearer ${process.env.PORTFOLIO_API_KEY}`, Accept: "application/json" }
          : { Accept: "application/json" },
        cf: { cacheTtl: 30 },
      } as RequestInit);
      if (response.ok) {
        const normalized = normalizeProviderPayload(address, await response.json());
        if (normalized) return NextResponse.json(normalized, { headers: { "Cache-Control": "public, max-age=30" } });
      }
    } catch {
      // The deterministic demo adapter keeps the hackathon build usable when a provider is unavailable.
    }
  }

  return NextResponse.json(makeDemoSnapshot(address), {
    headers: { "Cache-Control": "public, max-age=30", "X-Portfolio-Source": "demo" },
  });
}

