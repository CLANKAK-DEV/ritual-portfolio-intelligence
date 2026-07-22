# Security Audit Report — Ritual Portfolio Intelligence — 2026-07-22

## 1. Executive summary

The application, Cloudflare Worker, API routes, dependency tree, Git history, CI workflow, and Ritual smart contract were reviewed using the supplied project-security-auditor skill. The audit identified 0 Critical, 1 High, 6 Medium, and 2 Low findings; every confirmed finding was patched, and both the complete and production-only dependency audits now report zero known vulnerabilities. The completion condition is met: no confirmed Critical or High issue remains open, secrets are excluded from tracked files and reachable Git history, and all post-patch gates pass.

## 2. Project architecture detected

- Next.js 16 and React 19 application built with vinext/Vite and deployed through a Cloudflare Worker.
- Public, read-only portfolio API integrating Zerion, DeBank, a configurable provider, and Blockscout fallbacks.
- Same-origin JSON-RPC relay used by Wagmi/Viem for read and simulation calls to Ritual testnet.
- Solidity 0.8.24 contract using Ritual HTTP, LLM, Scheduler, RitualWallet, tracker, registry, and model primitives.
- Wallet signature is the user authentication boundary for on-chain actions; portfolio lookup itself intentionally reads public blockchain data without an application account.
- GitHub Actions CI, npm lockfile, Hardhat contract workflow, and environment-variable-based provider credentials.

## 3. Tools executed

- `npm audit --json` and `npm audit --omit=dev --json` for dependency advisories.
- `npm run security:check` for tracked-file and reachable-history secret detection.
- `rg` manual static searches for command execution, unsafe HTML, dynamic code evaluation, weak randomness, path handling, authorization, Solidity external calls, `tx.origin`, `delegatecall`, and secret patterns.
- `npm ci --legacy-peer-deps`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.
- `npm run contracts:compile` and the Hardhat local contract security tests included in `npm test`.
- `npm run ritual:check` for chain ID, system contracts, executors, and registered-model health.
- Manual creation-bytecode comparison between the deployment transaction and the local artifact, including constructor arguments; the comparison was exact.
- Semgrep, CodeQL, Gitleaks, TruffleHog, OSV-Scanner, Slither, Echidna, and Forge were skipped because they were not installed in the environment. Their absence is recorded rather than silently treated as a pass.

## 4. Critical findings

None found.

## 5. High findings

## [SEC-001] Known vulnerable dependency versions in the locked tree

- Severity: High
- Confidence: Confirmed
- CWE: CWE-1104
- OWASP category: A06:2021 — Vulnerable and Outdated Components
- File: package.json; package-lock.json
- Lines: package.json 19-61; package-lock.json dependency records
- Status: Patched

### Evidence

The baseline npm audit reported 41 advisories: 14 High, 26 Moderate, and 1 Low. The affected tree included production and development transitive packages.

### Root cause

Framework, networking, image, WebSocket, and build-tool versions had accumulated vulnerable transitive releases, and CI did not enforce a production dependency audit.

### Impact

Depending on the reachable package path, known flaws could weaken network request handling, parsing, or build/development tooling. Version presence was confirmed; no active exploitation or credential exposure was found.

### Secure remediation

Framework and direct dependencies were upgraded, narrowly scoped npm overrides were added for fixed transitive versions, and CI now fails on a production High-or-higher advisory.

### Validation test

`npm audit --audit-level=low` and `npm audit --omit=dev --audit-level=high` both complete with zero vulnerabilities.

## 6. Medium findings

## [SEC-002] Public RPC route allowed unrestricted upstream method relay

- Severity: Medium
- Confidence: Confirmed
- CWE: CWE-284
- OWASP category: API4:2023 — Unrestricted Resource Consumption
- File: app/api/rpc/route.ts; lib/rpc-security.ts
- Lines: app/api/rpc/route.ts 24-83; lib/rpc-security.ts 1-84
- Status: Patched

### Evidence

