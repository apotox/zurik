import fs from "fs";
import path from "path";
import { ZurikError } from "./errors.js";
import { compareLocal, readBundle } from "./bundle.js";

const ACTION = { missing: "created", same: "unchanged", different: "updated" };

export default async function decryptFiles({ root, password, force = false, dryRun = false }) {
  const entries = (await readBundle(root, password)).map(entry => ({
    ...entry,
    action: ACTION[compareLocal(root, entry.path, entry.content)],
  }));

  const conflicts = entries.filter(e => e.action === "updated").map(e => e.path);
  if (conflicts.length > 0 && !force) {
    throw new ZurikError(
      "E_WOULD_OVERWRITE",
      `These local files differ from .zurik and would be overwritten (use --force):\n  ${conflicts.join("\n  ")}`,
      { files: conflicts }
    );
  }

  if (!dryRun) {
    for (const { path: relPath, content, mode, action } of entries) {
      const abs = path.join(root, relPath);
      if (action !== "unchanged") {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, { mode });
      }
      fs.chmodSync(abs, mode); // `mode` above only applies when the file is created
    }
  }

  return { files: entries.map(({ path, action }) => ({ path, action })) };
}
