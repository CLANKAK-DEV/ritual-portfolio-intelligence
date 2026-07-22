import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";

export const ritualChain = defineChain({
  id: 1979,
  name: "Ritual",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.ritualfoundation.org"] } },
  blockExplorers: { default: { name: "Ritual Explorer", url: "https://explorer.ritualfoundation.org" } },
  contracts: { multicall3: { address: "0x5577Ea679673Ec7508E9524100a188E7600202a3" } },
});

export const wagmiConfig = createConfig({
  chains: [ritualChain],
  connectors: [injected()],
  transports: { [ritualChain.id]: http("/api/rpc") },
  ssr: true,
});

export const RITUAL_ADDRESSES = {
  wallet: "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948",
  jobTracker: "0xC069FFCa0389f44eCA2C626e55491b0ab045AEF5",
  registry: "0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F",
  scheduler: "0x56e776BAE2DD60664b69Bd5F865F1180ffB7D58B",
  http: "0x0000000000000000000000000000000000000801",
  llm: "0x0000000000000000000000000000000000000802",
} as const;

