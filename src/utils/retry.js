const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ENETUNREACH", "ECONNABORTED"]);

function isRetryable(err) {
  if (RETRYABLE_CODES.has(err.code)) return true;
  const status = err?.response?.status;
  return Boolean(status && RETRYABLE_STATUSES.has(status));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry(fn, { maxRetries = 3, baseDelayMs = 1000, label = "request" } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt > maxRetries || !isRetryable(err)) throw err;

      const retryAfterSec = parseInt(err?.response?.headers?.["retry-after"] ?? "0", 10);
      const delay = retryAfterSec > 0
        ? retryAfterSec * 1000
        : Math.min(baseDelayMs * 2 ** (attempt - 1) + Math.random() * 500, 30000);

      console.warn(
        `[retry] ${label} failed (attempt ${attempt}/${maxRetries}, status=${err?.response?.status ?? err.code}), retrying in ${Math.round(delay)}ms`
      );
      await sleep(delay);
    }
  }
}

module.exports = { withRetry };
