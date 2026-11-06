import fs from "fs";
import path from "path";
import { readBundle, writeBundle } from "./bundle.js";
import { ZurikError } from "./errors.js";
import { safeRelativePath } from "./paths.js";

const SKIP_DIRS = new Set(["node_modules", ".git"]);
const ENV_FILE = /^\.env(\..+)?$|\.env$/; // .env, .env.local, prod.env
const TEMPLATE = /\.(example|sample|template|dist)$/i; // meant to be committed, not secret

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

// Adds `files` (default: every .env file found) to .zurik as not-yet-encrypted sections, creating it if needed.
export default function initList({ root, files, dryRun = false }) {
  const found = findEnvFiles(root);
  const listed = new Set((readBundle(root)?.files ?? []).map(f => f.path));
  const chosen = new Set(files ? files.map(f => safeRelativePath(f, root)) : found);
  // Found files that are already listed are reported as such, whether or not they were chosen.
  const result = addList({ root, files: [...found.filter(f => listed.has(f)), ...chosen], dryRun });
  const skipped = found.filter(f => !listed.has(f) && !chosen.has(f));
  return { ...result, files: [...result.files, ...skipped.map(p => ({ path: p, action: "skipped" }))] };
}

// Lists existing files (root-relative) in .zurik, creating it if needed. Already-listed files are left alone.
export function addList({ root, files, dryRun = false }) {
  const bundle = readBundle(root);
  const already = new Set((bundle?.files ?? []).map(f => f.path));
  const paths = [...new Set(files.map(f => safeRelativePath(f, root)))];

  const missing = paths.filter(p => !fs.statSync(path.join(root, p), { throwIfNoEntry: false })?.isFile());
  if (missing.length > 0) {
    throw new ZurikError("E_MISSING_FILES", `Not a file:\n  ${missing.join("\n  ")}`, { files: missing });
  }

  const added = paths.filter(p => !already.has(p));
  if (!dryRun && (bundle === null || added.length > 0)) {
    writeBundle(root, {
      header: bundle?.header ?? null,
      files: [...(bundle?.files ?? []), ...added.map(p => ({ path: p, data: "" }))],
    });
  }

  return {
    created: bundle === null,
    files: paths.map(p => ({ path: p, action: already.has(p) ? "already-listed" : "added" })),
  };
}
