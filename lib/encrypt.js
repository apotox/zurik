import fs from "fs";
import path from "path";
import { deriveKey, newHeader, open, seal, MIN_PASSWORD_LENGTH } from "./crypto.js";
import { ZurikError } from "./errors.js";
import { BUNDLE_FILE, readBundle, writeBundle } from "./bundle.js";

export default async function encryptFiles({ root, password, rekey = false, dryRun = false }) {
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    throw new ZurikError(
      "E_WEAK_PASSWORD",
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters. ` +
        "Use a generated passphrase, e.g. from your password manager or `openssl rand -base64 24`."
    );
  }

  const bundle = readBundle(root);
  if (bundle === null) throw new ZurikError("E_NO_BUNDLE", `${BUNDLE_FILE} not found in ${root} (run 'zurik init')`);
  if (bundle.files.length === 0) throw new ZurikError("E_EMPTY_LIST", `No files listed in ${BUNDLE_FILE}`);

  // Refuse to write a partial bundle: it would silently drop secrets from .zurik.
  const missing = bundle.files.map(f => f.path).filter(p => !fs.existsSync(path.join(root, p)));
  if (missing.length > 0) {
    throw new ZurikError(
      "E_MISSING_FILES",
      `Missing files listed in ${BUNDLE_FILE} (run 'zurik decrypt' first?):\n  ${missing.join("\n  ")}`,
      { files: missing }
    );
  }

  // Keeping the header (salt) lets unchanged files keep their exact block, so git diffs and merges per file.
  const header = bundle.header && !rekey ? bundle.header : newHeader();
  const key = await deriveKey(header, password);

  const files = bundle.files.map(({ path: p, data }) => {
    const abs = path.join(root, p);
    const local = { content: fs.readFileSync(abs), mode: fs.statSync(abs).mode & 0o777 };
    if (data && header === bundle.header) {
      const stored = unseal(key, header, p, data);
      if (stored.content.equals(local.content) && stored.mode === local.mode) return { path: p, data, action: "unchanged" };
    }
    return { path: p, data: seal(key, header, p, local), action: "encrypted" };
  });

  const gitignoreAdded = updateGitignore(root, files.map(f => f.path), dryRun);
  if (!dryRun) writeBundle(root, { header, files });

  return { files: files.map(({ path, action }) => ({ path, action })), gitignoreAdded };
}

function unseal(key, header, p, data) {
  try {
    return open(key, header, p, data);
  } catch (err) {
    err.message += ". To change the password, rerun with --rekey.";
    throw err;
  }
}

// Appends listed files that .gitignore doesn't already contain as a whole line. Returns what was (or would be) added.
function updateGitignore(root, fileList, dryRun) {
  const gi = path.join(root, ".gitignore");
  const text = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
  const lines = new Set(text.split("\n").map(x => x.trim()));

  const toAdd = fileList.filter(f => !lines.has(f) && !lines.has(`/${f}`));
  if (toAdd.length > 0 && !dryRun) {
    fs.writeFileSync(gi, [text.trimEnd(), ...toAdd].filter(Boolean).join("\n") + "\n");
  }
  return toAdd;
}
