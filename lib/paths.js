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

// Normalizes a bundle path and ensures it stays inside `root`, also once symlinks are followed.
// Returns a "/"-separated relative path (as listed, not the symlink target).
export function safeRelativePath(filePath, root) {
  if (typeof filePath !== "string" || filePath.length === 0 || path.isAbsolute(filePath) || /[\r\n]/.test(filePath)) {
    throw new ZurikError("E_UNSAFE_PATH", `Refusing unsafe path: ${filePath}`, { path: filePath });
  }

  const resolved = path.resolve(root, filePath);
  if (!insideReal(root, resolved)) {
    throw new ZurikError("E_UNSAFE_PATH", `Refusing path outside project directory (possibly through a symlink): ${filePath}`, {
      path: filePath,
    });
  }

  return path.relative(root, resolved).split(path.sep).join("/");
}

// True if `abs` stays under `root` with symlinks resolved. The part of `abs` that doesn't exist yet is
// appended to its nearest existing ancestor's real path, so `dir/new` is checked through `dir`'s link.
// A dangling symlink counts as outside: writing to it would create a file wherever it points.
function insideReal(root, abs) {
  let p = abs, tail = "";
  while (!fs.lstatSync(p, { throwIfNoEntry: false })) {
    tail = path.join(path.basename(p), tail);
    p = path.dirname(p);
  }
  try {
    const rel = path.relative(fs.realpathSync(root), path.join(fs.realpathSync(p), tail));
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  } catch {
    return false;
  }
}
