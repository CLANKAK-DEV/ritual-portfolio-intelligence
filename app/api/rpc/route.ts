import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  getSafeRpcUrl,
  isSameOriginRequest,
  MAX_RPC_REQUEST_BYTES,
  MAX_RPC_RESPONSE_BYTES,
  validateRpcRequest,
} from "@/lib/rpc-security";

export const runtime = "edge";

const RPC_TIMEOUT_MS = 12_000;
const rpcHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

function jsonError(error: string, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json({ error }, { status, headers: { ...rpcHeaders, ...headers } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return jsonError("Cross-origin RPC requests are not allowed.", 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return jsonError("Content-Type must be application/json.", 415);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_RPC_REQUEST_BYTES) {
    return jsonError("JSON-RPC request is too large.", 413);
  }

  const rateLimit = checkRateLimit(request, "rpc", 120, 60_000);
  if (!rateLimit.allowed) return jsonError("Too many RPC requests.", 429, rateLimit.headers);

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_RPC_REQUEST_BYTES) {
    return jsonError("JSON-RPC request is too large.", 413, rateLimit.headers);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return jsonError("Malformed JSON request.", 400, rateLimit.headers);
  }

  const validation = validateRpcRequest(parsed);
  if (!validation.ok) return jsonError(validation.error, validation.status, rateLimit.headers);

  let rpcUrl: string;
  try {
    rpcUrl = getSafeRpcUrl(process.env.RITUAL_RPC_URL ?? "https://rpc.ritualfoundation.org");
  } catch {
    return jsonError("The Ritual RPC endpoint is not configured safely.", 503, rateLimit.headers);
  }

  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validation.request),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    const upstreamLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(upstreamLength) && upstreamLength > MAX_RPC_RESPONSE_BYTES) {
      return jsonError("Ritual RPC response exceeded the safety limit.", 502, rateLimit.headers);
    }
    const responseBody = await response.text();
    if (new TextEncoder().encode(responseBody).byteLength > MAX_RPC_RESPONSE_BYTES) {
      return jsonError("Ritual RPC response exceeded the safety limit.", 502, rateLimit.headers);
    }
    JSON.parse(responseBody);
    return new NextResponse(responseBody, {
      status: response.ok ? 200 : 502,
      headers: { ...rpcHeaders, ...rateLimit.headers },
    });
  } catch {
    return jsonError("Ritual RPC is temporarily unavailable.", 502, rateLimit.headers);
  }
}
