import fs from "fs";
import path from "path";
import { decryptData } from "./crypto.js";
import { safeRelativePath } from "./paths.js";

// Bundles from older versions carry no modes; secrets default to owner-only.
const DEFAULT_MODE = 0o600;

export default async function decryptFiles(password, { force = false } = {}) {
  if (!fs.existsSync(".zurik")) {
    throw new Error(".zurik not found");
  }

  const blob = fs.readFileSync(".zurik", "utf8");
  const data = JSON.parse(await decryptData(blob, password));

  if (!data || typeof data.files !== "object" || data.files === null) {
    throw new Error("Invalid .zurik bundle");
  }

  const modes = data.modes && typeof data.modes === "object" ? data.modes : {};

  // Validate every path before writing anything.
  const entries = Object.entries(data.files).map(([filePath, base64]) => {
    const mode = Number.isInteger(modes[filePath]) ? modes[filePath] & 0o777 : DEFAULT_MODE;
    return [safeRelativePath(filePath), Buffer.from(base64, "base64"), mode];
  });

  const changed = entries.filter(
    ([filePath, buffer]) => fs.existsSync(filePath) && !fs.readFileSync(filePath).equals(buffer)
  );

  if (changed.length > 0 && !force) {
    throw new Error(
      `These local files differ from .zurik and would be overwritten (use --force):\n  ${changed
        .map(([f]) => f)
        .join("\n  ")}`
    );
  }

  for (const [filePath, buffer, mode] of entries) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer, { mode });
    fs.chmodSync(filePath, mode); // `mode` above only applies when the file is created
  }

  console.log(`Decrypted ${entries.length} file(s) from .zurik`);
}
