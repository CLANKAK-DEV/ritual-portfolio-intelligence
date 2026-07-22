import hardhatViem from "@nomicfoundation/hardhat-viem";
import { configVariable, defineConfig } from "hardhat/config";
import "dotenv/config";

export default defineConfig({
  plugins: [hardhatViem],
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  paths: {
    sources: "./contracts/contracts",
    cache: "./contracts/cache",
    artifacts: "./contracts/artifacts",
  },
  networks: {
    ritual: {
      type: "http",
      chainType: "l1",
      url: configVariable("RITUAL_RPC_URL"),
      accounts: [configVariable("PRIVATE_KEY")],
    },
  },
});
