export type AssetCategory = "bluechip" | "stablecoin" | "defi" | "meme" | "nft" | "other";

export type PortfolioAsset = {
  id: string;
  symbol: string;
  name: string;
  chain: string;
  category: AssetCategory;
  valueUsd: number;
  allocation: number;
  change24h: number | null;
  color: string;
};

export type PortfolioSnapshot = {
  address: string;
  totalValueUsd: number;
  change24h: number;
  assets: PortfolioAsset[];
  exposure: {
    stablecoins: number;
    defi: number;
    memecoins: number;
    nfts: number;
  };
  chains: { name: string; allocation: number }[];
  nftCount: number;
  protocolCount: number;
  updatedAt: string;
  source: "demo" | "provider" | "zerion" | "debank" | "blockscout";
  providerName: string;
};

export type PortfolioAnalysis = {
  riskScore: number;
  grade: string;
  riskLabel: "Low" | "Moderate" | "Elevated" | "High";
  summary: string;
  observations: string[];
  actions: { title: string; detail: string; impact: "high" | "medium" | "low" }[];
};

const assetSeed = [
  { symbol: "ETH", name: "Ethereum", chain: "Ethereum", category: "bluechip" as const, base: 7420, change24h: 3.8, color: "#19D184" },
  { symbol: "USDC", name: "USD Coin", chain: "Ethereum", category: "stablecoin" as const, base: 2525, change24h: 0.02, color: "#BFFF00" },
  { symbol: "UNI", name: "Uniswap", chain: "Ethereum", category: "defi" as const, base: 1425, change24h: -1.4, color: "#FF1DCE" },
  { symbol: "ARB", name: "Arbitrum", chain: "Arbitrum", category: "defi" as const, base: 910, change24h: 2.2, color: "#36A3FF" },
  { symbol: "PEPE", name: "Pepe", chain: "Ethereum", category: "meme" as const, base: 995, change24h: 8.7, color: "#FACC15" },
  { symbol: "NFTs", name: "Collectibles", chain: "Ethereum", category: "nft" as const, base: 960, change24h: -0.6, color: "#8B5CF6" },
];

export function makeDemoSnapshot(address: string): PortfolioSnapshot {
  const tail = Number.parseInt(address.slice(-6), 16) || 42;
  const drift = ((tail % 17) - 8) / 100;
  const values = assetSeed.map((asset, index) => ({
    ...asset,
    valueUsd: Math.max(120, Math.round(asset.base * (1 + drift * (index % 2 === 0 ? 1 : -0.55)))),
  }));
  const totalValueUsd = values.reduce((sum, item) => sum + item.valueUsd, 0);
  const assets = values.map((asset) => ({
    id: `${asset.chain.toLowerCase()}:${asset.symbol.toLowerCase()}`,
    symbol: asset.symbol,
    name: asset.name,
    chain: asset.chain,
    category: asset.category,
    change24h: asset.change24h,
    color: asset.color,
    valueUsd: asset.valueUsd,
    allocation: Number(((asset.valueUsd / totalValueUsd) * 100).toFixed(1)),
  }));
  const byCategory = (category: AssetCategory) =>
    Number(assets.filter((asset) => asset.category === category).reduce((sum, asset) => sum + asset.allocation, 0).toFixed(1));

  return {
    address,
    totalValueUsd,
    change24h: Number((assets.reduce((sum, asset) => sum + asset.change24h * asset.allocation, 0) / 100).toFixed(2)),
    assets,
    exposure: {
      stablecoins: byCategory("stablecoin"),
      defi: byCategory("defi"),
      memecoins: byCategory("meme"),
      nfts: byCategory("nft"),
    },
    chains: [
      { name: "Ethereum", allocation: Number(assets.filter((asset) => asset.chain === "Ethereum").reduce((sum, asset) => sum + asset.allocation, 0).toFixed(1)) },
      { name: "Arbitrum", allocation: Number(assets.filter((asset) => asset.chain === "Arbitrum").reduce((sum, asset) => sum + asset.allocation, 0).toFixed(1)) },
    ],
    nftCount: 7,
    protocolCount: 2,
    updatedAt: new Date().toISOString(),
    source: "demo",
    providerName: "Demo adapter",
  };
}

