#!/usr/bin/env node

import encryptFiles from "../lib/encrypt.js";
import decryptFiles from "../lib/decrypt.js";

const args = process.argv.slice(2);

function extractPassword() {
  const pIndex = args.indexOf("-p");
  if (pIndex !== -1 && args[pIndex + 1]) {
    return args[pIndex + 1];
  }
  return process.env.ZURICH_PASSWORD || null;
}


async function run() {
  const password = extractPassword();
  if (!password) {
    console.error("Missing password. Use -p <password> or set ZURICH_PASSWORD environment variable.");
    process.exit(1);
  }

  if (args.includes("-e")) {
    await encryptFiles(password);
    return;
  }

  if (args.includes("-d")) {
    await decryptFiles(password);
    return;
  }

  console.log("Usage:");
  console.log("  npx zurich -e [-p password]   Encrypt");
  console.log("  npx zurich -d [-p password]   Decrypt");
}

run().catch(err => {
  console.error(err.message);
  process.exit(1);
});
