// Builds an iCalendar (RFC 5545) feed from Todomate todos.
// Pure functions only, so they can be unit-tested without Workers runtime.

export type Todo = {
  readonly id?: unknown;
  readonly content?: unknown;
  readonly date?: unknown; // UTC-midnight epoch ms of the local date
  readonly isDone?: unknown;
  readonly doneTime?: unknown;
  readonly createTime?: unknown;
  readonly goalID?: unknown;
  readonly remindAt?: unknown; // epoch ms, optional
  readonly memo?: unknown;
};

export type Goal = { readonly id?: unknown; readonly title?: unknown };

export type FeedOptions = {
  readonly hideDone: boolean;
  readonly showGoal: boolean;
};

export type Notice = {
  readonly uid: string;
  readonly date: string; // YYYYMMDD
  readonly summary: string;
  readonly description: string;
};

export type BuildInput = {
  readonly todos: readonly Todo[];
  readonly goals: readonly Goal[];
  readonly options: FeedOptions;
  readonly notices?: readonly Notice[];
  readonly now: number;
  readonly host: string;
  readonly refreshMinutes: number;
  readonly calendarName?: string;
  readonly timezone?: string;
  /** Only include todos of this goal (a per-goal calendar). */
  readonly goalId?: string;
};

const TIMED_EVENT_MINUTES = 30;

export function buildCalendar(input: BuildInput): string {
  const goalTitles = new Map<string, string>();
  for (const goal of input.goals) {
    if (typeof goal.id === "string" && typeof goal.title === "string") {
      goalTitles.set(goal.id, goal.title);
    }
  }

  const stamp = formatUtc(input.now);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Todomate-auto-calendar//KO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(input.calendarName ?? "투두메이트")}`,
    `X-WR-TIMEZONE:${input.timezone ?? "Asia/Seoul"}`,
    `REFRESH-INTERVAL;VALUE=DURATION:PT${input.refreshMinutes}M`,
    `X-PUBLISHED-TTL:PT${input.refreshMinutes}M`,
  ];

  for (const notice of input.notices ?? []) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${notice.uid}@${input.host}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${notice.date}`,
      `DTEND;VALUE=DATE:${nextDay(notice.date)}`,
      `SUMMARY:${escapeText(notice.summary)}`,
      `DESCRIPTION:${escapeText(notice.description)}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }

  const seen = new Set<string>();
  for (const todo of input.todos) {
    const event = todoToEvent(todo, goalTitles, input, stamp);
    if (event === null || seen.has(event.uid)) continue;
    seen.add(event.uid);
    lines.push(...event.lines);
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

function todoToEvent(
  todo: Todo,
  goalTitles: ReadonlyMap<string, string>,
  input: BuildInput,
  stamp: string,
): { uid: string; lines: string[] } | null {
  if (typeof todo.id !== "string" || typeof todo.date !== "number") return null;
  if (input.goalId !== undefined && todo.goalID !== input.goalId) return null;
  if (todo.isDone === true && input.options.hideDone) return null;
  const content = typeof todo.content === "string" && todo.content.trim() !== "" ? todo.content : "(내용 없음)";

  // Plain list: no done marks. A per-goal calendar is already one goal, so no tag there.
  const goal = typeof todo.goalID === "string" ? goalTitles.get(todo.goalID) : undefined;
  const goalTag = input.options.showGoal && goal && input.goalId === undefined ? `[${goal}] ` : "";
  const summary = `${goalTag}${content}`;
  const memo = typeof todo.memo === "string" ? todo.memo.trim() : "";

  const uid = `${todo.id}@${input.host}`;
  const lines = ["BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${stamp}`];

  if (typeof todo.remindAt === "number" && todo.remindAt > 0) {
    lines.push(
      `DTSTART:${formatUtc(todo.remindAt)}`,
      `DTEND:${formatUtc(todo.remindAt + TIMED_EVENT_MINUTES * 60_000)}`,
    );
  } else {
    const day = todomateDateToYyyymmdd(todo.date);
    lines.push(`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${nextDay(day)}`);
  }

  const modified = [todo.doneTime, todo.createTime].find((v): v is number => typeof v === "number" && v > 0);
  if (modified !== undefined) lines.push(`LAST-MODIFIED:${formatUtc(Math.min(modified, input.now))}`);

  lines.push(`SUMMARY:${escapeText(summary)}`);
  if (memo !== "") lines.push(`DESCRIPTION:${escapeText(memo)}`);
  if (goal) lines.push(`CATEGORIES:${escapeText(goal)}`);
  lines.push("TRANSP:TRANSPARENT", "STATUS:CONFIRMED", "END:VEVENT");
  return { uid, lines };
}

/** Todomate stores a todo's day as UTC midnight of that calendar date. */
export function todomateDateToYyyymmdd(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

export function nextDay(yyyymmdd: string): string {
  return addDays(yyyymmdd, 1);
}

export function addDays(yyyymmdd: string, days: number): string {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  return todomateDateToYyyymmdd(Date.UTC(y, m - 1, d + days));
}

/** Today's date (YYYYMMDD) in the given IANA timezone. */
export function todayIn(timezone: string, now: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}`;
}

/** Split [from, to] (inclusive, YYYYMMDD) into consecutive chunks of at most `size` days. */
export function splitRange(from: string, to: string, size: number): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let start = from;
  while (start <= to) {
    const end = addDays(start, size - 1);
    out.push([start, end < to ? end : to]);
    start = addDays(start, size);
  }
  return out;
}

export function dateRange(today: string, pastDays: number, futureDays: number): string[] {
  const days: string[] = [];
  for (let i = -pastDays; i <= futureDays; i++) days.push(addDays(today, i));
  return days;
}

function formatUtc(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

const NON_ASCII = /[^\x00-\x7f]/;
const NEEDS_ESCAPE = /[\\;,\r\n]/;
const ESCAPES = /\\|;|,|\r?\n/g;

export function escapeText(value: string): string {
  if (!NEEDS_ESCAPE.test(value)) return value;
  return value.replace(ESCAPES, (m) => (m === "\\" ? "\\\\" : m === ";" ? "\\;" : m === "," ? "\\," : "\\n"));
}

/** Fold lines longer than 75 octets (UTF-8), never splitting a character. */
export function foldLine(line: string): string {
  // Fast path: every UTF-16 unit is at most 3 UTF-8 bytes (surrogate pairs: 4 bytes per 2 units).
  if (line.length <= 25) return line;
  if (line.length <= 75 && !NON_ASCII.test(line)) return line;
  const out: string[] = [];
  let start = 0;
  let size = 0;
  let limit = 75;
  for (let i = 0; i < line.length; i++) {
    const code = line.charCodeAt(i);
    let width = code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
    let units = 1;
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < line.length) {
      width = 4;
      units = 2;
    }
    if (size + width > limit) {
      out.push(line.slice(start, i));
      start = i;
      size = 0;
      limit = 74; // continuation lines start with a space
    }
    size += width;
    i += units - 1;
  }
  out.push(line.slice(start));
  return out.join("\r\n ");
}
