import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { type AssetCategory, type PortfolioAsset, type PortfolioSnapshot } from "@/lib/portfolio";
import { checkRateLimit } from "@/lib/rate-limit";

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

type DeBankTotalBalance = {
  total_usd_value?: number;
  chain_list?: Array<{ id?: string; name?: string; usd_value?: number }>;
};

type DeBankToken = {
  id?: string;
  chain?: string;
  name?: string | null;
  symbol?: string | null;
  display_symbol?: string | null;
  optimized_symbol?: string | null;
  protocol_id?: string | null;
  price?: number;
  amount?: number;
  is_verified?: boolean;
  is_core?: boolean;
};

type DeBankProtocol = {
  id?: string;
  chain?: string;
  name?: string | null;
  net_usd_value?: number;
};

type DeBankNft = {
  id?: string;
  contract_id?: string;
  collection_id?: string | null;
  chain?: string;
  name?: string | null;
  contract_name?: string | null;
  is_erc1155?: boolean;
  amount?: number;
  usd_price?: number;
};

type ZerionPortfolioResponse = {
  data?: {
    attributes?: {
      total?: { positions?: number };
      changes?: { percent_1d?: number };
    };
  };
};

type ZerionPosition = {
  id?: string;
  attributes?: {
    value?: number | null;
    position_type?: string | null;
    protocol?: string | null;
    changes?: { percent_1d?: number | null };
    fungible_info?: { name?: string | null; symbol?: string | null };
    flags?: { displayable?: boolean; is_trash?: boolean };
    application_metadata?: { name?: string | null } | null;
  };
  relationships?: {
    chain?: { data?: { id?: string } };
    dapp?: { data?: { id?: string } | null };
  };
};

type ZerionPositionResponse = { data?: ZerionPosition[] };

type ZerionNftPosition = {
  id?: string;
  attributes?: {
    amount?: string | number;
    value?: number | null;
    nft_info?: { name?: string | null; contract_address?: string | null };
  };
  relationships?: { chain?: { data?: { id?: string } } };
};

type ZerionNftResponse = { data?: ZerionNftPosition[] };

const networks = [
  { name: "Ethereum", api: "https://eth.blockscout.com", nativeSymbol: "ETH", nativeName: "Ethereum" },
  { name: "Arbitrum", api: "https://arbitrum.blockscout.com", nativeSymbol: "ETH", nativeName: "Ethereum" },
] as const;

const stablecoins = new Set(["USDC", "USDT", "DAI", "USDE", "FRAX", "LUSD", "PYUSD", "USDS", "GHO"]);
const bluechips = new Set(["ETH", "WETH", "WBTC", "BTC", "STETH", "WSTETH", "RETH", "CBETH"]);
const defi = new Set(["AAVE", "UNI", "LINK", "MKR", "SKY", "CRV", "LDO", "COMP", "SNX", "ARB", "OP", "PENDLE"]);
const memes = new Set(["PEPE", "SHIB", "DOGE", "FLOKI", "BONK", "WIF", "MOG", "BRETT"]);
const colors = ["#19D184", "#BFFF00", "#FF1DCE", "#36A3FF", "#FACC15", "#8B5CF6", "#F97316", "#14B8A6"];
const debankBaseUrl = "https://pro-openapi.debank.com/v1";
const zerionBaseUrl = "https://api.zerion.io/v1";
const PROVIDER_TIMEOUT_MS = 10_000;
const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1_024 * 1_024;
const portfolioHeaders = {
  "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=300",
  "X-Content-Type-Options": "nosniff",
};

async function readBoundedJson<T>(response: Response, provider: string): Promise<T> {
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new Error(`${provider} response exceeded the safety limit`);
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new Error(`${provider} response exceeded the safety limit`);
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`${provider} returned malformed JSON`);
  }
}

function responseHeaders(source: string, rateLimitHeaders: Record<string, string>) {
  return { ...portfolioHeaders, ...rateLimitHeaders, "X-Portfolio-Source": source };
}

function isPrivateHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1" || normalized.endsWith(".local") || normalized.endsWith(".internal")) return true;
  const octets = normalized.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
  }
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 || first >= 224 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168);
}

