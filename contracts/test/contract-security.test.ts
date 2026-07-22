import { describe, expect, it } from "vitest";

process.env.HARDHAT_CONFIG = "contracts/hardhat.config.ts";
const { network } = await import("hardhat");

describe.sequential("PortfolioIntelligence security controls", () => {
  it("uses two-step ownership so a typo cannot immediately seize administration", async () => {
    const { viem } = await network.connect();
    const [owner, nominee] = await viem.getWalletClients();
    const contract = await viem.deployContract("PortfolioIntelligence", ["https://portfolio.example/wallet/", ""]);

    await contract.write.transferOwnership([nominee.account.address]);
    expect(String(await contract.read.owner()).toLowerCase()).toBe(owner.account.address.toLowerCase());
    expect(String(await contract.read.pendingOwner()).toLowerCase()).toBe(nominee.account.address.toLowerCase());

    await nominee.writeContract({
      address: contract.address,
      abi: [{ type: "function", name: "acceptOwnership", stateMutability: "nonpayable", inputs: [], outputs: [] }],
      functionName: "acceptOwnership",
    });
    expect(String(await contract.read.owner()).toLowerCase()).toBe(nominee.account.address.toLowerCase());
  }, 20_000);

  it("rejects non-HTTPS endpoints and non-allowlisted LLM models", async () => {
    const { viem } = await network.connect();
    await expect(viem.deployContract("PortfolioIntelligence", ["http://unsafe.example/wallet/", ""])).rejects.toThrow();

    const [owner] = await viem.getWalletClients();
    const contract = await viem.deployContract("PortfolioIntelligence", ["https://portfolio.example/wallet/", ""]);
    await expect(contract.write.analyzePortfolio([
      owner.account.address,
      owner.account.address,
      "untrusted/model",
    ])).rejects.toThrow();
  }, 20_000);
});
