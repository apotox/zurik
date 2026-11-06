// Programmatic API. Every function returns a plain result object and throws ZurikError
// (with a stable `code`) on failure. Nothing is printed and process.cwd() is never changed.
import path from "path";
import encryptFiles from "./encrypt.js";
import decryptFiles from "./decrypt.js";
import statusFiles from "./status.js";
import { BUNDLE_FILE, LIST_FILE } from "./bundle.js";
import { ZurikError, ERROR_CODES } from "./errors.js";
import { findProjectRoot } from "./paths.js";
import { MIN_PASSWORD_LENGTH } from "./crypto.js";

export { ZurikError, ERROR_CODES, MIN_PASSWORD_LENGTH };

const MARKERS = {
  encrypt: [LIST_FILE],
  decrypt: [BUNDLE_FILE],
  status: [LIST_FILE, BUNDLE_FILE],
};

// `root` is used as-is; otherwise the nearest parent of `cwd` holding the command's marker file.
export function resolveRoot(command, { root, cwd = process.cwd() } = {}) {
  if (root) return path.resolve(root);
  const markers = MARKERS[command];
  const found = findProjectRoot(markers, cwd);
  if (!found) {
    throw new ZurikError(
      "E_NOT_FOUND",
      `${markers.join(" or ")} not found in ${path.resolve(cwd)} or any parent directory`
    );
  }
  return found;
}

function requirePassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new ZurikError("E_NO_PASSWORD", "A password is required");
  }
}

/** Encrypt the files listed in .gitencrypt into .zurik. Options: { password, root?, cwd?, dryRun? } */
export async function encrypt(options = {}) {
  requirePassword(options.password);
  const root = resolveRoot("encrypt", options);
  const dryRun = Boolean(options.dryRun);
  return { command: "encrypt", root, dryRun, ...(await encryptFiles({ ...options, root, dryRun })) };
}

/** Decrypt .zurik into the working tree. Options: { password, root?, cwd?, force?, dryRun? } */
export async function decrypt(options = {}) {
  requirePassword(options.password);
  const root = resolveRoot("decrypt", options);
  const dryRun = Boolean(options.dryRun);
  return { command: "decrypt", root, dryRun, ...(await decryptFiles({ ...options, root, dryRun })) };
}

/** Compare .gitencrypt, .zurik and local files. The password is only needed when .zurik exists. */
export async function status(options = {}) {
  const root = resolveRoot("status", options);
  return { command: "status", root, ...(await statusFiles({ ...options, root })) };
}
