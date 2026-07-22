import { Dashboard } from "./dashboard";
import { analyzeSnapshot, makeDemoSnapshot } from "@/lib/portfolio";

const demoAddress = "0x973CBC3468B95e11EDaAf9F3B08B9B557A459738";

export default function Home() {
  const snapshot = makeDemoSnapshot(demoAddress);
  return <Dashboard initialSnapshot={snapshot} initialAnalysis={analyzeSnapshot(snapshot)} />;
}
