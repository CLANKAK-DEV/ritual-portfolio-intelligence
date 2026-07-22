type RateLimitEntry = {
  count: number;
  resetAt: number;
};

type RateLimitResult = {
  allowed: boolean;
  headers: Record<string, string>;
};

const buckets = new Map<string, RateLimitEntry>();
const MAX_BUCKETS = 5_000;

function clientAddress(request: Request) {
  // Cloudflare sets this header at the edge. Deliberately do not trust
  // X-Forwarded-For, which a direct client can spoof.
  return request.headers.get("cf-connecting-ip")?.trim() || null;
}

function pruneExpiredBuckets(now: number) {
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}

export function checkRateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const address = clientAddress(request);
  if (!address) return { allowed: true, headers: {} };

  const now = Date.now();
  if (buckets.size >= MAX_BUCKETS) pruneExpiredBuckets(now);
  if (buckets.size >= MAX_BUCKETS) buckets.clear();

  const key = `${scope}:${address}`;
  const current = buckets.get(key);
  const entry = !current || current.resetAt <= now
    ? { count: 1, resetAt: now + windowMs }
    : { count: current.count + 1, resetAt: current.resetAt };
  buckets.set(key, entry);

  const remaining = Math.max(0, limit - entry.count);
  const resetSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1_000));
  return {
    allowed: entry.count <= limit,
    headers: {
      "RateLimit-Limit": String(limit),
      "RateLimit-Remaining": String(remaining),
      "RateLimit-Reset": String(resetSeconds),
      ...(entry.count > limit ? { "Retry-After": String(resetSeconds) } : {}),
    },
  };
}
