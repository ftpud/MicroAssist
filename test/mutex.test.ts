import assert from "node:assert/strict";
import test from "node:test";
import { Mutex } from "../src/mutex.js";

test("mutex serializes concurrent operations", async () => {
  const mutex = new Mutex();
  let active = 0;
  let maximum = 0;
  const operation = () => mutex.runExclusive(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
  });
  await Promise.all([operation(), operation(), operation()]);
  assert.equal(maximum, 1);
});
