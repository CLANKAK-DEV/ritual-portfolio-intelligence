import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const envPath = new URL("../.env.ritual", import.meta.url);
let privateKey;

if (existsSync(envPath)) {
  const contents = readFileSync(envPath, "utf8");
  privateKey = contents.match(/^PRIVATE_KEY=(0x[0-9a-fA-F]{64})$/m)?.[1];
}

if (!privateKey) {
  privateKey = generatePrivateKey();
  writeFileSync(
    envPath,
    [
      "# Dedicated Ritual testnet deployer. Never commit or paste this key.",
      `PRIVATE_KEY=${privateKey}`,
      "RITUAL_RPC_URL=https://rpc.ritualfoundation.org",
      "PORTFOLIO_API_BASE_URL=",
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o600 },
  );
}

const account = privateKeyToAccount(privateKey);
console.log(JSON.stringify({ address: account.address, environment: ".env.ritual" }));
