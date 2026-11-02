// Thin client for todomate-api (eheka78 fork of https://github.com/3x-haust/todomate-api,
// which adds GET /todos/range). Uses the service binding when available.

import type { Goal, Todo } from "./ics.ts";

export class TodomateApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type LoginResult = {
  readonly token: string;
  readonly uid: string;
  readonly expiresAt: number;
};

export class TodomateApi {
  constructor(
    private readonly baseUrl: string,
    private readonly binding?: Fetcher,
  ) {}

  /** @param clientIp end user's IP, used by todomate-api for login rate limiting */
  async login(email: string, password: string, clientIp: string): Promise<LoginResult> {
    const body = await this.request<Record<string, unknown>>("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-todomate-remote-address": clientIp },
      body: JSON.stringify({ email, password }),
    });
    if (typeof body.token !== "string" || typeof body.uid !== "string") {
      throw new TodomateApiError(502, "BAD_RESPONSE", "Unexpected login response");
    }
    return {
      token: body.token,
      uid: body.uid,
      expiresAt: typeof body.expiresAt === "number" ? body.expiresAt : Date.now() + 30 * 86_400_000,
    };
  }

  /** Stateless upstream; called best-effort when we discard a token. */
  async logout(token: string): Promise<void> {
    await this.request("/auth/logout", { method: "POST", headers: auth(token) });
  }

  goals(token: string): Promise<Goal[]> {
    return this.request<Goal[]>("/goals", { headers: auth(token) });
  }

  /** @param from YYYYMMDD (inclusive) @param to YYYYMMDD (inclusive) */
  todosInRange(token: string, from: string, to: string): Promise<Todo[]> {
    return this.request<Todo[]>(`/todos/range?from=${from}&to=${to}`, { headers: auth(token) });
  }

  /** @param date YYYYMMDD */
  todos(token: string, date: string): Promise<Todo[]> {
    return this.request<Todo[]>(`/todos?date=${date}`, { headers: auth(token) });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const request = new Request(`${this.baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(20_000) });
    const response = this.binding ? await this.binding.fetch(request) : await fetch(request);
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text === "" ? null : JSON.parse(text);
    } catch {
      // keep null
    }
    if (!response.ok) {
      const error = (json as { error?: { code?: string; message?: string } } | null)?.error;
      throw new TodomateApiError(
        response.status,
        error?.code ?? "HTTP_ERROR",
        error?.message ?? `todomate-api responded ${response.status}`,
      );
    }
    return json as T;
  }
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}
