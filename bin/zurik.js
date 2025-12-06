#!/usr/bin/env node

import * as readline from "readline";
import encryptFiles from "../lib/encrypt.js";
import decryptFiles from "../lib/decrypt.js";

const args = process.argv.slice(2);


function readPassword() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    process.stdout.write("Password: ");

    let password = "";

    process.stdin.on("data", (char) => {
      char = char.toString();

      if (char === "\n" || char === "\r" || char === "\u0004") {
        process.stdin.pause();
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        rl.close();
        console.log();
        resolve(password);
      } else if (char === "\u007f" || char === "\b") {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
          process.stdout.write("Password: " + "*".repeat(password.length));
        }
      } else if (char === "\u0003") {
        // Ctrl+C
        console.log();
        process.exit(0);
      } else {
        password += char;
        process.stdout.write("*");
      }
    });
  });
}


async function extractPassword() {
  const pIndex = args.indexOf("-p");
  if (pIndex !== -1) {
    if (args[pIndex + 1] && !args[pIndex + 1].startsWith("-")) {
      return args[pIndex + 1];
    }

    return await readPassword()
  }
  return process.env.ZURIK_PASSWORD || null;
}

async function run() {
  const password = await extractPassword();
  if (!password) {
    console.error("Missing password. Use -p <password> or set ZURIK_PASSWORD environment variable.");
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
  console.log("  npx zurik -e [-p password]   Encrypt");
  console.log("  npx zurik -d [-p password]   Decrypt");
}

run().catch(err => {
  console.error(err.message);
  process.exit(1);
});
