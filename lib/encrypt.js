import fs from "fs";
import { encryptData, MIN_PASSWORD_LENGTH } from "./crypto.js";
import { safeRelativePath } from "./paths.js";

export default async function encryptFiles(password) {
  // Only enforced when encrypting, so bundles made with shorter passwords still decrypt.
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters. ` +
        "Use a generated passphrase, e.g. from your password manager or `openssl rand -base64 24`."
    );
  }

  const listFile = ".gitencrypt";

  if (!fs.existsSync(listFile)) {
    throw new Error(".gitencrypt not found");
  }

  const fileList = [
    ...new Set(
      fs
        .readFileSync(listFile, "utf8")
        .split("\n")
        .map(x => x.trim())
        .filter(x => x && !x.startsWith("#"))
        .map(safeRelativePath)
    ),
  ];

  if (fileList.length === 0) {
    throw new Error("No files listed in .gitencrypt");
  }

  // Refuse to write a partial bundle: it would silently overwrite secrets in the existing .zurik.
  const missing = fileList.filter(f => !fs.existsSync(f));
  if (missing.length > 0) {
    throw new Error(
      `Missing files listed in .gitencrypt (run 'zurik -d' first?):\n  ${missing.join("\n  ")}`
    );
  }

  // `modes` is optional so bundles stay readable by older zurik versions.
  const bundle = { version: 1, files: {}, modes: {} };

  for (const filePath of fileList) {
    bundle.files[filePath] = fs.readFileSync(filePath).toString("base64");
    bundle.modes[filePath] = fs.statSync(filePath).mode & 0o777;
  }

  const encrypted = await encryptData(JSON.stringify(bundle), password);
  fs.writeFileSync(".zurik", encrypted);

  updateGitignore(fileList);

  console.log(`Encrypted ${fileList.length} file(s) into .zurik`);
}

function updateGitignore(fileList) {
  const gi = ".gitignore";
  const text = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
  const lines = new Set(text.split("\n").map(x => x.trim()));

  const toAdd = fileList.filter(f => !lines.has(f) && !lines.has(`/${f}`));
  if (toAdd.length === 0) return;

  fs.writeFileSync(gi, [text.trimEnd(), ...toAdd].filter(Boolean).join("\n") + "\n");
}
