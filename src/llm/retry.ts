/**
 * Resilient retry utility for LLM API calls with exponential backoff and jitter.
 * Handles transient network timeouts, 429 rate limits, and 500/503 server errors.
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  jitterFactor?: number;
}

const RETRYABLE_ERROR_PATTERNS = [
  /429|500|502|503|504|524/i,
  /rate limit|rate_limit|too many requests|resource_exhausted|quota/i,
  /overloaded|service unavailable|internal error|server error|socket hang up/i,
  /fetch failed|network error|connection reset|econnreset|etimedout|eai_again/i,
  /timeout|timed out/i,
];

export function isRetryableError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  return RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(msg));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 5;
  const initialDelay = options.initialDelayMs ?? 2000;
  const maxDelay = options.maxDelayMs ?? 30000;
  const factor = options.backoffFactor ?? 2;
  const jitter = options.jitterFactor ?? 0.25;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      if (attempt === maxRetries || !isRetryableError(err)) {
        throw err;
      }

      const isQuotaError = /quota|resource_exhausted|429/i.test(
        err instanceof Error ? err.message : String(err)
      );

      // If it's a quota / rate limit error, use a more patient backoff
      const baseDelay = isQuotaError ? Math.max(initialDelay, 3000) : initialDelay;
      const expDelay = baseDelay * Math.pow(factor, attempt);
      const jitterDelta = expDelay * jitter * (Math.random() * 2 - 1);
      const delayMs = Math.min(maxDelay, Math.max(500, Math.round(expDelay + jitterDelta)));

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
