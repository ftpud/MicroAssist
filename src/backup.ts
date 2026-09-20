import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";

export async function backupWorkspace(
  workspaceDir: string,
  backupDir: string,
  keep = 14,
): Promise<string> {
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
  const destination = join(backupDir, `${basename(workspaceDir)}-${stamp}`);
  await cp(workspaceDir, destination, { recursive: true, errorOnExist: true });

  const entries = (await readdir(backupDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${basename(workspaceDir)}-`))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const old of entries.slice(keep)) {
    await rm(join(backupDir, old), { recursive: true });
  }
  return destination;
}
