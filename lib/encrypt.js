import fs from "fs";
import path from "path";
import { encryptData } from "./crypto.js";

export default async function encryptFiles(password) {
  const listFile = ".gitencrypt";

  if (!fs.existsSync(listFile)) {
    throw new Error(".gitencrypt not found");
  }

  const fileList = fs
    .readFileSync(listFile, "utf8")
    .split("\n")
    .map(x => x.trim())
    .filter(Boolean);

  const bundle = { version: 1, files: {} };

  for (const filePath of fileList) {
    if (!fs.existsSync(filePath)) {
      console.warn(`Skipping missing file: ${filePath}`);
      continue;
    }

    const content = fs.readFileSync(filePath);
    bundle.files[filePath] = content.toString("base64");
  }

  const encrypted = await encryptData(JSON.stringify(bundle), password);
  fs.writeFileSync(".encrypted", encrypted);

  updateGitignore(fileList);
}

function updateGitignore(fileList) {
  const gi = ".gitignore";
  let text = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";

  for (const file of fileList) {
    if (!text.includes(file)) {
      text += `\n${file}`;
    }
  }

  fs.writeFileSync(gi, text.trim() + "\n");
}