The original route forwarded arbitrary JSON-RPC payloads to the configured upstream without a method allowlist, request bounds, origin validation, response bounds, or an upstream timeout.

### Root cause

The relay treated structurally valid JSON as trusted RPC input and delegated policy enforcement to the upstream node.

### Impact

An attacker could use the public application as an RPC proxy, consume upstream quota and worker resources, or access methods that the user interface never intended to expose.

### Secure remediation

The route now accepts only bounded JSON-RPC 2.0 single requests, allows an explicit read/simulation method set, enforces same-origin browser calls, validates an HTTPS credential-free upstream, limits request and response sizes, rate-limits requests, and times out upstream calls.

### Validation test

`npm test` verifies that `eth_sendRawTransaction`, debug methods, batches, and cross-origin requests are rejected before an upstream call.

## [SEC-003] Portfolio aggregation lacked resource and provider-target controls

- Severity: Medium
- Confidence: Confirmed
- CWE: CWE-400
- OWASP category: API4:2023 — Unrestricted Resource Consumption
- File: app/api/portfolio/route.ts; lib/rate-limit.ts
- Lines: app/api/portfolio/route.ts 107-160 and 626-692; lib/rate-limit.ts 1-57
- Status: Patched

### Evidence

The public endpoint could trigger several provider requests without a timeout, response-size cap, or application-level throttling. A custom provider template was accepted without explicit HTTPS, credential, private-address, or placeholder checks.

### Root cause

External indexer responses and administrator-supplied provider configuration were assumed to be well behaved.

### Impact

Repeated calls or a stalled/oversized upstream response could consume worker time, memory, and third-party API quota. Unsafe provider configuration could direct server-side requests to an unintended target.

### Secure remediation

The endpoint now applies per-edge-instance throttling, 10-second provider timeouts, two-megabyte response caps, strict JSON handling, safe cache headers, address validation, HTTPS/provider-template validation, private-host rejection, and bounded payload normalization.

### Validation test

`npm test` covers invalid addresses, and code-level tests plus the production build exercise the guarded handlers. A platform-level Cloudflare rate-limit rule is still recommended for globally consistent enforcement.

## [SEC-004] Browser responses lacked a global security-header policy

- Severity: Medium
- Confidence: Confirmed
- CWE: CWE-693
- OWASP category: A05:2021 — Security Misconfiguration
- File: worker/index.ts
- Lines: 22-50
- Status: Patched

### Evidence

The Worker previously returned application responses without CSP, anti-framing, MIME-sniffing, referrer, permissions, cross-origin resource, or HSTS controls.

### Root cause

Security headers were not centralized at the final response boundary.

### Impact

Browser defense in depth against clickjacking, content injection, MIME confusion, referrer leakage, and unwanted device capabilities was weaker than necessary.

### Secure remediation

Every Worker response now receives CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, a restrictive Permissions Policy, Referrer Policy, COOP/CORP, and HSTS on HTTPS.

### Validation test

The rendered integration test asserts the security headers and the full application build passes.

## [SEC-005] Ritual LLM accepted mutable model selection and untrusted portfolio text without explicit prompt boundaries

- Severity: Medium
- Confidence: Confirmed
- CWE: CWE-20
- OWASP category: LLM01:2025 — Prompt Injection
- File: contracts/contracts/PortfolioIntelligence.sol
- Lines: 39-42, 188-234, 388-410
- Status: Patched

### Evidence

The public analysis function previously accepted any model string and embedded external asset metadata into a model request without an explicit instruction to treat that content solely as untrusted data.

### Root cause

Executor configuration and fetched portfolio content crossed the AI trust boundary without an allowlisted model or a defensive system prompt.

### Impact

Malicious token or NFT metadata could influence the generated decision-support text, while arbitrary models could make output behavior and execution cost less predictable. The application does not autonomously trade, limiting the direct financial impact.

### Secure remediation

The contract pins the registered analysis model, rejects any other model, labels the fetched payload as untrusted data, instructs the model to ignore embedded commands and links, and JSON-escapes all control characters before composing the prompt.

