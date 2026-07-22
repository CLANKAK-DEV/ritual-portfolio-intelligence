# Ritual Portfolio Intelligence — Simple Guide

## What is it?

Ritual Portfolio Intelligence turns a wallet address into a clear portfolio report. It shows holdings, chain allocation, stablecoin and DeFi exposure, concentration risk, and practical observations.

The project has two modes:

- **Live preview:** fast, read-only analysis using indexed portfolio data. No wallet signature is required.
- **Verified Ritual analysis:** portfolio data and AI reasoning are executed through Ritual and recorded on-chain.

## How it works

```text
Wallet address
    ↓
Zerion → DeBank → Blockscout fallback
    ↓
Normalized portfolio snapshot
    ↓
Dashboard preview and local risk model
    ↓
Ritual HTTP precompile (0x0801)
    ↓
Portfolio payload and hash stored on-chain
    ↓
Ritual LLM precompile (0x0802)
    ↓
Verified analysis and hash stored on-chain
```

The server uses Zerion first. If Zerion is rate-limited or unavailable, it tries DeBank and then the public Blockscout fallback. Fake portfolio values are never substituted for unavailable data.

## What does the Ritual LLM do?

The LLM receives the portfolio payload fetched by Ritual's HTTP executor. It returns structured JSON containing:

- A risk score from 0 to 100
- A portfolio grade
- A risk label
- A plain-language summary
- Important observations
- Prioritized actions

The contract stores the analysis, its hash, the analysis time, and any executor error. If the Ritual LLM executor is temporarily unavailable, the preview remains usable and the verified analysis can be retried later.

## Why use two Ritual transactions?

The workflow intentionally separates the HTTP and LLM calls:

1. `refreshPortfolio()` fetches and stores the portfolio payload.
2. `analyzePortfolio()` analyzes the stored payload.

This follows Ritual's short-running async execution model and creates an inspectable on-chain boundary between data acquisition and AI reasoning.

## What is RitualWallet escrow?

Ritual executors are paid from the connected wallet's RitualWallet escrow.

- **Native balance:** spendable RITUAL used for gas or deposits.
- **Executor escrow:** funds reserved for HTTP and LLM executors.
- **Lock until block:** the earliest block at which unused escrow may be withdrawn.
- **Sender lock:** prevents overlapping async jobs from the same sender.

Depositing funds does not start an analysis. It only prepares executor fees. The user must still run the HTTP stage and then the verified AI stage.

## Demo walkthrough

1. Open the dashboard and enter any EVM wallet address.
2. Select **Analyze** to load a read-only multichain preview.
3. Connect a wallet and switch to Ritual testnet, chain ID `1979`.
4. Open **Activity** and confirm the sender lock is available.
5. Deposit enough RITUAL into executor escrow.
6. Select **Run on Ritual** to submit the HTTP job.
7. After the portfolio fetch settles, select **Run verified AI**.
8. Follow the lifecycle from submitted to complete and inspect the transaction on the explorer.

## Live deployment

- Dashboard: <https://ritual-portfolio-intelligence.choukerlahoucine.chatgpt.site>
- Verified contract: <https://explorer.ritualfoundation.org/address/0x17cb86d588e1eb924b4fdaac0a0ec2f4cd220b4c>
- Ritual network: testnet, chain ID `1979`

The dashboard may require owner access until it is made public for the final hackathon submission.

## Security model

- Provider credentials are used only in the server-side API route.
- API keys and deployer private keys belong in ignored local environment files or encrypted hosting secrets.
- Private provider credentials are never included in browser bundles, smart-contract source, or on-chain transaction data.
- The contract uses a public Blockscout URL for its HTTP request because on-chain inputs are public.
- The repository's security check rejects tracked environment files and common secret patterns.

This application provides portfolio decision support and is not financial advice.