function configuredProviderUrl(template: string, address: string) {
  if ((template.match(/\{address\}/g) ?? []).length !== 1) return null;
  try {
    const url = new URL(template.replace("{address}", encodeURIComponent(address)));
    if (url.protocol !== "https:" || url.username || url.password || isPrivateHostname(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function categoryFor(symbol: string): AssetCategory {
  const canonical = symbol.split(/[.\-]/)[0];
  if (stablecoins.has(canonical)) return "stablecoin";
  if (bluechips.has(canonical)) return "bluechip";
  if (defi.has(canonical)) return "defi";
  if (memes.has(canonical)) return "meme";
  return "other";
}

function looksSuspicious(symbol: string, name: string) {
  const value = `${symbol} ${name}`.toLowerCase();
  return ["visit ", ".com", ".org", "claim at", "airdrop", "reward at", "bonus at"].some((term) => value.includes(term));
}

function categoryAllocation(assets: PortfolioAsset[], category: AssetCategory) {
  return Number(assets.filter((asset) => asset.category === category).reduce((sum, asset) => sum + asset.allocation, 0).toFixed(1));
}

function finalizeAssets(rawAssets: Omit<PortfolioAsset, "allocation" | "color">[]) {
  const sorted = rawAssets.filter((asset) => asset.valueUsd >= 0.01).sort((a, b) => b.valueUsd - a.valueUsd);
  const visible = sorted.length <= 40 ? sorted : [
    ...sorted.slice(0, 39),
    {
      id: "portfolio:remainder",
      symbol: "OTHER",
      name: `${sorted.length - 39} smaller indexed positions`,
      chain: "Multichain",
      category: "other" as const,
      valueUsd: sorted.slice(39).reduce((sum, asset) => sum + asset.valueUsd, 0),
      change24h: null,
    },
  ];
  const totalValueUsd = visible.reduce((sum, asset) => sum + asset.valueUsd, 0);
  const assets: PortfolioAsset[] = visible.map((asset, index) => ({
    ...asset,
    valueUsd: Number(asset.valueUsd.toFixed(2)),
    allocation: totalValueUsd > 0 ? Number(((asset.valueUsd / totalValueUsd) * 100).toFixed(1)) : 0,
    color: colors[index % colors.length],
  }));
  return { assets, totalValueUsd: Number(totalValueUsd.toFixed(2)) };
}

async function fetchDeBank<T>(path: string, accessKey: string): Promise<T> {
  const response = await fetch(`${debankBaseUrl}${path}`, {
    headers: { Accept: "application/json", AccessKey: accessKey },
    cf: { cacheTtl: 30 },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  } as RequestInit);
  if (!response.ok) throw new Error(`DeBank returned ${response.status}`);
  return readBoundedJson<T>(response, "DeBank");
}

function readableChainName(id?: string) {
  const names: Record<string, string> = {
    arbitrum: "Arbitrum",
    avalanche: "Avalanche",
    base: "Base",
    "binance-smart-chain": "BNB Chain",
    ethereum: "Ethereum",
    linea: "Linea",
    megaeth: "MegaETH",
    optimism: "Optimism",
    polygon: "Polygon",
    robinhood: "Robinhood Chain",
    "zksync-era": "zkSync Era",
  };
  if (!id) return "Unknown";
  return names[id] ?? id.split("-").map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(" ");
}

async function fetchZerion<T>(path: string, apiKey: string, acceptPending = false): Promise<T | null> {
  const authorization = `Basic ${btoa(`${apiKey}:`)}`;
  const response = await fetch(`${zerionBaseUrl}${path}`, {
    headers: { Accept: "application/json", Authorization: authorization },
    cf: { cacheTtl: 30 },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  } as RequestInit);
  if (acceptPending && response.status === 202) return null;
  if (!response.ok) throw new Error(`Zerion returned ${response.status}`);
  return readBoundedJson<T>(response, "Zerion");
}

async function makeZerionSnapshot(address: string, apiKey: string): Promise<PortfolioSnapshot> {
  const encodedAddress = encodeURIComponent(address);
  const positionsResponse = await fetchZerion<ZerionPositionResponse>(
    `/wallets/${encodedAddress}/positions/?filter[positions]=no_filter&filter[trash]=only_non_trash&page[size]=100`,
    apiKey,
  );
  const positions = positionsResponse?.data ?? [];
  const rawAssets: Omit<PortfolioAsset, "allocation" | "color">[] = [];
  const protocols = new Set<string>();

  for (const position of positions) {
    const attributes = position.attributes;
    const valueUsd = finiteNumber(attributes?.value);
    if (!attributes || valueUsd < 0.01 || attributes.flags?.is_trash || attributes.flags?.displayable === false) continue;
    if (attributes.position_type === "loan") continue;
    const symbol = (attributes.fungible_info?.symbol?.trim() || "ASSET").toUpperCase().slice(0, 18);
    const name = (attributes.fungible_info?.name?.trim() || symbol).slice(0, 64);
    if (looksSuspicious(symbol, name)) continue;
    const dappId = position.relationships?.dapp?.data?.id;
    const protocolName = attributes.application_metadata?.name?.trim() || attributes.protocol?.trim() || dappId;
    const isProtocolPosition = attributes.position_type !== "wallet" || Boolean(protocolName);
    if (protocolName) protocols.add(protocolName);
    const change = attributes.changes?.percent_1d;
    rawAssets.push({
      id: `zerion:${position.id ?? `${position.relationships?.chain?.data?.id}:${symbol}`}`,
      symbol,
      name: isProtocolPosition && protocolName ? `${name} · ${protocolName}` : name,
      chain: readableChainName(position.relationships?.chain?.data?.id),
      category: isProtocolPosition ? "defi" : categoryFor(symbol),
      valueUsd,
      change24h: typeof change === "number" && Number.isFinite(change) ? Number(change.toFixed(2)) : null,
    });
  }

  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const portfolioResult = await fetchZerion<ZerionPortfolioResponse>(
    `/wallets/${encodedAddress}/portfolio?filter[positions]=no_filter`,
    apiKey,
  ).catch(() => null);
  const indexedTotal = rawAssets.reduce((sum, asset) => sum + asset.valueUsd, 0);
  const portfolioTotal = finiteNumber(portfolioResult?.data?.attributes?.total?.positions);
  if (portfolioTotal - indexedTotal >= 0.01) rawAssets.push({
    id: "zerion:indexed-remainder",
    symbol: "OTHER",
    name: "Other indexed positions",
    chain: "Multichain",
    category: "other",
    valueUsd: portfolioTotal - indexedTotal,
    change24h: null,
  });

  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const nftResponse = await fetchZerion<ZerionNftResponse>(
    `/wallets/${encodedAddress}/nft-positions/?sort=-floor_price&page[size]=100`,
    apiKey,
    true,
  ).catch(() => null);
  const nftPositions = nftResponse?.data ?? [];
  for (const nft of nftPositions) {
    const valueUsd = finiteNumber(nft.attributes?.value);
    if (valueUsd < 0.01) continue;
    const name = (nft.attributes?.nft_info?.name?.trim() || "NFT position").slice(0, 64);
    rawAssets.push({
      id: `zerion:nft:${nft.id ?? nft.attributes?.nft_info?.contract_address ?? name}`,
      symbol: "NFT",
      name,
      chain: readableChainName(nft.relationships?.chain?.data?.id),
      category: "nft",
      valueUsd,
      change24h: null,
    });
  }

  const { assets, totalValueUsd } = finalizeAssets(rawAssets);
  const chainMap = new Map<string, number>();
  for (const asset of assets) chainMap.set(asset.chain, (chainMap.get(asset.chain) ?? 0) + asset.allocation);
  const chains = [...chainMap.entries()]
    .map(([name, allocation]) => ({ name, allocation: Number(allocation.toFixed(1)) }))
    .filter((chain) => chain.allocation > 0)
    .sort((a, b) => b.allocation - a.allocation);
  const reportedChange = portfolioResult?.data?.attributes?.changes?.percent_1d;
  const weightedChange = totalValueUsd > 0
    ? rawAssets.reduce((sum, asset) => sum + (asset.change24h ?? 0) * asset.valueUsd, 0) / totalValueUsd
    : 0;

  return {
    address,
    totalValueUsd,
    change24h: Number((typeof reportedChange === "number" && Number.isFinite(reportedChange) ? reportedChange : weightedChange).toFixed(2)),
    assets,
    exposure: {
      stablecoins: categoryAllocation(assets, "stablecoin"),
      defi: categoryAllocation(assets, "defi"),
      memecoins: categoryAllocation(assets, "meme"),
      nfts: categoryAllocation(assets, "nft"),
    },
    chains,
    nftCount: nftPositions.reduce((sum, nft) => sum + Math.max(1, finiteNumber(nft.attributes?.amount)), 0),
    protocolCount: protocols.size,
    updatedAt: new Date().toISOString(),
    source: "zerion",
    providerName: "Zerion · fungible, DeFi, and NFT positions",
  };
}

async function makeDeBankSnapshot(address: string, accessKey: string): Promise<PortfolioSnapshot> {
  const encodedAddress = encodeURIComponent(address);
  const total = await fetchDeBank<DeBankTotalBalance>(`/user/total_balance?id=${encodedAddress}`, accessKey);
  const [tokenResult, protocolResult, nftResult] = await Promise.allSettled([
    fetchDeBank<DeBankToken[]>(`/user/all_token_list?id=${encodedAddress}&is_all=false`, accessKey),
    fetchDeBank<DeBankProtocol[]>(`/user/all_simple_protocol_list?id=${encodedAddress}`, accessKey),
    fetchDeBank<DeBankNft[]>(`/user/all_nft_list?id=${encodedAddress}&is_all=false`, accessKey),
  ]);
  const tokens = tokenResult.status === "fulfilled" && Array.isArray(tokenResult.value) ? tokenResult.value : [];
  const protocols = protocolResult.status === "fulfilled" && Array.isArray(protocolResult.value) ? protocolResult.value : [];
  const nfts = nftResult.status === "fulfilled" && Array.isArray(nftResult.value) ? nftResult.value : [];
  const chainNames = new Map((total.chain_list ?? []).map((chain) => [chain.id ?? "", chain.name?.trim() || chain.id || "Unknown"]));
  const chainName = (id?: string) => chainNames.get(id ?? "") ?? id?.toUpperCase() ?? "Unknown";
  const rawAssets: Omit<PortfolioAsset, "allocation" | "color">[] = [];

  for (const token of tokens) {
    const symbol = (token.optimized_symbol || token.display_symbol || token.symbol || "").trim().toUpperCase();
    const name = (token.name?.trim() || symbol).slice(0, 64);
    const valueUsd = finiteNumber(token.price) * finiteNumber(token.amount);
    if (!symbol || valueUsd < 0.01 || looksSuspicious(symbol, name)) continue;
    if (token.is_verified === false && token.is_core === false) continue;
    rawAssets.push({
      id: `debank:${token.chain ?? "unknown"}:${(token.id || symbol).toLowerCase()}`,
      symbol: symbol.slice(0, 18),
      name,
      chain: chainName(token.chain),
      category: categoryFor(symbol),
      valueUsd,
      change24h: null,
    });
  }

  for (const protocol of protocols) {
    const valueUsd = finiteNumber(protocol.net_usd_value);
    if (valueUsd < 0.01) continue;
    const name = (protocol.name?.trim() || protocol.id || "DeFi position").slice(0, 64);
    rawAssets.push({
      id: `debank:protocol:${protocol.id ?? name}`,
      symbol: name.replace(/[^a-z0-9]/gi, "").slice(0, 12).toUpperCase() || "DEFI",
      name: `${name} net position`,
      chain: chainName(protocol.chain),
      category: "defi",
      valueUsd,
      change24h: null,
    });
  }

  const nftGroups = new Map<string, Omit<PortfolioAsset, "allocation" | "color">>();
  for (const nft of nfts) {
    const amount = nft.is_erc1155 ? Math.max(1, finiteNumber(nft.amount)) : 1;
    const valueUsd = finiteNumber(nft.usd_price) * amount;
    if (valueUsd < 0.01) continue;
    const collection = (nft.contract_name?.trim() || nft.name?.trim() || "NFT collection").slice(0, 64);
    const key = `${nft.chain ?? "unknown"}:${nft.collection_id || nft.contract_id || nft.id || collection}`;
    const current = nftGroups.get(key);
    if (current) current.valueUsd += valueUsd;
    else nftGroups.set(key, {
      id: `debank:nft:${key}`,
      symbol: "NFT",
      name: collection,
      chain: chainName(nft.chain),
      category: "nft",
      valueUsd,
      change24h: null,
    });
  }

  const indexedByChain = new Map<string, number>();
  for (const asset of rawAssets) indexedByChain.set(asset.chain, (indexedByChain.get(asset.chain) ?? 0) + asset.valueUsd);
  for (const chain of total.chain_list ?? []) {
    const name = chainName(chain.id);
    const remainder = finiteNumber(chain.usd_value) - (indexedByChain.get(name) ?? 0);
    if (remainder >= 0.01) rawAssets.push({
      id: `debank:${chain.id ?? name}:indexed-remainder`,
      symbol: "OTHER",
      name: "Other indexed positions",
      chain: name,
      category: "other",
      valueUsd: remainder,
      change24h: null,
    });
  }
  const indexedTotal = rawAssets.reduce((sum, asset) => sum + asset.valueUsd, 0);
  const unassigned = finiteNumber(total.total_usd_value) - indexedTotal;
  if (unassigned >= 0.01) rawAssets.push({
    id: "debank:unassigned",
    symbol: "OTHER",
    name: "Other indexed positions",
    chain: "Multichain",
    category: "other",
    valueUsd: unassigned,
    change24h: null,
  });
  rawAssets.push(...nftGroups.values());

  const { assets, totalValueUsd } = finalizeAssets(rawAssets);
  const chainMap = new Map<string, number>();
  for (const asset of assets) chainMap.set(asset.chain, (chainMap.get(asset.chain) ?? 0) + asset.allocation);
  const chains = [...chainMap.entries()]
    .map(([name, allocation]) => ({ name, allocation: Number(allocation.toFixed(1)) }))
    .filter((chain) => chain.allocation > 0)
    .sort((a, b) => b.allocation - a.allocation);

  return {
    address,
    totalValueUsd,
    change24h: 0,
    assets,
    exposure: {
      stablecoins: categoryAllocation(assets, "stablecoin"),
      defi: categoryAllocation(assets, "defi"),
      memecoins: categoryAllocation(assets, "meme"),
      nfts: categoryAllocation(assets, "nft"),
    },
    chains,
    nftCount: nfts.reduce((sum, nft) => sum + (nft.is_erc1155 ? Math.max(1, finiteNumber(nft.amount)) : 1), 0),
    protocolCount: protocols.filter((protocol) => finiteNumber(protocol.net_usd_value) >= 0.01).length,
    updatedAt: new Date().toISOString(),
    source: "debank",
    providerName: "DeBank Pro · all supported chains",
  };
}

function tokenAmount(raw: string | null | undefined, decimals: string | null | undefined) {
  const value = finiteNumber(raw);
  const precision = Math.min(30, Math.max(0, Number.parseInt(decimals ?? "0", 10) || 0));
  return value / 10 ** precision;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cf: { cacheTtl: 30 },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  } as RequestInit);
  if (!response.ok) throw new Error(`Blockscout returned ${response.status}`);
  return readBoundedJson<T>(response, "Blockscout");
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

async function makeBlockscoutSnapshot(address: string, isFallback = false): Promise<PortfolioSnapshot> {
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
      stablecoins: categoryAllocation(assets, "stablecoin"),
      defi: categoryAllocation(assets, "defi"),
      memecoins: categoryAllocation(assets, "meme"),
      nfts: 0,
    },
    chains,
    nftCount: 0,
    protocolCount: 0,
    updatedAt: new Date().toISOString(),
    source: "blockscout",
    providerName: `Blockscout · Ethereum + Arbitrum${isFallback ? " · provider fallback" : ""}`,
  };
}

function normalizeProviderPayload(address: string, payload: unknown): PortfolioSnapshot | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as Partial<PortfolioSnapshot>;
  if (!Array.isArray(candidate.assets) || candidate.assets.length > 100) return null;
  const validCategories = new Set<AssetCategory>(["bluechip", "stablecoin", "defi", "meme", "nft", "other"]);
  const rawAssets: Omit<PortfolioAsset, "allocation" | "color">[] = [];
  for (const entry of candidate.assets) {
    if (!entry || typeof entry !== "object") continue;
    const asset = entry as Partial<PortfolioAsset>;
    if (
      typeof asset.id !== "string" || typeof asset.symbol !== "string" ||
      typeof asset.name !== "string" || typeof asset.chain !== "string" ||
      typeof asset.valueUsd !== "number" || !Number.isFinite(asset.valueUsd) || asset.valueUsd < 0 ||
      typeof asset.category !== "string" || !validCategories.has(asset.category as AssetCategory)
    ) continue;
    rawAssets.push({
      id: asset.id.slice(0, 128),
      symbol: asset.symbol.trim().toUpperCase().slice(0, 18) || "ASSET",
      name: asset.name.trim().slice(0, 64) || "Asset",
      chain: asset.chain.trim().slice(0, 48) || "Unknown",
      category: asset.category as AssetCategory,
      valueUsd: asset.valueUsd,
      change24h: typeof asset.change24h === "number" && Number.isFinite(asset.change24h)
        ? Math.max(-100, Math.min(100_000, asset.change24h))
        : null,
    });
  }
  const { assets, totalValueUsd } = finalizeAssets(rawAssets);
  const chainMap = new Map<string, number>();
  for (const asset of assets) chainMap.set(asset.chain, (chainMap.get(asset.chain) ?? 0) + asset.allocation);
  return {
    address,
    totalValueUsd,
    change24h: typeof candidate.change24h === "number" && Number.isFinite(candidate.change24h)
      ? Math.max(-100, Math.min(100_000, candidate.change24h))
      : 0,
    assets,
    exposure: {
      stablecoins: categoryAllocation(assets, "stablecoin"),
      defi: categoryAllocation(assets, "defi"),
      memecoins: categoryAllocation(assets, "meme"),
      nfts: categoryAllocation(assets, "nft"),
    },
    chains: [...chainMap.entries()]
      .map(([name, allocation]) => ({ name, allocation: Number(allocation.toFixed(1)) }))
      .sort((a, b) => b.allocation - a.allocation),
    nftCount: Number.isSafeInteger(candidate.nftCount) ? Math.max(0, Math.min(1_000_000, candidate.nftCount ?? 0)) : 0,
    protocolCount: Number.isSafeInteger(candidate.protocolCount) ? Math.max(0, Math.min(10_000, candidate.protocolCount ?? 0)) : 0,
    updatedAt: new Date().toISOString(),
    source: "provider",
    providerName: "Configured portfolio provider",
  };
}

