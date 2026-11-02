export interface Env {
  FEEDS: KVNamespace;
  /** Service binding to the todomate-api Worker (preferred over the public URL). */
  TODOMATE_API?: Fetcher;
  /** Optional Workers rate-limit binding for login attempts. */
  LOGIN_LIMITER?: RateLimit;
  TOKEN_ENCRYPTION_KEY: string;
  TODOMATE_API_BASE_URL?: string;
  TIMEZONE?: string;
  FUTURE_DAYS?: string;
  CACHE_SECONDS?: string;
}

export type Config = {
  readonly apiBaseUrl: string;
  readonly timezone: string;
  readonly futureDays: number;
  /** Days fetched one by one if the range endpoint is unavailable. */
  readonly fallbackPastDays: number;
  readonly fallbackFutureDays: number;
  readonly cacheSeconds: number;
  readonly refreshMinutes: number;
};

/** Choices offered on the site for how much history to show. */
export const HISTORY_CHOICES = [7, 30, 90, 180, 365, 730] as const;
export const DEFAULT_HISTORY_DAYS = 365;

export function loadConfig(env: Env): Config {
  const cacheSeconds = clampInt(env.CACHE_SECONDS, 60, 3600, 180);
  return {
    apiBaseUrl: (env.TODOMATE_API_BASE_URL || "https://todomate-api.yestar.dev").replace(/\/+$/, ""),
    timezone: env.TIMEZONE || "Asia/Seoul",
    futureDays: clampInt(env.FUTURE_DAYS, 7, 365, 60),
    fallbackPastDays: 7,
    fallbackFutureDays: 30,
    cacheSeconds,
    refreshMinutes: Math.max(5, Math.round(cacheSeconds / 60)),
  };
}

export function historyDaysOf(options: { readonly historyDays?: number }): number {
  return parseHistoryDays(options.historyDays);
}

export function parseHistoryDays(value: unknown): number {
  return HISTORY_CHOICES.includes(value as (typeof HISTORY_CHOICES)[number])
    ? (value as number)
    : DEFAULT_HISTORY_DAYS;
}

export function clampInt(value: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
