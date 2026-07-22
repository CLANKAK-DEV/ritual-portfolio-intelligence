"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  encodeFunctionData,
  formatEther,
  isAddress,
  parseEther,
  type Address,
} from "viem";
import {
  useAccount,
  useBalance,
  useConnect,
  useDisconnect,
  usePublicClient,
  useReadContract,
  useSendTransaction,
  useSwitchChain,
} from "wagmi";
import { analyzeSnapshot, type PortfolioAnalysis, type PortfolioSnapshot } from "@/lib/portfolio";
import { RITUAL_ADDRESSES, ritualChain } from "@/lib/ritual";

type Tab = "overview" | "assets" | "activity";
type PipelineState = "idle" | "fetching" | "reasoning" | "complete" | "error";

const contractAddress = process.env.NEXT_PUBLIC_PORTFOLIO_CONTRACT as Address | undefined;

const consumerAbi = [
  {
    type: "function",
    name: "refreshPortfolio",
    stateMutability: "nonpayable",
    inputs: [{ name: "wallet", type: "address" }, { name: "httpExecutor", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "depositForCaller",
    stateMutability: "payable",
    inputs: [{ name: "lockDuration", type: "uint256" }],
    outputs: [],
  },
] as const;

const walletAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "lockUntil", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const walletDepositAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [{ name: "lockDuration", type: "uint256" }],
    outputs: [],
  },
] as const;

const registryAbi = [
  {
    type: "function",
    name: "getServicesByCapability",
    stateMutability: "view",
    inputs: [{ name: "capability", type: "uint8" }, { name: "checkValidity", type: "bool" }],
    outputs: [{
      type: "tuple[]",
      components: [
        { name: "node", type: "tuple", components: [
          { name: "paymentAddress", type: "address" }, { name: "teeAddress", type: "address" },
          { name: "teeType", type: "uint8" }, { name: "publicKey", type: "bytes" },
          { name: "endpoint", type: "string" }, { name: "certPubKeyHash", type: "bytes32" },
          { name: "capability", type: "uint8" },
        ] },
        { name: "isValid", type: "bool" }, { name: "workloadId", type: "bytes32" },
      ],
    }],
  },
] as const;

const trackerAbi = [
  { type: "function", name: "hasPendingJobForSender", stateMutability: "view", inputs: [{ name: "sender", type: "address" }], outputs: [{ type: "bool" }] },
] as const;

