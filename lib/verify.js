import { BUNDLE_FILE, openBundle, readBundle } from "./bundle.js";
import { ZurikError } from "./errors.js";

// Proves .zurik is intact and authentic without writing anything: readBundle throws on any
// structural damage, and openBundle's AES-GCM tags throw E_WRONG_PASSWORD when a section was
// modified or the password is wrong. Plaintext is never returned or printed; it is read and dropped.
// Like status, the password is only needed once something is encrypted.
export default async function verify({ root, password }) {
  const bundle = readBundle(root);
  if (bundle === null) throw new ZurikError("E_NO_BUNDLE", `${BUNDLE_FILE} not found in ${root}`);
  const sealed = bundle.files.filter(f => f.data);
  if (sealed.length > 0 && (typeof password !== "string" || password.length === 0)) {
    throw new ZurikError("E_NO_PASSWORD", `A password is required to verify ${BUNDLE_FILE}`);
  }
  await openBundle(bundle, password);
  return { verified: sealed.length > 0, files: sealed.map(f => f.path) };
}
