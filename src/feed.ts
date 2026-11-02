// GET /feed/<id>.ics          all todos
// GET /feed/<id>/<goal>.ics   todos of one goal (a separate calendar per category)
//
// Todos are read with todomate-api's GET /todos/range in chunks of up to two months.
// The fetched data (not the .ics) is cached per feed, so every per-goal calendar of
// the same account shares one upstream fetch. If the range endpoint fails, recent days
// are fetched one by one so the calendar still works.

import { type Config, type Env, historyDaysOf, loadConfig } from "./config.ts";
import { decrypt } from "./crypto.ts";
import { etagOf, mapWithConcurrency, text } from "./http.ts";
import { addDays, buildCalendar, dateRange, type Goal, type Notice, splitRange, type Todo, todayIn } from "./ics.ts";
import { type FeedRecord, FeedStore } from "./store.ts";
import { TodomateApi, TodomateApiError } from "./todomate.ts";

const EXPIRY_WARNING_MS = 3 * 86_400_000;
const STALE_SECONDS = 7 * 86_400;
const CHUNK_DAYS = 62;
const FETCH_CONCURRENCY = 6;

type FeedData = { readonly todos: Todo[]; readonly goals: Goal[] };

export async function handleFeed(
  request: Request,
  id: string,
  goalId: string | undefined,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const config = loadConfig(env);
  const now = Date.now();

  // Look up the record first so a disconnected or rotated URL stops working right away.
  const record = await new FeedStore(env.FEEDS).get(id);
  if (!record) return text("이 캘린더 주소는 연결이 해제되었어요.", 404);

  const today = todayIn(config.timezone, now);
  const notice = (summary: string): Notice => ({
    uid: `notice-reconnect-${today}`,
    date: today,
    summary,
    description: `${url.origin} 에서 투두메이트 계정으로 다시 연결하면 같은 캘린더 주소로 계속 이어져요.`,
  });
  const render = (data: FeedData, notices: Notice[]) => {
    const goal = goalId === undefined ? undefined : data.goals.find((g) => g.id === goalId);
    return buildCalendar({
      todos: data.todos,
      goals: data.goals,
      goalId,
      notices,
      now,
      host: url.host,
      timezone: config.timezone,
      refreshMinutes: config.refreshMinutes,
      options: record.options,
      calendarName: typeof goal?.title === "string" ? `투두메이트 · ${goal.title}` : "투두메이트",
    });
  };
  const empty: FeedData = { todos: [], goals: [] };

  if (record.expiresAt <= now) return calendarResponse(request, render(empty, [notice("투두메이트 캘린더 재연결 필요")]));

  const notices = record.expiresAt - now < EXPIRY_WARNING_MS ? [notice("투두메이트 캘린더 연결이 곧 만료돼요")] : [];
  const cache = caches.default;
  const key = dataCacheKey(url.origin, id);

  let stale: FeedData | null = null;
  const cached = await cache.match(key);
  if (cached) {
    const data = (await cached.json()) as FeedData;
    const age = now - Number(cached.headers.get("x-generated-at") ?? 0);
    if (age < config.cacheSeconds * 1000) return calendarResponse(request, render(data, notices));
    stale = data;
  }

  const api = new TodomateApi(config.apiBaseUrl, env.TODOMATE_API);
  const result = await fetchData(record, config, api, env.TOKEN_ENCRYPTION_KEY, today);
  if (result.unauthorized) return calendarResponse(request, render(empty, [notice("투두메이트 캘린더 재연결 필요")]));

  if (result.failed) return calendarResponse(request, render(stale ?? result.data, notices));
  ctx.waitUntil(
    cache.put(
      key,
      new Response(JSON.stringify(result.data), {
        headers: {
          "content-type": "application/json",
          "cache-control": `public, max-age=${STALE_SECONDS}`,
          "x-generated-at": String(now),
        },
      }),
    ),
  );
  return calendarResponse(request, render(result.data, notices));
}

async function fetchData(
  record: FeedRecord,
  config: Config,
  api: TodomateApi,
  secret: string,
  today: string,
): Promise<{ data: FeedData; failed: boolean; unauthorized: boolean }> {
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

  let todos: Todo[] = chunks.flatMap((chunk) => chunk ?? []);
  if (!unauthorized && chunks.some((chunk) => chunk === null)) {
    // Range lookup failed: make sure at least the recent days are present.
    const days = dateRange(today, config.fallbackPastDays, config.fallbackFutureDays);
    const perDay = await mapWithConcurrency(days, FETCH_CONCURRENCY, (day) =>
      api.todos(token, day).catch(onError(`day ${day}`)),
    );
    todos = [...perDay.flatMap((list) => list ?? []), ...todos];
  }

  return {
    data: { todos: todos.map(slimTodo), goals: goals.map(({ id, title }) => ({ id, title })) },
    failed,
    unauthorized,
  };
}

/** Keep only the fields the calendar uses, so the cached data stays small. */
function slimTodo(todo: Todo): Todo {
  const { id, content, date, isDone, doneTime, createTime, goalID, remindAt, memo } = todo;
  return { id, content, date, isDone, doneTime, createTime, goalID, remindAt, memo };
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

function dataCacheKey(origin: string, id: string): Request {
  return new Request(`${origin}/__cache/data/${id}`);
}

export async function purgeFeedCache(origin: string, id: string): Promise<void> {
  await caches.default.delete(dataCacheKey(origin, id));
}
