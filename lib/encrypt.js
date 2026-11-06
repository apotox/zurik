import fs from "fs";
import path from "path";
import { encryptData, MIN_PASSWORD_LENGTH } from "./crypto.js";
import { ZurikError } from "./errors.js";
import { BUNDLE_FILE, LIST_FILE, readFileList } from "./bundle.js";

export default async function encryptFiles({ root, password, dryRun = false }) {
  // Only enforced when encrypting, so bundles made with shorter passwords still decrypt.
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    throw new ZurikError(
      "E_WEAK_PASSWORD",
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters. ` +
        "Use a generated passphrase, e.g. from your password manager or `openssl rand -base64 24`."
    );
  }

  const fileList = readFileList(root);
  if (fileList === null) {
    throw new ZurikError("E_NO_LIST", `${LIST_FILE} not found in ${root}`);
  }
  if (fileList.length === 0) {
    throw new ZurikError("E_EMPTY_LIST", `No files listed in ${LIST_FILE}`);
  }

  // Refuse to write a partial bundle: it would silently overwrite secrets in the existing .zurik.
  const missing = fileList.filter(f => !fs.existsSync(path.join(root, f)));
  if (missing.length > 0) {
    throw new ZurikError(
      "E_MISSING_FILES",
      `Missing files listed in ${LIST_FILE} (run 'zurik decrypt' first?):\n  ${missing.join("\n  ")}`,
      { files: missing }
    );
  }

  // `modes` is optional so bundles stay readable by older zurik versions.
  const bundle = { version: 1, files: {}, modes: {} };

  for (const filePath of fileList) {
    const abs = path.join(root, filePath);
    bundle.files[filePath] = fs.readFileSync(abs).toString("base64");
    bundle.modes[filePath] = fs.statSync(abs).mode & 0o777;
  }

  const encrypted = await encryptData(JSON.stringify(bundle), password);
  const gitignoreAdded = updateGitignore(root, fileList, dryRun);

  if (!dryRun) {
    fs.writeFileSync(path.join(root, BUNDLE_FILE), encrypted);
  }

  return {
    files: fileList.map(p => ({ path: p, action: "encrypted" })),
    gitignoreAdded,
  };
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
