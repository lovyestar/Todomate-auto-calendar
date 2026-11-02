import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays, buildCalendar, dateRange, foldLine, splitRange, todayIn } from "../src/ics.ts";

const base = {
  goals: [{ id: "g1", title: "운동" }],
  now: Date.UTC(2026, 10, 2, 3, 0, 0),
  host: "todomate.yestar.dev",
  refreshMinutes: 5,
  options: { hideDone: false, showGoal: true },
};

test("all-day todo uses the Todomate date and goal prefix", () => {
  const ics = buildCalendar({
    ...base,
    todos: [{ id: "t1", content: "러닝, 30분", date: Date.UTC(2026, 10, 2), goalID: "g1", isDone: false }],
  });
  assert.match(ics, /DTSTART;VALUE=DATE:20261102\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20261103\r\n/);
  assert.match(ics, /SUMMARY:\[운동\] 러닝\\, 30분\r\n/);
  assert.match(ics, /UID:t1@todomate\.yestar\.dev\r\n/);
  assert.match(ics, /CATEGORIES:운동\r\n/);
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
});

test("goal prefix can be turned off", () => {
  const ics = buildCalendar({
    ...base,
    options: { hideDone: false, showGoal: false },
    todos: [{ id: "t1", content: "러닝", date: Date.UTC(2026, 10, 2), goalID: "g1" }],
  });
  assert.match(ics, /SUMMARY:러닝\r\n/);
});

test("todo with remindAt becomes a 30 minute timed event", () => {
  const remindAt = Date.UTC(2026, 10, 2, 0, 30); // 09:30 KST
  const ics = buildCalendar({ ...base, todos: [{ id: "t2", content: "회의", date: Date.UTC(2026, 10, 2), remindAt }] });
  assert.match(ics, /DTSTART:20261102T003000Z/);
  assert.match(ics, /DTEND:20261102T010000Z/);
});

test("done todos are marked or hidden", () => {
  const todos = [{ id: "t3", content: "끝", date: Date.UTC(2026, 10, 2), isDone: true }];
  assert.match(buildCalendar({ ...base, todos }), /SUMMARY:✅ 끝/);
  assert.doesNotMatch(buildCalendar({ ...base, todos, options: { hideDone: true, showGoal: true } }), /t3@/);
});

test("invalid records are skipped and duplicates keep the first copy", () => {
  const first = { id: "t4", content: "새 내용", date: Date.UTC(2026, 10, 2) };
  const older = { id: "t4", content: "옛 내용", date: Date.UTC(2026, 10, 1) };
  const ics = buildCalendar({ ...base, todos: [first, older, { content: "no id" }, { id: "x", date: "bad" }] });
  assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 1);
  assert.match(ics, /새 내용/);
});

test("notices become all-day events", () => {
  const ics = buildCalendar({
    ...base,
    todos: [],
    notices: [{ uid: "n1", date: "20261102", summary: "재연결 필요", description: "a;b" }],
  });
  assert.match(ics, /UID:n1@todomate\.yestar\.dev/);
  assert.ok(ics.includes("DESCRIPTION:a\\;b\r\n"));
});

test("long lines are folded within 75 octets without breaking characters", () => {
  for (const line of [`SUMMARY:${"가".repeat(60)}`, `SUMMARY:${"a".repeat(200)}`, `SUMMARY:${"😀가a".repeat(40)}`]) {
    const folded = foldLine(line);
    for (const part of folded.split("\r\n")) assert.ok(new TextEncoder().encode(part).length <= 75, part);
    assert.equal(folded.replace(/\r\n /g, ""), line);
  }
  assert.equal(foldLine("SHORT"), "SHORT");
});

test("date helpers", () => {
  assert.equal(addDays("20261231", 1), "20270101");
  assert.equal(addDays("20260301", -1), "20260228");
  assert.equal(todayIn("Asia/Seoul", Date.UTC(2026, 10, 1, 16, 0)), "20261102");
  assert.deepEqual(dateRange("20261102", 2, 3), ["20261031", "20261101", "20261102", "20261103", "20261104", "20261105"]);
});

test("splitRange covers the range exactly with bounded chunks", () => {
  assert.deepEqual(splitRange("20261101", "20261110", 4), [
    ["20261101", "20261104"],
    ["20261105", "20261108"],
    ["20261109", "20261110"],
  ]);
  assert.deepEqual(splitRange("20261101", "20261101", 62), [["20261101", "20261101"]]);
  const chunks = splitRange("20251102", "20270101", 62);
  assert.equal(chunks[0]?.[0], "20251102");
  assert.equal(chunks.at(-1)?.[1], "20270101");
  for (let i = 1; i < chunks.length; i++) assert.equal(chunks[i]?.[0], addDays(chunks[i - 1]?.[1] as string, 1));
});
