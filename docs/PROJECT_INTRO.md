# Ritual Portfolio Intelligence — project introduction

Hey Jez, I just finished building a new project called Ritual Portfolio Intelligence.

It is a wallet intelligence platform where users enter or connect an EVM wallet, load real multichain holdings, and receive clear portfolio analysis covering risk, concentration, stablecoins, DeFi, NFTs, memecoins, and suggested actions. Zerion and DeBank provide indexed wallet data, with public Blockscout fallbacks when a paid provider is unavailable.

What makes it a Ritual-native project is the verified execution flow. The smart contract asks Ritual's HTTP precompile to fetch portfolio data, sends that data to Ritual's LLM precompile for bounded risk reasoning, stores the resulting hashes and analysis on-chain, and can use Ritual Scheduler for recurring updates. Users stay in control of their wallet and execution budget; the application never holds their private key and does not execute trades.

GitHub: https://github.com/CLANKAK-DEV/ritual-portfolio-intelligence

Live: https://ritual-lilac.vercel.app/

Ritual contract: https://explorer.ritualfoundation.org/address/0xa077b0dea3bb122ed7e71ecdf7ae0d7475343e0b