export function analyzeSnapshot(snapshot: PortfolioSnapshot): PortfolioAnalysis {
  if (snapshot.assets.length === 0 || snapshot.totalValueUsd <= 0) {
    return {
      riskScore: 0,
      grade: "N/A",
      riskLabel: "Low",
      summary: "No priced assets were found on the supported Ethereum and Arbitrum networks. Unpriced, spam, and dust tokens are excluded from the risk model.",
      observations: [
        "No material priced ERC-20 or native-token balance is currently visible.",
        snapshot.nftCount > 0
          ? `${snapshot.nftCount} NFT${snapshot.nftCount === 1 ? " is" : "s are"} indexed; only positions with a defensible USD price affect exposure.`
          : "NFTs without a reliable market price are not assigned an invented USD value.",
        "Add another wallet address or return after the indexer has processed recent transfers.",
      ],
      actions: [
        { title: "Review indexed networks", detail: snapshot.source === "debank" ? "DeBank covers supported EVM chains; confirm recent positions after indexing completes." : "The fallback adapter currently indexes Ethereum and Arbitrum through Blockscout.", impact: "low" },
        { title: "Verify recent transfers", detail: "Recently confirmed assets may take a short time to appear in explorer indexes.", impact: "low" },
        { title: "Keep valuation defensible", detail: "Unpriced and suspicious tokens remain excluded instead of inflating portfolio value.", impact: "low" },
      ],
    };
  }

  const largest = snapshot.assets[0];
  const concentration = Math.max(...snapshot.assets.map((asset) => asset.allocation));
  const riskScore = Math.min(
    96,
    Math.max(
      18,
      Math.round(28 + concentration * 0.58 + snapshot.exposure.memecoins * 1.15 - snapshot.exposure.stablecoins * 0.42),
    ),
  );
  const grade = riskScore < 35 ? "A" : riskScore < 50 ? "A−" : riskScore < 65 ? "B+" : riskScore < 78 ? "B" : "C+";
  const riskLabel = riskScore < 35 ? "Low" : riskScore < 55 ? "Moderate" : riskScore < 75 ? "Elevated" : "High";

  return {
    riskScore,
    grade,
    riskLabel,
    summary: `The portfolio is led by ${largest.symbol} at ${largest.allocation.toFixed(1)}%. ${snapshot.exposure.stablecoins.toFixed(1)}% in stable assets provides a liquidity buffer, while ${snapshot.exposure.memecoins.toFixed(1)}% meme exposure adds tail risk.`,
    observations: [
      `${largest.symbol} is the largest single position and the main driver of portfolio volatility.`,
      `DeFi exposure is ${snapshot.exposure.defi.toFixed(1)}% across ${snapshot.assets.filter((asset) => asset.category === "defi").length} protocols.`,
      `The portfolio spans ${snapshot.chains.length} active network${snapshot.chains.length === 1 ? "" : "s"}; ${snapshot.chains[0].name} represents ${snapshot.chains[0].allocation.toFixed(1)}%.`,
    ],
    actions: [
      {
        title: concentration > 50 ? `Trim ${largest.symbol} concentration` : "Maintain core allocation",
        detail: concentration > 50 ? "Rebalance 10–15% into stable or uncorrelated assets to reduce drawdown sensitivity." : "No single holding currently dominates the portfolio.",
        impact: concentration > 50 ? "high" : "low",
      },
      {
        title: snapshot.exposure.stablecoins < 15 ? "Build a liquidity reserve" : "Put idle stables to work",
        detail: snapshot.exposure.stablecoins < 15 ? "Target a 15–20% stablecoin buffer for optionality." : "Consider conservative, audited lending venues for a portion of idle stablecoins.",
        impact: "medium",
      },
      {
        title: "Monitor speculative exposure",
        detail: `Set a review trigger if meme assets move above ${Math.max(12, Math.round(snapshot.exposure.memecoins + 5))}% of portfolio value.`,
        impact: snapshot.exposure.memecoins > 10 ? "high" : "low",
      },
    ],
  };
}
