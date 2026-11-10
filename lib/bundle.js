import fs from "fs";
import path from "path";
import { deriveKey, open, HEADER_PREFIX } from "./crypto.js";
import { ZurikError } from "./errors.js";
import { safeRelativePath } from "./paths.js";

export const BUNDLE_FILE = ".zurik";
const SECTION = "--- ";
const BASE64 = /^[A-Za-z0-9+/]+=*$/;
// First line of every .zurik we write, so a person or agent who opens it knows what it is and how to restore it.
// "#" lines are ignored when reading (and not preserved).
export const BANNER = "# Encrypted with zurik (https://github.com/apotox/zurik). Restore: npx zurik decrypt; agent docs: npx zurik skill";

// .zurik is plain text: the banner, a header line (once anything is encrypted), then one section per file.
// A section's data line is empty until the file is first encrypted.
//
//   # Encrypted with zurik ...
//   zurik3 scrypt logN=17 r=8 p=1 salt=...
//
//   --- .env
//   <base64>
//
//   --- api/.env.production
//
// Each file is its own line, so git diffs and merges per file.

const corrupt = (why) => new ZurikError("E_CORRUPT", `Invalid ${BUNDLE_FILE}: ${why}`);

// { header: string | null, files: [{ path, data }] }, or null if .zurik doesn't exist.
export function readBundle(root) {
  const file = path.join(root, BUNDLE_FILE);
  if (!fs.existsSync(file)) return null;

  let header = null;
  const files = [];
  const lines = fs.readFileSync(file, "utf8").split("\n").map(l => l.trim());

  lines.forEach((line, i) => {
    const last = files[files.length - 1];
    if (line === "" || line.startsWith("#")) return;
    if (line.startsWith(SECTION)) {
      const p = safeRelativePath(line.slice(SECTION.length).trim(), root);
      if (files.some(f => f.path === p)) throw corrupt(`${p} is listed twice`);
      files.push({ path: p, data: "" });
    } else if (line.startsWith(HEADER_PREFIX) && header === null && !last) {
      header = line;
    } else if (last && last.data === "" && BASE64.test(line)) {
      last.data = line;
    } else if (!last && header === null && (line.startsWith("zurik2:") || BASE64.test(line))) {
      throw new ZurikError(
        "E_OLD_FORMAT",
        `${BUNDLE_FILE} was written by zurik 2.x or earlier. Run 'npx zurik@2 decrypt', delete ${BUNDLE_FILE} ` +
          "and .gitencrypt, then 'zurik init' and 'zurik encrypt'."
      );
    } else {
      throw corrupt(`unexpected content on line ${i + 1}`);
    }
  });

  if (header === null && files.some(f => f.data)) throw corrupt("encrypted data without a header line");
  return { header, files };
}

export function writeBundle(root, { header, files }) {
  const sections = files.map(f => `${SECTION}${f.path}\n${f.data ? f.data + "\n" : ""}`);
  const top = header ? `${BANNER}\n${header}\n` : `${BANNER}\n`;
  // Write-then-rename, so an interrupted write can't leave a truncated .zurik behind.
  const file = path.join(root, BUNDLE_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, [top, ...sections].join("\n"));
  fs.renameSync(tmp, file);
}

// Decrypts every encrypted section: [{ path, content: Buffer, mode }]. Empty sections are skipped.
export async function openBundle(bundle, password) {
  const sealed = bundle.files.filter(f => f.data);
  if (sealed.length === 0) return [];
  const key = await deriveKey(bundle.header, password);
  return sealed.map(f => ({ path: f.path, ...open(key, bundle.header, f.path, f.data) }));
}

// "missing" | "same" | "different" for a local file compared with `content`.
export function compareLocal(root, relPath, content) {
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) return "missing";
  return fs.readFileSync(abs).equals(content) ? "same" : "different";
}
