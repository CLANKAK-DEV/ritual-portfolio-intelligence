# Ritual Portfolio Intelligence

A hackathon-ready wallet intelligence product built natively on Ritual Chain. It combines an interactive portfolio dashboard with Ritual's HTTP, LLM, Scheduler, executor registry, async job tracker, and execution wallet primitives.

![Ritual Portfolio Intelligence social card](public/og.png)

## What is included

- A responsive, accessible portfolio dashboard with wallet connection, risk scoring, exposure analysis, actions, JSON export, and async lifecycle UI.
- A normalized portfolio API with a deterministic demo adapter and a configurable production-provider adapter.
- `PortfolioIntelligence.sol`, which requests portfolio data through Ritual HTTP, sends structured prompts through Ritual LLM, stores hashes/results on-chain, emits indexable events, and schedules recurring refreshes.
- RitualWallet fee deposit controls, sender-lock checks, and live HTTP executor discovery in the frontend.
- Hardhat deployment, codec tests, SSR tests, linting, and a read-only Ritual network health check.

The full system design and trust boundaries are documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run locally

Requirements: Node.js 22.13+ and npm.

```bash
npm install
copy .env.example .env
npm run dev
```

Open `http://localhost:3000`. Without a provider key, any valid EVM address produces a stable demo snapshot so judges can explore the complete product immediately.

## Configure live portfolio data

Set `PORTFOLIO_API_URL_TEMPLATE` to an HTTPS endpoint that returns a normalized object with `totalValueUsd` and an `assets` array. The route replaces `{address}` and can pass `PORTFOLIO_API_KEY` as a bearer token. Unsupported or unavailable responses fall back to the demo adapter.

## Verify

```bash
npm run contracts:compile
npm run build
npm test
npm run lint
npm run ritual:check
```

`ritual:check` is read-only. It verifies chain ID 1979, the canonical system-contract bytecode, and current HTTP executor availability.

## Deploy the contract

1. Copy `.env.example` to `.env` and use a newly created deployer. Never paste or commit a private key.
2. Fund the deployer with Ritual testnet RITUAL.
3. Set `PRIVATE_KEY`, `RITUAL_RPC_URL`, and `PORTFOLIO_API_BASE_URL`. The API base must be public HTTPS and end in `?address=`.
4. Run `npm run contracts:deploy`.
5. Put the printed address in `NEXT_PUBLIC_PORTFOLIO_CONTRACT`, rebuild, and redeploy the web app.
6. Deposit executor fees into RitualWallet from the dashboard before submitting HTTP or LLM jobs.

The on-chain workflow intentionally uses two transactions: `refreshPortfolio` invokes HTTP, then `analyzePortfolio` invokes LLM. This follows Ritual's one short-running async precompile per transaction rule and leaves an auditable state transition between data acquisition and reasoning.

## Submission narrative

The differentiator is not an external LLM behind a dashboard. Ritual attests the portfolio response, executes model inference natively, persists the intelligence on-chain, and schedules future refreshes. Judges can use preview mode without funds, then inspect the included contract and live Ritual integration path.

This product provides decision support only and is not financial advice.
