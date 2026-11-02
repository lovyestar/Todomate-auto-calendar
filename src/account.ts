// POST /api/connect, POST /api/disconnect, GET /api/goals/<feedId>

import { type Env, loadConfig, parseHistoryDays } from "./config.ts";
import { decrypt, encrypt, randomId } from "./crypto.ts";
import { purgeFeedCache } from "./feed.ts";
import { apiError, clientIp, json } from "./http.ts";
import type { Goal } from "./ics.ts";
import { type FeedRecord, FeedStore } from "./store.ts";
import { type LoginResult, TodomateApi, TodomateApiError } from "./todomate.ts";

type Body = Record<string, unknown>;

function apiFor(env: Env): TodomateApi {
  return new TodomateApi(loadConfig(env).apiBaseUrl, env.TODOMATE_API);
}

export async function handleConnect(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const input = await readCredentials(request, env);
  if (input instanceof Response) return input;
  const session = await login(env, input.email, input.password, clientIp(request));
  if (session instanceof Response) return session;

  const store = new FeedStore(env.FEEDS);
  const existingId = await store.feedIdForUid(session.uid);
  const existing = existingId ? await store.get(existingId) : null;
  const rotate = input.body.rotate === true;
  const keep = existing !== null && !rotate;

  const now = Date.now();
  const record: FeedRecord = {
    id: keep ? existing.id : randomId(),
    uid: session.uid,
    tokenEnc: await encrypt(env.TOKEN_ENCRYPTION_KEY, session.token),
    expiresAt: session.expiresAt,
    createdAt: keep ? existing.createdAt : now,
    updatedAt: now,
    options: {
      hideDone: input.body.hideDone === true,
      showGoal: input.body.showGoal !== false,
      historyDays: parseHistoryDays(input.body.historyDays),
    },
  };

  if (existing && rotate) await store.deleteFeedOnly(existing.id);
  await store.put(record);
  await purgeFeedCache(url.origin, record.id);
  if (existing) {
    if (rotate) await purgeFeedCache(url.origin, existing.id);
    ctx.waitUntil(discardToken(env, existing.tokenEnc));
  }

  const goals = await apiFor(env)
    .goals(session.token)
    .catch(() => [] as Goal[]);
  return json({
    ...links(url.origin, record.id),
    goals: goalLinks(url.origin, record.id, goals),
    expiresAt: record.expiresAt,
    options: record.options,
    reused: keep,
  });
}

/** Per-goal calendar links for the site. The feed id itself is the credential. */
export async function handleGoals(request: Request, id: string, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const record = await new FeedStore(env.FEEDS).get(id);
  if (!record) return apiError("연결 정보를 찾을 수 없어요. 다시 연결해 주세요.", 404);
  try {
    const goals = await apiFor(env).goals(await decrypt(env.TOKEN_ENCRYPTION_KEY, record.tokenEnc));
    return json({ goals: goalLinks(url.origin, id, goals), expiresAt: record.expiresAt });
  } catch (error) {
    if (error instanceof TodomateApiError && error.status === 401) {
      return apiError("연결이 만료됐어요. 다시 연결해 주세요.", 401);
    }
    console.error("goals failed", error instanceof Error ? error.message : error);
    return apiError("목표 목록을 불러오지 못했어요.", 502);
  }
}

function links(origin: string, id: string, goalId?: string) {
  const path = goalId === undefined ? `${id}.ics` : `${id}/${encodeURIComponent(goalId)}.ics`;
  const feedUrl = `${origin}/feed/${path}`;
  const webcalUrl = feedUrl.replace(/^https?:/, "webcal:");
  return {
    feedUrl,
    webcalUrl,
    googleUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`,
  };
}

function goalLinks(origin: string, id: string, goals: readonly Goal[]) {
  return goals
    .filter((g): g is { id: string; title: string } => typeof g.id === "string" && typeof g.title === "string")
    .map((g) => ({ id: g.id, title: g.title, ...links(origin, id, g.id) }));
}

export async function handleDisconnect(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const input = await readCredentials(request, env);
  if (input instanceof Response) return input;
  const session = await login(env, input.email, input.password, clientIp(request));
  if (session instanceof Response) return session;

  const store = new FeedStore(env.FEEDS);
  const id = await store.feedIdForUid(session.uid);
  const existing = id ? await store.get(id) : null;
  if (id) {
    await store.delete({ id, uid: session.uid });
    await purgeFeedCache(url.origin, id);
  }
  // Neither the stored token nor the one just issued to verify the user is kept.
  if (existing) ctx.waitUntil(discardToken(env, existing.tokenEnc));
  ctx.waitUntil(apiFor(env).logout(session.token).catch(() => {}));
  return json({ ok: true, removed: id !== null });
}

async function readCredentials(
  request: Request,
  env: Env,
): Promise<{ body: Body; email: string; password: string } | Response> {
  if (env.LOGIN_LIMITER) {
    const { success } = await env.LOGIN_LIMITER.limit({ key: clientIp(request) });
    if (!success) return apiError("시도가 너무 많아요. 1분 뒤에 다시 시도해 주세요.", 429, { "retry-after": "60" });
  }
  let body: Body;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    body = parsed as Body;
  } catch {
    return apiError("잘못된 요청이에요.", 400);
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (email === "" || password === "") return apiError("이메일과 비밀번호를 입력해 주세요.", 400);
  if (email.length > 254 || password.length > 256 || !/^[^\s@]+@[^\s@]+$/.test(email)) {
    return apiError("이메일 형식을 확인해 주세요.", 400);
  }
  return { body, email, password };
}

async function login(env: Env, email: string, password: string, ip: string): Promise<LoginResult | Response> {
  try {
    return await apiFor(env).login(email, password, ip);
  } catch (error) {
    if (error instanceof TodomateApiError) {
      if (error.status === 429) return apiError("로그인 시도가 너무 많아요. 1분 뒤에 다시 시도해 주세요.", 429);
      if (error.status >= 400 && error.status < 500) {
        return apiError("투두메이트 이메일 또는 비밀번호가 올바르지 않아요.", 401);
      }
    }
    console.error("login failed", error instanceof Error ? error.message : error);
    return apiError("투두메이트 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.", 502);
  }
}

async function discardToken(env: Env, tokenEnc: string): Promise<void> {
  try {
    await apiFor(env).logout(await decrypt(env.TOKEN_ENCRYPTION_KEY, tokenEnc));
  } catch {
    // logout is stateless upstream; dropping the token is what matters
  }
}
