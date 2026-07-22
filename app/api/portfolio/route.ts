import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { makeDemoSnapshot, type AssetCategory, type PortfolioAsset, type PortfolioSnapshot } from "@/lib/portfolio";

export const runtime = "edge";

type BlockscoutToken = {
  address?: string;
  decimals?: string | null;
  exchange_rate?: string | null;
  name?: string | null;
  symbol?: string | null;
  type?: string | null;
};

type BlockscoutTokenBalance = { token?: BlockscoutToken; value?: string | null };
type BlockscoutAddress = { coin_balance?: string | null; exchange_rate?: string | null };

const networks = [
  { name: "Ethereum", api: "https://eth.blockscout.com", nativeSymbol: "ETH", nativeName: "Ethereum" },
  { name: "Arbitrum", api: "https://arbitrum.blockscout.com", nativeSymbol: "ETH", nativeName: "Ethereum" },
] as const;

const stablecoins = new Set(["USDC", "USDT", "DAI", "USDE", "FRAX", "LUSD", "PYUSD", "USDS", "GHO"]);
const bluechips = new Set(["ETH", "WETH", "WBTC", "BTC", "STETH", "WSTETH", "RETH", "CBETH"]);
const defi = new Set(["AAVE", "UNI", "LINK", "MKR", "SKY", "CRV", "LDO", "COMP", "SNX", "ARB", "OP", "PENDLE"]);
const memes = new Set(["PEPE", "SHIB", "DOGE", "FLOKI", "BONK", "WIF", "MOG", "BRETT"]);
const colors = ["#19D184", "#BFFF00", "#FF1DCE", "#36A3FF", "#FACC15", "#8B5CF6", "#F97316", "#14B8A6"];

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function categoryFor(symbol: string): AssetCategory {
  if (stablecoins.has(symbol)) return "stablecoin";
  if (bluechips.has(symbol)) return "bluechip";
  if (defi.has(symbol)) return "defi";
  if (memes.has(symbol)) return "meme";
  return "other";
}

function tokenAmount(raw: string | null | undefined, decimals: string | null | undefined) {
  const value = finiteNumber(raw);
  const precision = Math.min(30, Math.max(0, Number.parseInt(decimals ?? "0", 10) || 0));
  return value / 10 ** precision;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" }, cf: { cacheTtl: 30 } } as RequestInit);
  if (!response.ok) throw new Error(`Blockscout returned ${response.status}`);
  return response.json() as Promise<T>;
}

async function fetchNetwork(address: string, network: (typeof networks)[number]) {
  const [account, balances] = await Promise.all([
    fetchJson<BlockscoutAddress>(`${network.api}/api/v2/addresses/${address}`),
    fetchJson<BlockscoutTokenBalance[]>(`${network.api}/api/v2/addresses/${address}/token-balances`),
  ]);

  const assets: Omit<PortfolioAsset, "allocation" | "color">[] = [];
  const nativeValue = tokenAmount(account.coin_balance, "18") * finiteNumber(account.exchange_rate);
  if (nativeValue >= 0.01) {
    assets.push({
      id: `${network.name.toLowerCase()}:native`,
      symbol: network.nativeSymbol,
      name: network.nativeName,
      chain: network.name,
      category: "bluechip",
      valueUsd: nativeValue,
      change24h: null,
    });
  }

  for (const item of balances) {
    const token = item.token;
    if (!token || token.type !== "ERC-20") continue;
    const symbol = token.symbol?.trim().toUpperCase();
    const rate = finiteNumber(token.exchange_rate);
    if (!symbol || rate <= 0) continue;
    const valueUsd = tokenAmount(item.value, token.decimals) * rate;
    if (!Number.isFinite(valueUsd) || valueUsd < 0.01) continue;
    assets.push({
      id: `${network.name.toLowerCase()}:${(token.address ?? symbol).toLowerCase()}`,
      symbol: symbol.slice(0, 18),
      name: (token.name?.trim() || symbol).slice(0, 48),
      chain: network.name,
      category: categoryFor(symbol),
      valueUsd,
      change24h: null,
    });
  }
  return assets;
}

async function makeBlockscoutSnapshot(address: string): Promise<PortfolioSnapshot> {
  const results = await Promise.allSettled(networks.map((network) => fetchNetwork(address, network)));
  if (results.every((result) => result.status === "rejected")) throw new Error("All portfolio indexers are unavailable");
  const rawAssets = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  rawAssets.sort((a, b) => b.valueUsd - a.valueUsd);
  const selected = rawAssets.slice(0, 25);
  const totalValueUsd = selected.reduce((sum, asset) => sum + asset.valueUsd, 0);
  const assets: PortfolioAsset[] = selected.map((asset, index) => ({
    ...asset,
    valueUsd: Number(asset.valueUsd.toFixed(2)),
    allocation: totalValueUsd > 0 ? Number(((asset.valueUsd / totalValueUsd) * 100).toFixed(1)) : 0,
    color: colors[index % colors.length],
  }));
  const categoryAllocation = (category: AssetCategory) => Number(assets.filter((asset) => asset.category === category).reduce((sum, asset) => sum + asset.allocation, 0).toFixed(1));
  const chains = networks.map((network) => ({
    name: network.name,
    allocation: Number(assets.filter((asset) => asset.chain === network.name).reduce((sum, asset) => sum + asset.allocation, 0).toFixed(1)),
  })).filter((chain) => chain.allocation > 0);

  return {
    address,
    totalValueUsd: Number(totalValueUsd.toFixed(2)),
    change24h: 0,
    assets,
    exposure: {
      stablecoins: categoryAllocation("stablecoin"),
      defi: categoryAllocation("defi"),
      memecoins: categoryAllocation("meme"),
      nfts: 0,
    },
    chains,
    updatedAt: new Date().toISOString(),
    source: "blockscout",
    providerName: "Blockscout · Ethereum + Arbitrum",
  };
}

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
    providerName: "Configured portfolio provider",
  } as PortfolioSnapshot;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const address = url.searchParams.get("address") ?? "";
  if (!isAddress(address)) return NextResponse.json({ error: "A valid EVM wallet address is required." }, { status: 400 });

  const providerTemplate = process.env.PORTFOLIO_API_URL_TEMPLATE;
  if (providerTemplate) {
    try {
      const response = await fetch(providerTemplate.replace("{address}", address), {
        headers: process.env.PORTFOLIO_API_KEY ? { Authorization: `Bearer ${process.env.PORTFOLIO_API_KEY}`, Accept: "application/json" } : { Accept: "application/json" },
        cf: { cacheTtl: 30 },
      } as RequestInit);
      if (response.ok) {
        const normalized = normalizeProviderPayload(address, await response.json());
        if (normalized) return NextResponse.json(normalized, { headers: { "Cache-Control": "public, max-age=30", "X-Portfolio-Source": "provider" } });
      }
    } catch {
      // Continue to the public, keyless Blockscout adapter.
    }
  }

  try {
    return NextResponse.json(await makeBlockscoutSnapshot(address), {
      headers: { "Cache-Control": "public, max-age=30", "X-Portfolio-Source": "blockscout" },
    });
  } catch {
    return NextResponse.json({ error: "Portfolio indexers are temporarily unavailable. No demo values were substituted." }, { status: 503 });
  }
}
