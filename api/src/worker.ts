// Cloudflare Workers entry for todomate-api (eheka78 fork, pinned in package.json).
// The upstream app is a Hono app that reads its config from an env object, so we
// build it once per isolate from the Worker bindings.

import { createApp } from "todomate-api/src/server.ts";

type Env = Record<string, unknown>;

let app: ReturnType<typeof createApp> | undefined;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    app ??= createApp({ env: stringEnv(env) });

    // Upstream rate-limits logins by the `x-todomate-remote-address` header.
    // Public requests: trust only Cloudflare's cf-connecting-ip (cannot be spoofed).
    // Service-binding requests (no cf-connecting-ip): the calling Worker passes the end user's IP.
    const headers = new Headers(request.headers);
    const publicIp = request.headers.get("cf-connecting-ip");
    headers.set(
      "x-todomate-remote-address",
      publicIp ?? request.headers.get("x-todomate-remote-address") ?? "binding:unknown",
    );
    return app.fetch(new Request(request, { headers }), env, ctx);
  },
};

function stringEnv(env: Env): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}
