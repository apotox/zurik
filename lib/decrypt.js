import fs from "fs";
import path from "path";
import { decryptData } from "./crypto.js";

export default async function decryptFiles(password) {
  if (!fs.existsSync(".zurik")) {
    throw new Error(".zurik not found");
  }

  const blob = fs.readFileSync(".zurik", "utf8");
  const jsonStr = await decryptData(blob, password);
  const data = JSON.parse(jsonStr);

  for (const [filePath, base64] of Object.entries(data.files)) {
    const buffer = Buffer.from(base64, "base64");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer);
  }
}