function compactAddress(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Connect wallet";
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function riskTone(score: number) {
  if (score < 45) return "low";
  if (score < 70) return "medium";
  return "high";
}

export function Dashboard({ initialSnapshot, initialAnalysis }: { initialSnapshot: PortfolioSnapshot; initialAnalysis: PortfolioAnalysis }) {
  const [walletInput, setWalletInput] = useState(initialSnapshot.address);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [pipeline, setPipeline] = useState<PipelineState>("complete");
  const [tab, setTab] = useState<Tab>("overview");
  const [notice, setNotice] = useState("");
  const [txHash, setTxHash] = useState<string>();
  const [mobileNav, setMobileNav] = useState(false);
  const [copied, setCopied] = useState(false);

  const { address, chainId, isConnected } = useAccount();
  const { connectors, connect, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const publicClient = usePublicClient();
  const { sendTransactionAsync, isPending: isSending } = useSendTransaction();
  const { data: nativeBalance } = useBalance({ address });
  const { data: escrowBalance } = useReadContract({
    address: RITUAL_ADDRESSES.wallet,
    abi: walletAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 12_000 },
  });
  const { data: lockUntil } = useReadContract({
    address: RITUAL_ADDRESSES.wallet,
    abi: walletAbi,
    functionName: "lockUntil",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const { data: senderLocked } = useReadContract({
    address: RITUAL_ADDRESSES.jobTracker,
    abi: trackerAbi,
    functionName: "hasPendingJobForSender",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 5_000 },
  });

  const chart = useMemo(() => {
    return snapshot.assets.map((asset, index, assets) => {
      const start = assets.slice(0, index).reduce((sum, item) => sum + item.allocation, 0);
      const end = start + asset.allocation;
      return `${asset.color} ${start}% ${end}%`;
    }).join(", ");
  }, [snapshot]);

  async function runPreview(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    if (!isAddress(walletInput)) {
      setPipeline("error");
      setNotice("Enter a valid 0x EVM wallet address.");
      return;
    }
    try {
      setPipeline("fetching");
      const response = await fetch(`/api/portfolio?address=${walletInput}`);
      if (!response.ok) throw new Error("Portfolio provider did not return a valid snapshot.");
      const nextSnapshot = await response.json() as PortfolioSnapshot;
      setSnapshot(nextSnapshot);
      setPipeline("reasoning");
      await new Promise((resolve) => setTimeout(resolve, 480));
      setAnalysis(analyzeSnapshot(nextSnapshot));
      setPipeline("complete");
    } catch (error) {
      setPipeline("error");
      setNotice(error instanceof Error ? error.message : "Analysis failed. Try again.");
    }
  }

  async function depositFees() {
    if (!address) return;
    try {
      setNotice("Confirm the RitualWallet deposit in your wallet.");
      const data = encodeFunctionData({ abi: walletDepositAbi, functionName: "deposit", args: [100_000n] });
      const hash = await sendTransactionAsync({ to: RITUAL_ADDRESSES.wallet, data, value: parseEther("0.5") });
      setTxHash(hash);
      setNotice("Fee deposit submitted. It will appear after confirmation.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message.split("\n")[0] : "Deposit was not submitted.");
    }
  }

  async function runOnchainRefresh() {
    if (!address) {
      if (connectors[0]) {
        connect({ connector: connectors[0] });
      } else {
        setNotice("Install or unlock an EVM wallet to submit a verifiable Ritual execution. Preview analysis stays signature-free.");
      }
      return;
    }
    if (!publicClient) {
      setNotice("Ritual RPC is not ready yet. Please try again in a moment.");
      return;
    }
    if (!contractAddress) {
      setNotice("Deploy the included contract and set NEXT_PUBLIC_PORTFOLIO_CONTRACT to enable on-chain refresh.");
      return;
    }
    if (chainId !== ritualChain.id) {
      switchChain({ chainId: ritualChain.id });
      return;
    }
    if (senderLocked) {
      setNotice("This wallet already has a pending Ritual job. Wait for settlement before submitting another.");
      return;
    }
    try {
      setNotice("Discovering a healthy Ritual HTTP executor…");
      const services = await publicClient.readContract({
        address: RITUAL_ADDRESSES.registry,
        abi: registryAbi,
        functionName: "getServicesByCapability",
        args: [0, true],
      });
      const executor = services[0]?.node.teeAddress;
      if (!executor) throw new Error("No healthy Ritual HTTP executor is currently registered.");
      const data = encodeFunctionData({
        abi: consumerAbi,
        functionName: "refreshPortfolio",
        args: [snapshot.address as Address, executor],
      });
      const hash = await sendTransactionAsync({ to: contractAddress, data, gas: 2_000_000n });
      setTxHash(hash);
      setNotice("Ritual HTTP job submitted. The TEE-attested snapshot will settle on-chain.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message.split("\n")[0] : "On-chain refresh failed.");
    }
  }

  function downloadReport() {
    const payload = JSON.stringify({ snapshot, analysis, generatedAt: new Date().toISOString(), disclaimer: "Decision support only; not financial advice." }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ritual-portfolio-${snapshot.address.slice(0, 8)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function copyPortfolioAddress() {
    await navigator.clipboard.writeText(snapshot.address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function reviewAction(title: string, detail: string) {
    setNotice(`${title}: ${detail} This recommendation is informational and requires your approval.`);
    window.setTimeout(() => document.querySelector(".notice")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  }

  const isRitualNetwork = chainId === ritualChain.id;
  const hasContract = Boolean(contractAddress);
  const onchainLabel = isSending
    ? "Submitting…"
    : !address
      ? "Connect to execute"
      : !hasContract
        ? "Preview mode"
        : !isRitualNetwork
          ? "Switch to Ritual"
          : "Run on Ritual";

  const connectButton = isConnected ? (
    <button className="wallet-button connected" onClick={() => disconnect()} aria-label="Disconnect wallet">
      <span className="status-dot" /> {compactAddress(address)}
    </button>
  ) : (
    <button className="wallet-button" onClick={() => connectors[0] && connect({ connector: connectors[0] })} disabled={isConnecting}>
      {isConnecting ? "Connecting…" : "Connect wallet"}
    </button>
  );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Skip to portfolio</a>
      <header className="topbar">
        <a className="brand" href="#main" aria-label="Ritual Portfolio Intelligence home">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>RITUAL<span>/INTEL</span></span>
        </a>
        <nav className={mobileNav ? "nav-links open" : "nav-links"} aria-label="Primary navigation">
          <button className={tab === "overview" ? "active" : ""} onClick={() => { setTab("overview"); setMobileNav(false); }}>Overview</button>
          <button className={tab === "assets" ? "active" : ""} onClick={() => { setTab("assets"); setMobileNav(false); }}>Assets</button>
          <button className={tab === "activity" ? "active" : ""} onClick={() => { setTab("activity"); setMobileNav(false); }}>Activity</button>
          <a href="https://docs.ritualfoundation.org" target="_blank" rel="noreferrer">Ritual docs ↗</a>
        </nav>
        <div className="top-actions">
          <span className={`network-pill ${isConnected && !isRitualNetwork ? "wrong-network" : ""}`}><span /> {isConnected && !isRitualNetwork ? "Wrong network" : "Ritual testnet"}</span>
          {connectButton}
          <button className="menu-button" onClick={() => setMobileNav((value) => !value)} aria-expanded={mobileNav} aria-label="Toggle navigation">☰</button>
        </div>
      </header>

      <main id="main">
        <section className="hero-grid">
          <div className="hero-copy">
            <div className="eyebrow"><span>◇</span> TEE-verified portfolio intelligence <b>LIVE BETA</b></div>
            <h1>Your portfolio,<br /><em>interpreted on-chain.</em></h1>
            <p>Turn a wallet address into clear, defensible portfolio intelligence—powered by Ritual&apos;s native internet access and verifiable AI execution.</p>
            <form className="wallet-search" onSubmit={runPreview}>
              <label htmlFor="wallet-address">Wallet address</label>
              <div className="search-row">
                <span className="search-icon">⌕</span>
                <input id="wallet-address" value={walletInput} onChange={(event) => setWalletInput(event.target.value)} spellCheck={false} aria-describedby="wallet-help" />
                <button type="submit" disabled={pipeline === "fetching" || pipeline === "reasoning"} aria-live="polite">
                  {pipeline === "fetching" ? "Fetching" : pipeline === "reasoning" ? "Reasoning" : "Analyze"} <span>→</span>
                </button>
              </div>
              <div className="search-meta"><small id="wallet-help">Read-only preview. No signature required.</small><button type="button" onClick={() => setWalletInput(initialSnapshot.address)}>Use demo wallet</button></div>
            </form>
            <div className="trust-row" aria-label="Product guarantees"><span><i>01</i> Multichain view</span><span><i>02</i> TEE-attested</span><span><i>03</i> User-controlled</span></div>
          </div>

          <aside className="ritual-card" aria-label="Ritual execution status">
            <div className="ritual-card-head"><span className="ritual-glyph">R</span><div><strong>Ritual execution</strong><small>Native on-chain compute</small></div><span className="live-badge"><i /> LIVE</span></div>
            <div className="execution-flow">
              <div className={pipeline === "fetching" ? "flow-step current" : "flow-step done"}><span>⇄</span><div><strong>HTTP precompile</strong><small>0x0801 · Portfolio data</small></div><b>{pipeline === "fetching" ? "RUN" : "✓"}</b></div>
              <div className="flow-line" />
              <div className={pipeline === "reasoning" ? "flow-step current ai" : pipeline === "complete" ? "flow-step done ai" : "flow-step ai"}><span>◇</span><div><strong>LLM precompile</strong><small>0x0802 · Risk reasoning</small></div><b>{pipeline === "reasoning" ? "RUN" : pipeline === "complete" ? "✓" : "—"}</b></div>
              <div className="flow-line" />
              <div className="flow-step"><span>◷</span><div><strong>Scheduler</strong><small>Recurring intelligence</small></div><b>24H</b></div>
            </div>
            <div className="tee-row"><span>◆</span><div><strong>Verifiable execution</strong><small>Every result is cryptographically tied to its request</small></div><a href="https://docs.ritualfoundation.org" target="_blank" rel="noreferrer" aria-label="Read Ritual execution documentation">Learn ↗</a></div>
          </aside>
        </section>

        {notice && <div className="notice" role="status"><span>i</span><p>{notice}</p>{txHash && <a href={`https://explorer.ritualfoundation.org/tx/${txHash}`} target="_blank" rel="noreferrer">View transaction ↗</a>}<button onClick={() => setNotice("")} aria-label="Dismiss notice">×</button></div>}

        <section className="dashboard-heading">
          <div><span className="section-index">01 / PORTFOLIO</span><h2>Intelligence overview</h2><button className="address-copy" onClick={copyPortfolioAddress} aria-label="Copy analyzed wallet address"><span>{snapshot.address}</span><b>{copied ? "Copied" : "Copy"}</b></button></div>
          <div className="dashboard-actions">
            <span className={`source-badge ${snapshot.source}`}><i /> {snapshot.source === "provider" ? "Live provider" : "Demo adapter"}</span>
            <button className="outline-button" onClick={downloadReport}>↓ Export report</button>
            <button className="outline-button primary" onClick={runOnchainRefresh} disabled={isSending || isSwitching}>{onchainLabel}</button>
          </div>
        </section>

        <section className="portfolio-toolbar" aria-label="Portfolio workspace controls">
          <div className="view-tabs" role="tablist" aria-label="Portfolio views">
            {(["overview", "assets", "activity"] as Tab[]).map((item) => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}<span>{item === "assets" ? snapshot.assets.length : item === "activity" ? (txHash ? 1 : 0) : ""}</span></button>)}
          </div>
          <div className="freshness"><span>Last analyzed</span><strong>{new Date(snapshot.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong></div>
        </section>

        {tab === "overview" && <>
          <section className="metrics-grid" aria-label="Portfolio metrics">
            <article className="metric-card value-card"><div className="metric-label">Portfolio value <span>USD</span></div><strong>{formatUsd(snapshot.totalValueUsd)}</strong><p className={snapshot.change24h >= 0 ? "positive" : "negative"}>{snapshot.change24h >= 0 ? "↗" : "↘"} {Math.abs(snapshot.change24h)}% <small>vs. previous 24h</small></p><div className="sparkline" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /></div></article>
            <article className="metric-card risk-card"><div className="metric-label">Risk score <span className={`risk-pill ${riskTone(analysis.riskScore)}`}>{analysis.riskLabel}</span></div><div className="risk-value"><strong>{analysis.riskScore}</strong><span>/100</span><b>{analysis.grade}</b></div><div className="risk-track"><i style={{ width: `${analysis.riskScore}%` }} /></div><p>Concentration and speculative exposure are the main drivers.</p></article>
            <article className="metric-card position-card"><div className="metric-label">Largest position <span>{snapshot.assets[0].chain}</span></div><div className="token-row"><span className="token-icon">Ξ</span><div><strong>{snapshot.assets[0].symbol}</strong><small>{snapshot.assets[0].name}</small></div><b>{snapshot.assets[0].allocation.toFixed(1)}%</b></div><div className="allocation-track"><i style={{ width: `${snapshot.assets[0].allocation}%` }} /></div></article>
            <article className="metric-card exposure-card"><div className="metric-label">Exposure mix <span>{snapshot.assets.length} assets</span></div><div className="mini-stats"><div><span>Stable</span><strong>{snapshot.exposure.stablecoins}%</strong></div><div><span>DeFi</span><strong>{snapshot.exposure.defi}%</strong></div><div><span>Meme</span><strong>{snapshot.exposure.memecoins}%</strong></div><div><span>NFT</span><strong>{snapshot.exposure.nfts}%</strong></div></div></article>
          </section>

          <section className="content-grid">
            <article className="panel allocation-panel">
              <div className="panel-head"><div><span className="section-index">ALLOCATION</span><h3>Asset distribution</h3></div><button onClick={() => setTab("assets")}>View all →</button></div>
              <div className="allocation-layout">
                <div className="donut" style={{ background: `conic-gradient(${chart})` }}><div><strong>{snapshot.assets.length}</strong><span>assets</span></div></div>
                <div className="asset-list">{snapshot.assets.slice(0, 5).map((asset) => <div key={asset.symbol}><i style={{ background: asset.color }} /><span>{asset.symbol}</span><div><b>{asset.allocation.toFixed(1)}%</b><small>{formatUsd(asset.valueUsd)}</small></div></div>)}</div>
              </div>
            </article>

            <article className="panel ai-panel">
              <div className="ai-border" />
              <div className="panel-head"><div><span className="section-index pink">◇ RITUAL AI ANALYSIS</span><h3>Portfolio intelligence</h3></div><span className="model-badge">GLM-4.7 · TEE</span></div>
              <p className="ai-summary">{analysis.summary}</p>
              <div className="observation-list">{analysis.observations.map((observation, index) => <div key={observation}><span>0{index + 1}</span><p>{observation}</p></div>)}</div>
              <div className="analysis-meta"><span>◆ TEE verified</span><span>Updated {new Date(snapshot.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
            </article>
          </section>

          <section className="actions-section">
            <div className="section-title-row"><div><span className="section-index">02 / RECOMMENDED ACTIONS</span><h2>Improve your position</h2></div><p>Prioritized by potential risk reduction</p></div>
            <div className="action-grid">{analysis.actions.map((action, index) => <article key={action.title} className={`action-card impact-${action.impact}`}><div className="action-number">0{index + 1}</div><span className="impact-label">{action.impact} impact</span><h3>{action.title}</h3><p>{action.detail}</p><button onClick={() => reviewAction(action.title, action.detail)}>Review recommendation <span>→</span></button></article>)}</div>
          </section>
        </>}

        {tab === "assets" && <section className="table-panel">
          <div className="panel-head"><div><span className="section-index">ALL POSITIONS</span><h2>Asset inventory</h2></div><span>{formatUsd(snapshot.totalValueUsd)} total</span></div>
          <div className="asset-table" role="table"><div className="table-row table-head" role="row"><span>Asset</span><span>Chain</span><span>Category</span><span>Value</span><span>Allocation</span><span>24h</span></div>{snapshot.assets.map((asset) => <div className="table-row" role="row" key={asset.symbol}><span><i style={{ background: asset.color }} /> <b>{asset.symbol}</b><small>{asset.name}</small></span><span>{asset.chain}</span><span><b className={`category-pill category-${asset.category}`}>{asset.category}</b></span><span>{formatUsd(asset.valueUsd)}</span><span className="table-allocation"><b>{asset.allocation.toFixed(1)}%</b><i><em style={{ width: `${asset.allocation}%`, background: asset.color }} /></i></span><span className={asset.change24h >= 0 ? "positive" : "negative"}>{asset.change24h >= 0 ? "+" : ""}{asset.change24h}%</span></div>)}</div>
        </section>}

        {tab === "activity" && <section className="activity-grid">
          <article className="panel"><div className="panel-head"><div><span className="section-index">ASYNC LIFECYCLE</span><h2>Ritual job activity</h2></div><span className={`job-status ${txHash ? "submitted" : "idle"}`}>{txHash ? "1 active job" : "No active jobs"}</span></div>{!txHash && <div className="activity-empty"><span>◇</span><strong>Your execution history will appear here.</strong><p>Connect a wallet and run an on-chain refresh to create a TEE-verified portfolio snapshot.</p><button onClick={runOnchainRefresh}>{address ? "Run first analysis" : "Connect to get started"}</button></div>}{txHash && <div className="timeline">{["Submitted", "Committed", "Executor processing", "Settling", "Complete"].map((item, index) => <div className={index === 0 ? "complete" : index === 1 ? "current" : "pending"} key={item}><i /> <span>{item}</span><small>{index === 0 ? "Wallet transaction" : index === 1 ? "AsyncJobTracker" : index === 2 ? "TEE executor" : index === 3 ? "SPC replay" : "On-chain state"}</small></div>)}</div>}</article>
          <article className="panel wallet-status"><span className="section-index">EXECUTION WALLET</span><h2>RitualWallet</h2><dl><div><dt>Connected EOA</dt><dd>{compactAddress(address)}</dd></div><div><dt>Native balance</dt><dd>{nativeBalance ? Number(formatEther(nativeBalance.value)).toFixed(3) : "—"} RITUAL</dd></div><div><dt>Executor escrow</dt><dd>{escrowBalance !== undefined ? Number(formatEther(escrowBalance)).toFixed(3) : "—"} RITUAL</dd></div><div><dt>Lock until block</dt><dd>{lockUntil?.toString() ?? "—"}</dd></div><div><dt>Sender lock</dt><dd className={senderLocked ? "warn" : "ok"}>{senderLocked ? "Pending job" : "Available"}</dd></div></dl><button className="outline-button primary full" onClick={depositFees} disabled={!address || isSending}>Deposit 0.5 RITUAL</button></article>
        </section>}

        <section className="architecture-strip">
          <div><span className="section-index">BUILT NATIVE ON RITUAL</span><h2>Internet access meets verifiable AI.</h2></div>
          <div className="architecture-flow"><span>Wallet</span><b>→</b><span>HTTP <i>0x0801</i></span><b>→</b><span>LLM <i>0x0802</i></span><b>→</b><span>On-chain state</span></div>
        </section>
      </main>

      <footer><div className="brand compact"><span className="brand-mark"><i /><i /><i /></span><span>RITUAL<span>/INTEL</span></span></div><p>Decision support only. Not financial advice.</p><div><a href="https://github.com/ritual-foundation/ritual-dapp-skills" target="_blank" rel="noreferrer">Skills ↗</a><a href="https://explorer.ritualfoundation.org" target="_blank" rel="noreferrer">Explorer ↗</a></div></footer>
    </div>
  );
}
