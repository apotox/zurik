#!/usr/bin/env node

import fs from "fs";
import path from "path";
import * as readline from "readline";
import { fileURLToPath } from "url";
import { encrypt, decrypt, status, resolveRoot, ZurikError, ERROR_CODES, MIN_PASSWORD_LENGTH } from "../lib/index.js";

const PKG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(fs.readFileSync(path.join(PKG_DIR, "package.json"), "utf8")).version;

const EXIT = { OK: 0, ERROR: 1, USAGE: 2 };
const COMMANDS = { encrypt: "encrypt", "-e": "encrypt", decrypt: "decrypt", "-d": "decrypt", status: "status", "-s": "status", skill: "skill", help: "help" };

const HELP = `zurik ${VERSION} — encrypt project secrets into a single .zurik bundle

Usage:
  zurik encrypt  [options]   Encrypt files listed in .gitencrypt into .zurik   (alias: -e)
  zurik decrypt  [options]   Restore files from .zurik                         (alias: -d)
  zurik status   [options]   Show which files are in sync, without decrypting   (alias: -s)
  zurik skill                Print instructions for AI agents (SKILL.md)
  zurik help [--json]        Show this help; --json prints a machine-readable spec

Options:
  -p, --password [value]     Prompt for the password (or read a line from piped stdin);
                             with a value, use it inline (visible in ps / shell history)
  --password-stdin           Read the password from the first line of stdin
  --password-file <path>     Read the password from a file
  -f, --force                Decrypt: overwrite local files that differ from .zurik
  -n, --dry-run              Report what would happen without writing anything
  --json                     Print one JSON object on stdout (results and errors)
  --no-input                 Never prompt; fail with E_NO_PASSWORD instead
  -C, --cwd <dir>            Run as if started in <dir>
  -v, --version              Print the version

Password sources, first match wins: --password value, --password-file, --password-stdin,
-p prompt, $ZURIK_PASSWORD, $ZURIK_PASSWORD_FILE, then an interactive prompt if stdin is
a terminal (never with --json, --no-input or $CI). Encrypting needs ${MIN_PASSWORD_LENGTH}+ characters.

zurik uses the nearest parent directory containing .gitencrypt (encrypt), .zurik (decrypt)
or either (status). Exit codes: 0 success, 1 error, 2 usage error.`;

function usageError(message) {
  return new ZurikError("E_USAGE", message);
}

function parseArgs(argv) {
  const opts = { command: null, json: false, force: false, dryRun: false, noInput: false, help: false, version: false };

  // Support --flag=value for long options.
  const args = argv.flatMap(a => (a.startsWith("--") && a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a]));

  const takeValue = (i, flag) => {
    if (args[i + 1] === undefined) throw usageError(`${flag} requires a value`);
    return args[i + 1];
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (COMMANDS[a]) {
      if (opts.command && opts.command !== COMMANDS[a]) throw usageError("Specify only one command");
      opts.command = COMMANDS[a];
      continue;
    }
    switch (a) {
      case "-p":
      case "--password": {
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith("-") && !COMMANDS[next]) {
          opts.password = next;
          i++;
        } else {
          opts.promptPassword = true;
        }
        break;
      }
      case "--password-stdin": opts.passwordStdin = true; break;
      case "--password-file": opts.passwordFile = takeValue(i++, a); break;
      case "-f": case "--force": opts.force = true; break;
      case "-n": case "--dry-run": opts.dryRun = true; break;
      case "--json": opts.json = true; break;
      case "--no-input": opts.noInput = true; break;
      case "-C": case "--cwd": opts.cwd = takeValue(i++, a); break;
      case "-h": case "--help": opts.help = true; break;
      case "-v": case "--version": opts.version = true; break;
      default: throw usageError(`Unknown argument: ${a}`);
    }
  }
  return opts;
}

// ---------- password input ----------

function readLineFromStdin() {
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

// Prompt goes to stderr so stdout stays clean for --json.
function promptPassword() {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const out = process.stderr;
    let password = "";

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      out.write("\n");
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
            out.write("\b \b");
          }
        } else {
          password += char;
          out.write("*");
        }
      }
    };

    out.write("Password: ");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

function readPasswordFile(file) {
  try {
    return fs.readFileSync(file, "utf8").replace(/\r?\n$/, "");
  } catch (err) {
    throw new ZurikError("E_NO_PASSWORD", `Cannot read password file ${file}: ${err.code ?? err.message}`);
  }
}

