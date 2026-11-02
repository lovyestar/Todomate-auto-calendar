// GET /feed/<id>.ics — the subscribed calendar.
//
// Todos are read with todomate-api's GET /todos/range in chunks of up to two months
// (each chunk is a separate, small invocation of the API Worker). If the range
// endpoint fails, the recent days are fetched one by one so the calendar still works.

import { type Config, type Env, historyDaysOf, loadConfig } from "./config.ts";
import { decrypt } from "./crypto.ts";
import { etagOf, mapWithConcurrency, text } from "./http.ts";
import { addDays, buildCalendar, dateRange, type Notice, splitRange, type Todo, todayIn } from "./ics.ts";
import { type FeedRecord, FeedStore } from "./store.ts";
import { TodomateApi, TodomateApiError } from "./todomate.ts";

const EXPIRY_WARNING_MS = 3 * 86_400_000;
const STALE_SECONDS = 7 * 86_400;
const CHUNK_DAYS = 62;
const FETCH_CONCURRENCY = 6;

export async function handleFeed(request: Request, id: string, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const config = loadConfig(env);
  const now = Date.now();
  const cache = caches.default;
  const key = feedCacheKey(url.origin, id);

  // One cache entry per feed: fresh for cacheSeconds, kept a week as a fallback.
  let stale: string | null = null;
  const cached = await cache.match(key);
  if (cached) {
    const body = await cached.text();
    const age = now - Number(cached.headers.get("x-generated-at") ?? 0);
    if (age < config.cacheSeconds * 1000) return calendarResponse(request, body);
    stale = body;
  }

  const record = await new FeedStore(env.FEEDS).get(id);
  if (!record) return text("이 캘린더 주소는 연결이 해제되었어요.", 404);

  const api = new TodomateApi(config.apiBaseUrl, env.TODOMATE_API);
  const result = await generate(record, config, api, env.TOKEN_ENCRYPTION_KEY, url, now);

  if (result.kind === "partial" && stale !== null) return calendarResponse(request, stale);
  if (result.kind === "ok") {
    ctx.waitUntil(
      cache.put(
        key,
        new Response(result.body, {
          headers: { "cache-control": `public, max-age=${STALE_SECONDS}`, "x-generated-at": String(now) },
        }),
      ),
    );
  }
  return calendarResponse(request, result.body);
}

type Generated = { kind: "ok" | "partial" | "notice"; body: string };

async function generate(
  record: FeedRecord,
  config: Config,
  api: TodomateApi,
  secret: string,
  url: URL,
  now: number,
): Promise<Generated> {
  const today = todayIn(config.timezone, now);
  const base = {
    now,
    host: url.host,
    timezone: config.timezone,
    refreshMinutes: config.refreshMinutes,
    options: record.options,
  };
  const reconnect = (summary: string): Notice => ({
    uid: `notice-reconnect-${today}`,
    date: today,
    summary,
    description: `${url.origin} 에서 투두메이트 계정으로 다시 연결하면 같은 캘린더 주소로 계속 동기화돼요.`,
  });
  const noticeOnly = (summary: string): Generated => ({
    kind: "notice",
    body: buildCalendar({ ...base, todos: [], goals: [], notices: [reconnect(summary)] }),
  });

  if (record.expiresAt <= now) return noticeOnly("⚠️ 투두메이트 캘린더 재연결 필요");

  const token = await decrypt(secret, record.tokenEnc);
  let failed = false;
  let unauthorized = false;
  const onError = (what: string) => (error: unknown) => {
    failed = true;
    if (error instanceof TodomateApiError && error.status === 401) unauthorized = true;
    else console.error(`todomate ${what} failed`, error instanceof Error ? error.message : error);
    return null;
  };

  const from = addDays(today, -historyDaysOf(record.options));
  const to = addDays(today, config.futureDays);
  const goalsPromise = api.goals(token).catch(onError("goals"));
  const chunks = await mapWithConcurrency(splitRange(from, to, CHUNK_DAYS), FETCH_CONCURRENCY, ([a, b]) =>
    api.todosInRange(token, a, b).catch(onError(`range ${a}-${b}`)),
  );
  const goals = (await goalsPromise) ?? [];
  if (unauthorized) return noticeOnly("⚠️ 투두메이트 캘린더 재연결 필요");

  let todos: Todo[] = chunks.flatMap((chunk) => chunk ?? []);
  if (chunks.some((chunk) => chunk === null)) {
    // Range lookup failed: make sure at least the recent days are present.
    const days = dateRange(today, config.fallbackPastDays, config.fallbackFutureDays);
    const perDay = await mapWithConcurrency(days, FETCH_CONCURRENCY, (day) =>
      api.todos(token, day).catch(onError(`day ${day}`)),
    );
    if (unauthorized) return noticeOnly("⚠️ 투두메이트 캘린더 재연결 필요");
    todos = [...perDay.flatMap((list) => list ?? []), ...todos];
  }

  const notices: Notice[] = [];
  if (record.expiresAt - now < EXPIRY_WARNING_MS) notices.push(reconnect("⏰ 투두메이트 캘린더 연결이 곧 만료돼요"));
  const body = buildCalendar({ ...base, todos, goals, notices });
  return { kind: failed ? "partial" : "ok", body };
}

async function calendarResponse(request: Request, body: string): Promise<Response> {
  const etag = await etagOf(body);
  const headers = {
    "content-type": "text/calendar; charset=utf-8",
    "content-disposition": 'inline; filename="todomate.ics"',
    "cache-control": "no-cache",
    etag,
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : body, { headers });
}

export function feedCacheKey(origin: string, id: string): Request {
  return new Request(`${origin}/__cache/feed/${id}`);
}

export async function purgeFeedCache(origin: string, id: string): Promise<void> {
  await caches.default.delete(feedCacheKey(origin, id));
}
