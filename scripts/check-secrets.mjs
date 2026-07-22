import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const allowedEnvironmentFiles = new Set([".env.example"]);
const forbiddenEnvironmentFiles = tracked.filter((file) => {
  const name = path.basename(file);
  return name.startsWith(".env") && !allowedEnvironmentFiles.has(name);
});

const rules = [
  ["private-key assignment", /\bPRIVATE_KEY[ \t]*=[ \t]*(?:0x)?[0-9a-fA-F]{64}\b/],
  ["mnemonic assignment", /\b(?:MNEMONIC|SEED_PHRASE)[ \t]*=[ \t]*[^\r\n]{20,}/i],
  ["provider-key assignment", /\b(?:ZERION_API_KEY|DEBANK_ACCESS_KEY|PORTFOLIO_API_KEY)[ \t]*=[ \t]*\S+/],
  ["hard-coded Zerion key", /\bzk_[A-Za-z0-9]{20,}\b/],
  ["GitHub credential", /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ["npm credential", /\bnpm_[A-Za-z0-9]{20,}\b/],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["PEM private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];

const findings = [];
for (const file of tracked) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (content.includes("\0")) continue;
  for (const [name, pattern] of rules) {
    if (pattern.test(content)) findings.push({ file, rule: name });
  }
}

for (const file of forbiddenEnvironmentFiles) findings.push({ file, rule: "tracked environment file" });

try {
  const history = execFileSync(
    "git",
    ["log", "-p", "--all", "--no-color", "--no-ext-diff"],
    { encoding: "utf8", maxBuffer: 64 * 1_024 * 1_024 },
  );
  for (const [name, pattern] of rules) {
    if (pattern.test(history)) findings.push({ file: "reachable Git history", rule: name });
  }
} catch {
  // A new repository may not have a commit yet; current-tree checks still run.
}

if (findings.length > 0) {
  console.error("Potential secrets detected. Values are intentionally hidden:");
  for (const finding of findings) console.error(`- ${finding.file}: ${finding.rule}`);
  process.exit(1);
}

console.log(`Secret check passed for ${tracked.length} tracked files.`);