export async function GET(request: Request) {
  const rateLimit = checkRateLimit(request, "portfolio", 30, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Too many portfolio requests. Please retry shortly." }, {
      status: 429,
      headers: { ...portfolioHeaders, ...rateLimit.headers },
    });
  }
  const url = new URL(request.url);
  const address = url.searchParams.get("address") ?? "";
  if (!isAddress(address)) return NextResponse.json(
    { error: "A valid EVM wallet address is required." },
    { status: 400, headers: { ...portfolioHeaders, ...rateLimit.headers } },
  );

  const zerionApiKey = process.env.ZERION_API_KEY;
  if (zerionApiKey) {
    try {
      return NextResponse.json(await makeZerionSnapshot(address, zerionApiKey), {
        headers: responseHeaders("zerion", rateLimit.headers),
      });
    } catch {
      // Rate limits, authorization, and temporary outages fall through safely.
    }
  }

  const debankAccessKey = process.env.DEBANK_ACCESS_KEY;
  if (debankAccessKey) {
    try {
      return NextResponse.json(await makeDeBankSnapshot(address, debankAccessKey), {
        headers: responseHeaders("debank", rateLimit.headers),
      });
    } catch {
      // A missing unit balance, IP restriction, or temporary outage falls through safely.
    }
  }

  const providerTemplate = process.env.PORTFOLIO_API_URL_TEMPLATE;
  if (providerTemplate) {
    try {
      const providerUrl = configuredProviderUrl(providerTemplate, address);
      if (!providerUrl) throw new Error("Configured portfolio provider URL is not safe");
      const response = await fetch(providerUrl, {
        headers: process.env.PORTFOLIO_API_KEY ? { Authorization: `Bearer ${process.env.PORTFOLIO_API_KEY}`, Accept: "application/json" } : { Accept: "application/json" },
        cf: { cacheTtl: 30 },
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      } as RequestInit);
      if (response.ok) {
        const normalized = normalizeProviderPayload(address, await readBoundedJson(response, "Configured provider"));
        if (normalized) return NextResponse.json(normalized, { headers: responseHeaders("provider", rateLimit.headers) });
      }
    } catch {
      // Continue to the public, keyless Blockscout adapter.
    }
  }

  try {
    return NextResponse.json(await makeBlockscoutSnapshot(address, Boolean(zerionApiKey || debankAccessKey)), {
      headers: responseHeaders("blockscout", rateLimit.headers),
    });
  } catch {
    return NextResponse.json({ error: "Portfolio indexers are temporarily unavailable. No demo values were substituted." }, {
      status: 503,
      headers: { ...portfolioHeaders, ...rateLimit.headers },
    });
  }
}
