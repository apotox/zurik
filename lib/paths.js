import fs from "fs";
import path from "path";
import { ZurikError } from "./errors.js";

// Walks up from `start` to the nearest directory containing any of `markers`; null if none.
export function findProjectRoot(markers, start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (markers.some(m => fs.existsSync(path.join(dir, m)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Normalizes a bundle path and ensures it stays inside `root`. Returns a "/"-separated relative path.
export function safeRelativePath(filePath, root) {
  if (typeof filePath !== "string" || filePath.length === 0 || path.isAbsolute(filePath) || /[\r\n]/.test(filePath)) {
    throw new ZurikError("E_UNSAFE_PATH", `Refusing unsafe path: ${filePath}`, { path: filePath });
  }

  const resolved = path.resolve(root, filePath);
  const rel = path.relative(root, resolved);

  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new ZurikError("E_UNSAFE_PATH", `Refusing path outside project directory: ${filePath}`, {
      path: filePath,
    });
  }

  return rel.split(path.sep).join("/");
}
