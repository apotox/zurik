// Programmatic API. Every function returns a plain result object and throws ZurikError
// (with a stable `code`) on failure. Nothing is printed and process.cwd() is never changed.
import path from "path";
import initList from "./init.js";
import encryptFiles from "./encrypt.js";
import decryptFiles from "./decrypt.js";
import statusFiles from "./status.js";
import { BUNDLE_FILE } from "./bundle.js";
import { ZurikError, ERROR_CODES } from "./errors.js";
import { findProjectRoot } from "./paths.js";
import { MIN_PASSWORD_LENGTH } from "./crypto.js";

export { ZurikError, ERROR_CODES, MIN_PASSWORD_LENGTH };

// `root` is used as-is; otherwise the nearest parent of `cwd` holding .zurik.
function resolveRoot({ root, cwd = process.cwd() }) {
  if (root) return path.resolve(root);
  const found = findProjectRoot([BUNDLE_FILE], cwd);
  if (!found) {
    throw new ZurikError("E_NOT_FOUND", `${BUNDLE_FILE} not found in ${path.resolve(cwd)} or any parent directory (run 'zurik init')`);
  }
  return found;
}

function requirePassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new ZurikError("E_NO_PASSWORD", "A password is required");
  }
}

/** Add .env files (or `files`) to .zurik, creating it if missing. No password needed.
 *  Options: { root?, cwd?, files?, dryRun? }. Root: `root`, else the nearest parent with .zurik or .git, else `cwd`. */
export async function init(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const root = options.root ? path.resolve(options.root) : findProjectRoot([BUNDLE_FILE, ".git"], cwd) ?? path.resolve(cwd);
  const dryRun = Boolean(options.dryRun);
  return { command: "init", root, dryRun, ...initList({ ...options, root, dryRun }) };
}

/** Encrypt the files listed in .zurik. Options: { password, root?, cwd?, rekey?, dryRun? } */
export async function encrypt(options = {}) {
  requirePassword(options.password);
  const root = resolveRoot(options);
  const dryRun = Boolean(options.dryRun);
  return { command: "encrypt", root, dryRun, ...(await encryptFiles({ ...options, root, dryRun })) };
}

/** Decrypt .zurik into the working tree. Options: { password, root?, cwd?, force?, dryRun? } */
export async function decrypt(options = {}) {
  requirePassword(options.password);
  const root = resolveRoot(options);
  const dryRun = Boolean(options.dryRun);
  return { command: "decrypt", root, dryRun, ...(await decryptFiles({ ...options, root, dryRun })) };
}

/** Compare .zurik with local files. The password is only needed once something is encrypted. */
export async function status(options = {}) {
  const root = resolveRoot(options);
  return { command: "status", root, ...(await statusFiles({ ...options, root })) };
}
