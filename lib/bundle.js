import fs from "fs";
import path from "path";
import { decryptData } from "./crypto.js";
import { ZurikError } from "./errors.js";
import { safeRelativePath } from "./paths.js";

export const LIST_FILE = ".gitencrypt";
export const BUNDLE_FILE = ".zurik";

// Bundles from older versions carry no modes; secrets default to owner-only.
const DEFAULT_MODE = 0o600;

// Paths listed in .gitencrypt, normalized and de-duplicated. `null` if the file doesn't exist.
export function readFileList(root) {
  const listPath = path.join(root, LIST_FILE);
  if (!fs.existsSync(listPath)) return null;

  return [
    ...new Set(
      fs
        .readFileSync(listPath, "utf8")
        .split("\n")
        .map(x => x.trim())
        .filter(x => x && !x.startsWith("#"))
        .map(f => safeRelativePath(f, root))
    ),
  ];
}

// Decrypts .zurik and returns [{ path, content: Buffer, mode }]. Every path is validated.
export async function readBundle(root, password) {
  const bundlePath = path.join(root, BUNDLE_FILE);
  if (!fs.existsSync(bundlePath)) {
    throw new ZurikError("E_NO_BUNDLE", `${BUNDLE_FILE} not found in ${root}`);
  }

  const plaintext = await decryptData(fs.readFileSync(bundlePath, "utf8"), password);

  let data;
  try {
    data = JSON.parse(plaintext);
  } catch {
    throw new ZurikError("E_CORRUPT", "Invalid .zurik bundle");
  }
  if (!data || typeof data.files !== "object" || data.files === null) {
    throw new ZurikError("E_CORRUPT", "Invalid .zurik bundle");
  }

  const modes = data.modes && typeof data.modes === "object" ? data.modes : {};

  return Object.entries(data.files).map(([filePath, base64]) => ({
    path: safeRelativePath(filePath, root),
    content: Buffer.from(base64, "base64"),
    mode: Number.isInteger(modes[filePath]) ? modes[filePath] & 0o777 : DEFAULT_MODE,
  }));
}

// "missing" | "same" | "different" for a local file compared with `content`.
export function compareLocal(root, relPath, content) {
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) return "missing";
  return fs.readFileSync(abs).equals(content) ? "same" : "different";
}
