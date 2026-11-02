import assert from "node:assert/strict";
import { test } from "node:test";
import { decrypt, encrypt, randomId } from "../src/crypto.ts";

test("token encryption round-trips and is randomized", async () => {
  const key = "a".repeat(64);
  const a = await encrypt(key, "session-token");
  const b = await encrypt(key, "session-token");
  assert.notEqual(a, b);
  assert.equal(await decrypt(key, a), "session-token");
  await assert.rejects(decrypt("b".repeat(64), a));
});

test("feed ids are url-safe and long", () => {
  const id = randomId();
  assert.match(id, /^[A-Za-z0-9_-]{32}$/);
});
