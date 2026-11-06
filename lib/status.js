import fs from "fs";
import path from "path";
import { BUNDLE_FILE, compareLocal, openBundle, readBundle } from "./bundle.js";
import { ZurikError } from "./errors.js";

// Per-file state, comparing .zurik with the working tree. Never reveals file contents.
//   in-sync          local file matches the bundle
//   modified         local file differs from the bundle  -> encrypt to save it, or decrypt --force to discard
//   missing-locally  in the bundle, not on disk          -> decrypt
//   not-in-bundle    listed and on disk, not encrypted yet -> encrypt
//   missing          listed, but neither on disk nor encrypted
// The password is only needed once something is encrypted.
export default async function status({ root, password }) {
  const bundle = readBundle(root);
  if (bundle === null) throw new ZurikError("E_NO_BUNDLE", `${BUNDLE_FILE} not found in ${root}`);
  if (bundle.files.some(f => f.data) && (typeof password !== "string" || password.length === 0)) {
    throw new ZurikError("E_NO_PASSWORD", `A password is required to compare against ${BUNDLE_FILE}`);
  }
  const opened = new Map((await openBundle(bundle, password)).map(e => [e.path, e.content]));

  const STATE = { missing: "missing-locally", same: "in-sync", different: "modified" };
  const files = bundle.files.map(({ path: p }) => ({
    path: p,
    state: opened.has(p)
      ? STATE[compareLocal(root, p, opened.get(p))]
      : fs.existsSync(path.join(root, p)) ? "not-in-bundle" : "missing",
  }));

  return { inSync: files.length > 0 && files.every(f => f.state === "in-sync"), files };
}
