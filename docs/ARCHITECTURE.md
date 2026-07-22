# Ritual Portfolio Intelligence

## Product

Ritual Portfolio Intelligence is a wallet-risk copilot that turns multichain portfolio data into verifiable, recurring on-chain analysis. The first release indexes priced Ethereum and Arbitrum positions through Blockscout and supports a configurable provider override.

## Ritual projection

| Capability | Ritual primitive | Address |
| --- | --- | --- |
| Fetch normalized wallet holdings | HTTP precompile | `0x0000000000000000000000000000000000000801` |
| Produce structured risk analysis | LLM precompile | `0x0000000000000000000000000000000000000802` |
| Run periodic refreshes | Scheduler | `0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B` |
| Pay executor and scheduled-call fees | RitualWallet | `0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948` |
| Discover live executors | TEEServiceRegistry | `0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F` |
| Track async jobs | AsyncJobTracker | `0xC069FFCa0389f44eCA2C626e55491b0ab045AEF5` |

## Architecture

```text
Dashboard / wallet
  |-- preview --> Portfolio API route --> normalized PortfolioSnapshot
  |-- commit ----> PortfolioIntelligence.sol
                      |-- refreshPortfolio() --> HTTP 0x0801 --> raw snapshot stored on-chain
                      |-- analyzePortfolio() --> LLM 0x0802 --> structured analysis stored on-chain
                      |-- scheduleRefresh() --> Scheduler --> recurring refreshPortfolio()
                      |-- events --> dashboard/indexer history
```

HTTP and LLM are two separate short-running async calls because Ritual allows one such precompile call per transaction. The contract stores the HTTP result between calls. This makes the two-step flow inspectable and prevents hidden off-chain orchestration.

## Trust and persistence

- The browser preview aggregates priced Ethereum and Arbitrum positions. The on-chain HTTP step independently attests Blockscout's public Ethereum token-balance response.
- Analysis is produced by Ritual's native LLM executor in a TEE and the result is written by the fulfilled transaction replay.
- The contract builds the 30-field LLM request itself from the stored HTTP payload, so browser-supplied content cannot be substituted for the attested source.
- The contract stores content hashes plus the latest payloads and emits a complete event trail. A production indexer can retain full history without making the contract an expensive database.
- No user private key, provider API key, or secret is committed to source control. Deployment and provider credentials are injected through environment variables.

## Async lifecycle

The dashboard represents the Ritual lifecycle as: preparing, wallet confirmation, submitted, committed, executing, settling, settled, and complete. Failed or expired requests surface a retry path. The sender-lock check prevents submitting another async transaction from the same wallet before settlement.

## Scheduling

The contract schedules only HTTP refreshes. The LLM analysis is a separate transaction, preserving the one-SPC-per-transaction rule. A production automation setup can schedule refresh and analysis at offset intervals, or trigger analysis after observing `PortfolioFetched`.

## Security boundaries

- Only the owner can change the API base URL or create/cancel schedules.
- Callback injection is not used for short-running HTTP/LLM calls; results are decoded during fulfilled replay.
- Scheduler callbacks require `msg.sender` to be the canonical Scheduler.
- API URLs are assembled from an owner-controlled HTTPS prefix, a validated EVM address, and an owner-controlled suffix.
- LLM output is treated as untrusted bytes; the UI validates the expected JSON shape and falls back to a safe summary.
