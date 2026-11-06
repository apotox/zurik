import fs from "fs";
import path from "path";

// Walks up from `start` to the nearest directory containing `marker`; null if none.
export function findProjectRoot(marker, start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, marker))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Normalizes a bundle path and ensures it stays inside the current working directory.
export function safeRelativePath(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0 || path.isAbsolute(filePath)) {
    throw new Error(`Refusing unsafe path: ${filePath}`);
  }

  const cwd = process.cwd();
  const resolved = path.resolve(cwd, filePath);
  const rel = path.relative(cwd, resolved);

  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Refusing path outside project directory: ${filePath}`);
  }

  return rel.split(path.sep).join("/");
}