### Validation test

The Hardhat security test verifies rejection of a non-allowlisted model, and `npm run ritual:check` confirms the pinned model is registered.

## [SEC-006] Ritual storage and scheduling inputs were insufficiently bounded

- Severity: Medium
- Confidence: Confirmed
- CWE: CWE-400
- OWASP category: A04:2021 — Insecure Design
- File: contracts/contracts/PortfolioIntelligence.sol
- Lines: 40-42, 195-229, 236-253, 325-344
- Status: Patched

### Evidence

External HTTP bodies, executor error strings, model output, endpoint suffixes, and schedule parameters could previously reach storage or protocol calls without explicit application-level maximums.

### Root cause

The contract relied primarily on downstream protocol behavior and transaction gas rather than enforcing its own data and schedule invariants.

### Impact

Oversized executor output or an excessive schedule configuration could cause avoidable reverts, high execution fees, storage growth, or degraded availability.

### Secure remediation

The contract caps portfolio, analysis, and error byte lengths; validates nonzero executors and wallets; restricts URL and suffix sizes; and bounds Scheduler TTL, call count, frequency, and their product.

### Validation test

Hardhat compilation and contract security tests pass, and the secured artifact was deployed on Ritual testnet.

## [SEC-007] One-step ownership transfer could irreversibly misdirect administration

- Severity: Medium
- Confidence: Confirmed
- CWE: CWE-284
- OWASP category: A01:2021 — Broken Access Control
- File: contracts/contracts/PortfolioIntelligence.sol
- Lines: 61-83, 123-137
- Status: Patched

### Evidence

The original ownership transfer assigned a proposed address immediately, with no acceptance step.

### Root cause

Administrative transfer did not verify that the destination address was correct and controllable.

### Impact

A typo or incompatible destination could permanently lose access to endpoint, scheduler, and fee-management functions.

### Secure remediation

Ownership transfer is now two-step: the current owner nominates `pendingOwner`, and only that address can accept.

### Validation test

The Hardhat security test confirms nomination does not change the owner and that acceptance by the nominee completes the transfer.

## 7. Low findings

## [SEC-008] On-chain LLM output was trusted through a TypeScript assertion

- Severity: Low
- Confidence: Confirmed
- CWE: CWE-20
- OWASP category: A08:2021 — Software and Data Integrity Failures
- File: lib/portfolio.ts; app/dashboard.tsx
- Lines: lib/portfolio.ts 47-84; app/dashboard.tsx 188-208
- Status: Patched

### Evidence

Parsed on-chain JSON was previously treated as `PortfolioAnalysis` without runtime shape, length, enum, array, or numeric-range validation.

### Root cause

A compile-time TypeScript type assertion was used at an untrusted runtime data boundary.

### Impact

Malformed or adversarial model output could break dashboard rendering or display structurally misleading content. React escaping prevented a confirmed script-injection path.

### Secure remediation

A strict parser now permits only the expected keys, bounds strings and array counts, validates enums, and constrains the score to an integer from 0 through 100.

### Validation test

`tests/security.test.ts` accepts a valid bounded result and rejects extra keys, oversized text, and invalid scores.

## [SEC-009] Request-derived host data could influence canonical metadata

- Severity: Low
- Confidence: Confirmed
- CWE: CWE-346
- OWASP category: A05:2021 — Security Misconfiguration
- File: app/layout.tsx
- Lines: 10-28
- Status: Patched

### Evidence

Canonical metadata previously depended on forwarded host information, which is not a reliable trust boundary across every proxy configuration.

### Root cause

Request routing metadata and canonical public-site identity were conflated.

### Impact

Under a misconfigured proxy, generated social or canonical URLs could point to an attacker-selected host.

### Secure remediation

Metadata now uses a configured HTTPS site URL with a fixed trusted fallback and rejects credential-bearing or malformed values.

### Validation test

`npm run build` successfully generates metadata using the bounded configuration.

## 8. False positives

