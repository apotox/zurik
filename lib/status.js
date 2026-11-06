import fs from "fs";
import path from "path";
import { BUNDLE_FILE, compareLocal, readBundle, readFileList } from "./bundle.js";
import { ZurikError } from "./errors.js";

// Per-file state, comparing .gitencrypt, .zurik and the working tree. Never reveals file contents.
//   in-sync          local file matches the bundle
//   modified         local file differs from the bundle  -> encrypt to save it, or decrypt --force to discard
//   missing-locally  in the bundle, not on disk          -> decrypt
//   not-in-bundle    listed and on disk, not in bundle   -> encrypt
//   missing          listed, but neither on disk nor in the bundle
// `listed` is false for files in the bundle that were removed from .gitencrypt (the next encrypt drops them).
export default async function status({ root, password }) {
  const listed = new Set(readFileList(root) ?? []);
  const bundleExists = fs.existsSync(path.join(root, BUNDLE_FILE));
  if (bundleExists && (typeof password !== "string" || password.length === 0)) {
    throw new ZurikError("E_NO_PASSWORD", `A password is required to compare against ${BUNDLE_FILE}`);
  }
  const bundle = bundleExists ? await readBundle(root, password) : [];
  const inBundle = new Map(bundle.map(e => [e.path, e.content]));

  const STATE = { missing: "missing-locally", same: "in-sync", different: "modified" };
  const paths = [...new Set([...listed, ...inBundle.keys()])].sort();

  const files = paths.map(p => {
    const state = inBundle.has(p)
      ? STATE[compareLocal(root, p, inBundle.get(p))]
      : fs.existsSync(path.join(root, p))
        ? "not-in-bundle"
        : "missing";
    return { path: p, state, listed: listed.has(p) };
  });

  return {
    bundleExists,
    inSync: files.length > 0 && files.every(f => f.state === "in-sync" && f.listed),
    files,
  };
}
