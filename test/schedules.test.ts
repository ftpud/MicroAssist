import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deleteRecurring, parseRecurring, readRecurring } from "../src/schedules.js";

test("recurring events parse and can be deleted", async () => {
  const markdown = `# Повторяющиеся события

- recurring-motivation | enabled | 0 10 * * * | Europe/Riga | "Напиши мотивационный пост"
- broken | enabled | not-a-cron | Europe/Riga | "ignored"
`;
  assert.deepEqual(parseRecurring(markdown), [{
    id: "recurring-motivation", cron: "0 10 * * *", timezone: "Europe/Riga",
    prompt: "Напиши мотивационный пост", enabled: true,
  }]);
  const workspace = await mkdtemp(join(tmpdir(), "micro-assist-recurring-"));
  await writeFile(join(workspace, "RECURRING.md"), markdown, "utf8");
  assert.equal((await readRecurring(workspace)).length, 1);
  assert.equal(await deleteRecurring(workspace, "recurring-motivation"), true);
  assert.doesNotMatch(await readFile(join(workspace, "RECURRING.md"), "utf8"), /recurring-motivation/);
  assert.equal(await deleteRecurring(workspace, "recurring-motivation"), false);
});
