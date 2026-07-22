import { network } from "hardhat";

const API_BASE_URL = process.env.PORTFOLIO_API_BASE_URL;

if (!API_BASE_URL) {
  throw new Error("PORTFOLIO_API_BASE_URL is required (must end with /api/portfolio?address=)");
}

const { viem } = await network.connect({ network: "ritual" });
const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();

const balance = await publicClient.getBalance({ address: deployer.account.address });
console.log(`Deploying from ${deployer.account.address}`);
console.log(`Native balance: ${balance} wei`);

const contract = await viem.deployContract("PortfolioIntelligence", [API_BASE_URL]);
console.log(`PortfolioIntelligence deployed to ${contract.address}`);
console.log(`Explorer: https://explorer.ritualfoundation.org/address/${contract.address}`);
