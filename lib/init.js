import fs from "fs";
import path from "path";
import { LIST_FILE, readFileList } from "./bundle.js";
import { safeRelativePath } from "./paths.js";

const SKIP_DIRS = new Set(["node_modules", ".git"]);
const ENV_FILE = /^\.env(\..+)?$|\.env$/; // .env, .env.local, prod.env
const TEMPLATE = /\.(example|sample|template|dist)$/i; // meant to be committed, not secret

const HEADER = "# Files to encrypt into .zurik with `zurik encrypt`, one path per line.\n";

// .env-style files under `root`, as sorted "/"-separated relative paths.
export function findEnvFiles(root) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory: nothing to offer from it
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(abs);
      } else if (e.isFile() && ENV_FILE.test(e.name) && !TEMPLATE.test(e.name)) {
        found.push(path.relative(root, abs).split(path.sep).join("/"));
      }
    }
  };
  walk(root);
  return found.sort();
}

// Adds `files` (default: every .env file found) to .gitencrypt, creating it if needed.
export default function initList({ root, files, dryRun = false }) {
  const listed = readFileList(root);
  const already = new Set(listed ?? []);
  const found = findEnvFiles(root);

  const chosen = new Set(files ? files.map(f => safeRelativePath(f, root)) : found);
  const added = [...chosen].filter(f => !already.has(f));

  if (!dryRun && (listed === null || added.length > 0)) {
    const listPath = path.join(root, LIST_FILE);
    const text = listed === null ? HEADER : fs.readFileSync(listPath, "utf8");
    const sep = text && !text.endsWith("\n") ? "\n" : "";
    fs.writeFileSync(listPath, text + sep + added.map(f => f + "\n").join(""));
  }

  return {
    created: listed === null,
    files: [
      ...found.filter(f => already.has(f)).map(p => ({ path: p, action: "already-listed" })),
      ...added.map(p => ({ path: p, action: "added" })),
      ...found.filter(f => !already.has(f) && !chosen.has(f)).map(p => ({ path: p, action: "skipped" })),
    ],
  };
}
