export const MAX_RPC_REQUEST_BYTES = 16 * 1_024;
export const MAX_RPC_RESPONSE_BYTES = 2 * 1_024 * 1_024;

const allowedMethods = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getBlockTransactionCountByHash",
  "eth_getBlockTransactionCountByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "net_version",
  "web3_clientVersion",
]);

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown[] | Record<string, unknown>;
};

export type RpcValidationResult =
  | { ok: true; request: JsonRpcRequest }
  | { ok: false; status: number; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateRpcRequest(value: unknown): RpcValidationResult {
  if (Array.isArray(value)) {
    return { ok: false, status: 400, error: "JSON-RPC batch requests are not supported." };
  }
  if (!isRecord(value) || value.jsonrpc !== "2.0") {
    return { ok: false, status: 400, error: "A JSON-RPC 2.0 request is required." };
  }
  if (typeof value.method !== "string" || !allowedMethods.has(value.method)) {
    return { ok: false, status: 403, error: "This JSON-RPC method is not allowed." };
  }
  if (
    (typeof value.id !== "string" && typeof value.id !== "number") ||
    (typeof value.id === "string" && value.id.length > 128) ||
    (typeof value.id === "number" && !Number.isSafeInteger(value.id))
  ) {
    return { ok: false, status: 400, error: "A bounded string or integer request id is required." };
  }
  if (value.params !== undefined && !Array.isArray(value.params) && !isRecord(value.params)) {
    return { ok: false, status: 400, error: "JSON-RPC params must be an array or object." };
  }

  return {
    ok: true,
    request: {
      jsonrpc: "2.0",
      id: value.id,
      method: value.method,
      ...(value.params === undefined ? {} : { params: value.params }),
    },
  };
}

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export function getSafeRpcUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("RITUAL_RPC_URL must be an HTTPS URL without embedded credentials.");
  }
  return url.toString();
}
