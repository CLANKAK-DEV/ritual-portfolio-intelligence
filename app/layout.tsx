import type { Metadata } from "next";
import { Archivo_Black, Barlow, JetBrains_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const display = Archivo_Black({ weight: "400", subsets: ["latin"], variable: "--font-display" });
const body = Barlow({ weight: ["400", "500", "600", "700"], subsets: ["latin"], variable: "--font-body" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export async function generateMetadata(): Promise<Metadata> {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://ritual-lilac.vercel.app";
  let base = new URL("https://ritual-lilac.vercel.app");
  try {
    const candidate = new URL(configuredUrl);
    if (candidate.protocol === "https:" && !candidate.username && !candidate.password) base = candidate;
  } catch {
    // A malformed environment value must not make untrusted request headers canonical.
  }
  return {
    metadataBase: base,
    title: { default: "Ritual Portfolio Intelligence", template: "%s · Ritual Portfolio Intelligence" },
    description: "Verifiable, recurring portfolio analysis powered by Ritual's native HTTP, LLM, and Scheduler primitives.",
    openGraph: {
      title: "Ritual Portfolio Intelligence",
      description: "Your portfolio, interpreted on-chain.",
      type: "website",
      images: [{ url: new URL("/og.png", base).toString(), width: 1792, height: 1024, alt: "Ritual Portfolio Intelligence" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Ritual Portfolio Intelligence",
      description: "Your portfolio, interpreted on-chain.",
      images: [new URL("/og.png", base).toString()],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} ${mono.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