- The owner-directed low-level value transfer in `withdrawScheduledFees` was reviewed for reentrancy. It is `onlyOwner`, pays only the configured owner after the RitualWallet withdrawal, and does not maintain mutable internal balance accounting after the call; no exploitable reentrancy path was confirmed.
- The configurable provider URL resembled SSRF, but it is environment-controlled rather than request-controlled. It was still hardened to HTTPS, credential-free, non-private targets as defense in depth.
- The unauthenticated portfolio lookup is not an IDOR: it exposes only public blockchain holdings for a caller-supplied address and does not access a private user record.
- Ritual HTTP and LLM addresses do not return ordinary deployed bytecode because they are native precompiles. The protocol health check separately confirms their canonical addresses and available executors.
- Searches found no `dangerouslySetInnerHTML`, `eval`, `tx.origin`, or `delegatecall` use in application-owned source.

## 9. Applied patches

- SEC-001: upgraded direct dependencies, pinned fixed transitive packages, refreshed the lockfile, and added CI dependency enforcement.
- SEC-002: added a same-origin, read-only, bounded JSON-RPC policy and regression tests.
- SEC-003: added portfolio throttling, upstream timeouts/size limits, provider URL validation, and bounded normalization.
- SEC-004: centralized browser security headers at the Worker response boundary.
- SEC-005: pinned the Ritual model and introduced prompt-injection boundaries plus complete JSON control-character escaping.
- SEC-006: bounded contract inputs, executor results, error storage, URLs, and schedule parameters.
- SEC-007: introduced two-step contract ownership transfer and tests.
- SEC-008: added strict runtime validation for model output.
- SEC-009: replaced request-derived canonical metadata with validated configuration.
- Expanded secret scanning to include mnemonic and npm-token formats and all reachable Git history.
- Pinned GitHub Actions to immutable commit SHAs and deployed the hardened contract at `0xa077b0dea3bb122ed7e71ecdf7ae0d7475343e0b`.

## 10. Tests executed

- Baseline: typecheck, lint, application tests, contract compilation, and build passed; dependency audit reported 41 advisories.
- Post-patch fresh installs: local `npm ci --legacy-peer-deps` and GitHub-compatible `npx npm@10.9.8 ci --legacy-peer-deps` passed with zero vulnerabilities.
- Post-patch dependency audit: full and production-only audits both report zero vulnerabilities.
- Post-patch secret scan: passed across tracked files and reachable Git history.
- Post-patch static gates: TypeScript and ESLint passed.
- Post-patch tests: 3 Vitest files / 8 tests and 3 rendered integration tests passed.
- Post-patch builds: Hardhat compilation and the vinext production build passed.
- Ritual health: chain ID 1979, canonical precompile addresses, system contracts, healthy executors, and the pinned model were confirmed.
- Deployment integrity: deployed creation bytecode plus constructor arguments exactly matches the local compiled artifact.

## 11. Remaining risks

No Critical or High issue remains open. The in-memory limiter is intentionally best-effort per Cloudflare isolate; a Cloudflare WAF/rate-limiting rule should be added for globally consistent enforcement. The CSP currently retains `'unsafe-inline'` for framework-generated script/style behavior, although no raw-HTML rendering sink was found. Results still depend on third-party portfolio indexers and Ritual executor availability, and the application remains decision support rather than financial advice. Ritual Explorer returned an internal verifier error after receiving the exact standard JSON/compiler/constructor data, so the new deployment is bytecode-matched but its source publication remains an explorer-side operational task.

## 12. Commands for manual verification

```powershell
npm ci --legacy-peer-deps
npm run security:check
npm audit --audit-level=low
npm audit --omit=dev --audit-level=high
npm run typecheck
npm run lint
npm test
npm run contracts:compile
npm run build
npm run ritual:check
git diff --check
```

Inspect the deployed contract at:

```text
https://explorer.ritualfoundation.org/address/0xa077b0dea3bb122ed7e71ecdf7ae0d7475343e0b
```