async function resolvePassword(opts) {
  const interactive = process.stdin.isTTY && !opts.noInput && !opts.json && !process.env.CI;

  if (opts.password) return opts.password;
  if (opts.passwordFile) return readPasswordFile(opts.passwordFile);
  if (opts.passwordStdin) return readLineFromStdin();
  if (opts.promptPassword) return process.stdin.isTTY ? promptPassword() : readLineFromStdin();
  if (process.env.ZURIK_PASSWORD) return process.env.ZURIK_PASSWORD;
  if (process.env.ZURIK_PASSWORD_FILE) return readPasswordFile(process.env.ZURIK_PASSWORD_FILE);
  if (interactive) return promptPassword();
  return "";
}

// ---------- output ----------

function printHuman(result) {
  const prefix = result.dryRun ? "[dry run] would be " : "";
  const log = (s) => process.stdout.write(s + "\n");

  if (result.command === "encrypt") {
    for (const f of result.files) log(`  ${prefix}encrypted  ${f.path}`);
    if (result.gitignoreAdded.length) log(`  ${prefix}added to .gitignore: ${result.gitignoreAdded.join(", ")}`);
    log(`${result.dryRun ? "Would encrypt" : "Encrypted"} ${result.files.length} file(s) into .zurik`);
  } else if (result.command === "decrypt") {
    for (const f of result.files) log(`  ${f.action === "unchanged" ? "" : prefix}${f.action.padEnd(9)}  ${f.path}`);
    log(`${result.dryRun ? "Would decrypt" : "Decrypted"} ${result.files.length} file(s) from .zurik`);
  } else if (result.command === "status") {
    if (!result.bundleExists) log("No .zurik bundle yet.");
    for (const f of result.files) log(`  ${f.state.padEnd(15)}  ${f.path}${f.listed ? "" : "  (not in .gitencrypt)"}`);
    log(result.inSync ? "All files in sync." : "Out of sync.");
  }
}

function helpSpec() {
  return {
    name: "zurik",
    version: VERSION,
    commands: {
      encrypt: { options: ["password*", "dryRun", "cwd"], result: "{ files: [{ path, action: 'encrypted' }], gitignoreAdded: [path] }" },
      decrypt: { options: ["password*", "force", "dryRun", "cwd"], result: "{ files: [{ path, action: 'created'|'updated'|'unchanged' }] }" },
      status: { options: ["password (only if .zurik exists)", "cwd"], result: "{ bundleExists, inSync, files: [{ path, state: 'in-sync'|'modified'|'missing-locally'|'not-in-bundle'|'missing', listed }] }" },
    },
    passwordSources: ["--password <value>", "--password-file <path>", "--password-stdin", "$ZURIK_PASSWORD", "$ZURIK_PASSWORD_FILE"],
    minPasswordLength: MIN_PASSWORD_LENGTH,
    output: "With --json, stdout is exactly one JSON object: { ok: true, command, root, ... } or { ok: false, error: { code, message, details } }",
    exitCodes: { 0: "success", 1: "error (see error.code)", 2: "usage error" },
    errorCodes: ERROR_CODES,
  };
}

// ---------- main ----------

async function main() {
  let opts = { json: process.argv.includes("--json") };
  try {
    opts = parseArgs(process.argv.slice(2));

    if (opts.version) return void console.log(VERSION);
    if (opts.help || opts.command === "help") {
      return void console.log(opts.json ? JSON.stringify(helpSpec(), null, 2) : HELP);
    }
    if (opts.command === "skill") {
      return void process.stdout.write(fs.readFileSync(path.join(PKG_DIR, "skills", "zurik", "SKILL.md"), "utf8"));
    }
    if (!opts.command) {
      if (opts.json) throw usageError("No command given");
      console.log(HELP);
      process.exitCode = EXIT.USAGE;
      return;
    }

    const base = { cwd: opts.cwd ? path.resolve(opts.cwd) : process.cwd() };

    // status only needs a password when there is a bundle to compare against.
    const needsPassword =
      opts.command !== "status" || fs.existsSync(path.join(resolveRoot("status", base), ".zurik"));
    const password = needsPassword ? await resolvePassword(opts) : undefined;
    if (needsPassword && !password) {
      throw new ZurikError(
        "E_NO_PASSWORD",
        "No password provided. Use --password-file, --password-stdin, $ZURIK_PASSWORD or -p."
      );
    }

    const run = { encrypt, decrypt, status }[opts.command];
    const result = await run({ ...base, password, force: opts.force, dryRun: opts.dryRun });

    if (opts.json) console.log(JSON.stringify({ ok: true, ...result }));
    else printHuman(result);
  } catch (err) {
    const error =
      err instanceof ZurikError
        ? { code: err.code, message: err.message, details: err.details }
        : { code: "E_INTERNAL", message: err.message, details: {} };

    if (opts.json) console.log(JSON.stringify({ ok: false, error }));
    else console.error(`zurik: ${error.message}`);
    process.exitCode = error.code === "E_USAGE" ? EXIT.USAGE : EXIT.ERROR;
  }
}

main();
