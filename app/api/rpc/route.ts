import { NextResponse } from "next/server";

export const runtime = "edge";

const RPC_URL = process.env.RITUAL_RPC_URL ?? "https://rpc.ritualfoundation.org";

export async function POST(request: Request) {
  const body = await request.text();
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

