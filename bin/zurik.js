#!/usr/bin/env node

import * as readline from "readline";
import encryptFiles from "../lib/encrypt.js";
import decryptFiles from "../lib/decrypt.js";
import { findProjectRoot } from "../lib/paths.js";

const args = process.argv.slice(2);

function printUsage() {
  console.log(`Usage:
  zurik -e [-p [password]]           Encrypt files listed in .gitencrypt into .zurik
  zurik -d [-p [password]] [--force] Decrypt .zurik (--force overwrites changed local files)
  zurik -h                           Show this help

Password: -p alone prompts for it (or reads one line from piped stdin),
-p <password> takes it inline, otherwise ZURIK_PASSWORD is used.

Run from anywhere inside the project: zurik uses the nearest parent
directory containing .gitencrypt (encrypt) or .zurik (decrypt).`);
}

// Non-interactive stdin (e.g. `echo pw | zurik -e -p`): read the first line.
function readPasswordFromPipe() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    let done = false;
    rl.once("line", (line) => {
      done = true;
      rl.close();
      resolve(line.replace(/\r$/, ""));
    });
    rl.once("close", () => {
      if (!done) resolve("");
    });
  });
}

function readPasswordFromTTY() {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let password = "";

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
    };

    const onData = (chunk) => {
      // A chunk may contain several characters (e.g. when pasting).
      for (const char of chunk.toString("utf8")) {
        if (char === "\n" || char === "\r" || char === "\u0004") {
          cleanup();
          resolve(password);
          return;
        } else if (char === "\u0003") {
          cleanup();
          process.exit(130);
        } else if (char === "\u007f" || char === "\b") {
          if (password.length > 0) {
            password = [...password].slice(0, -1).join("");
            process.stdout.write("\b \b");
          }
        } else {
          password += char;
          process.stdout.write("*");
        }
      }
    };

    process.stdout.write("Password: ");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

function readPassword() {
  return process.stdin.isTTY ? readPasswordFromTTY() : readPasswordFromPipe();
}

async function extractPassword() {
  const pIndex = args.indexOf("-p");
  if (pIndex !== -1) {
    if (args[pIndex + 1] && !args[pIndex + 1].startsWith("-")) {
      return args[pIndex + 1];
    }

    return await readPassword();
  }
  return process.env.ZURIK_PASSWORD || null;
}

async function run() {
  if (args.includes("-h") || args.includes("--help")) {
    printUsage();
    return;
  }

  const encrypt = args.includes("-e");
  const decrypt = args.includes("-d");
  const force = args.includes("--force") || args.includes("-f");

  if (encrypt === decrypt) {
    printUsage();
    process.exit(1);
  }

  const marker = encrypt ? ".gitencrypt" : ".zurik";
  const root = findProjectRoot(marker);
  if (!root) {
    throw new Error(`${marker} not found in this directory or any parent`);
  }
  if (root !== process.cwd()) {
    console.log(`Using project root: ${root}`);
    process.chdir(root);
  }

  const password = await extractPassword();
  if (!password) {
    console.error("Missing password. Use -p <password> or set ZURIK_PASSWORD environment variable.");
    process.exit(1);
  }

  if (encrypt) {
    await encryptFiles(password);
  } else {
    await decryptFiles(password, { force });
  }
}

run().catch(err => {
  console.error(err.message);
  process.exit(1);
});
