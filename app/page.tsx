import { Dashboard } from "./dashboard";
import { analyzeSnapshot, makeDemoSnapshot } from "@/lib/portfolio";

const demoAddress = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";

export default function Home() {
  const snapshot = makeDemoSnapshot(demoAddress);
  return <Dashboard initialSnapshot={snapshot} initialAnalysis={analyzeSnapshot(snapshot)} />;
}
