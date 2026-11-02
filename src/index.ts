import { handleConnect, handleDisconnect } from "./account.ts";
import type { Env } from "./config.ts";
import { handleFeed } from "./feed.ts";
import { apiError, isSameOriginJson, json, PAGE_CSP, text, withSecurityHeaders } from "./http.ts";
import page from "./site/index.html";
import { FAVICON_SVG, MANIFEST, ROBOTS_TXT } from "./site/static.ts";

export type { Env } from "./config.ts";

const FEED_PATH = /^\/feed\/([A-Za-z0-9_-]{16,64})(?:\.ics)?$/;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    // Always HTTPS (todomate-api safety note). Calendar apps follow this redirect for webcal:// links.
    if (url.protocol === "http:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }
    try {
      return withSecurityHeaders(await route(request, url, env, ctx));
    } catch (error) {
      console.error("unhandled", error instanceof Error ? (error.stack ?? error.message) : error);
      return withSecurityHeaders(apiError("서버 오류가 발생했어요. 잠시 후 다시 시도해 주세요.", 500));
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const { pathname } = url;
  const method = request.method;
  const read = method === "GET" || method === "HEAD";

  if (read) {
    switch (pathname) {
      case "/":
        return new Response(method === "HEAD" ? null : page, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "public, max-age=300",
            "content-security-policy": PAGE_CSP,
          },
        });
      case "/health":
        return json({ ok: true });
      case "/favicon.svg":
        return text(FAVICON_SVG, 200, "image/svg+xml", "public, max-age=86400");
      case "/robots.txt":
        return text(ROBOTS_TXT, 200, "text/plain; charset=utf-8", "public, max-age=86400");
      case "/site.webmanifest":
        return text(MANIFEST, 200, "application/manifest+json", "public, max-age=86400");
    }
  }

  const feed = pathname.match(FEED_PATH);
  const isApi = pathname.startsWith("/api/");
  if (!feed && !isApi) return text("페이지를 찾을 수 없어요.", 404);
  if (!hasValidKey(env)) {
    console.error("TOKEN_ENCRYPTION_KEY is missing or too short");
    return apiError("서버 설정 오류예요.", 500);
  }

  if (feed && read) return handleFeed(request, feed[1] as string, env, ctx);

  if (method === "POST" && (pathname === "/api/connect" || pathname === "/api/disconnect")) {
    if (!isSameOriginJson(request, url)) return apiError("허용되지 않은 요청이에요.", 403);
    return pathname === "/api/connect" ? handleConnect(request, env, ctx) : handleDisconnect(request, env, ctx);
  }
  return apiError("지원하지 않는 요청이에요.", isApi ? 404 : 405);
}

function hasValidKey(env: Env): boolean {
  return typeof env.TOKEN_ENCRYPTION_KEY === "string" && env.TOKEN_ENCRYPTION_KEY.length >= 32;
}
