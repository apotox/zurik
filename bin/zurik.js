#!/usr/bin/env node

import fs from "fs";
import path from "path";
import * as readline from "readline";
import { fileURLToPath } from "url";
import { init, encrypt, decrypt, status, resolveRoot, ZurikError, ERROR_CODES, MIN_PASSWORD_LENGTH } from "../lib/index.js";

const PKG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(fs.readFileSync(path.join(PKG_DIR, "package.json"), "utf8")).version;

const EXIT = { OK: 0, ERROR: 1, USAGE: 2 };
const COMMANDS = { init: "init", encrypt: "encrypt", "-e": "encrypt", decrypt: "decrypt", "-d": "decrypt", status: "status", "-s": "status", skill: "skill", help: "help" };

const HELP = `zurik ${VERSION} — encrypt project secrets into a single .zurik bundle

Usage:
  zurik init     [options]   Find .env files and add them to .gitencrypt (creates it)
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

init needs no password. In a terminal it lets you pick the files (all selected by default);
otherwise (--json, --no-input, $CI or piped stdin) it adds every .env file found.

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

// Checkbox list on stderr; every item starts selected. Resolves to the selected items.
// ponytail: redraws in place, so a list taller than the terminal scrolls messily; paginate if that bites.
function selectFiles(items) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const out = process.stderr;
    const selected = items.map(() => true);
    let cursor = 0;
    let drawn = 0;

    const draw = () => {
      const lines = [
        "Select files to add to .gitencrypt (up/down move, space toggle, a all/none, enter confirm):",
        ...items.map((p, i) => `${i === cursor ? ">" : " "} [${selected[i] ? "x" : " "}] ${p}`),
      ];
      if (drawn) out.write(`\x1b[${drawn}A`);
      out.write(lines.map(l => `\x1b[2K${l}\n`).join(""));
      drawn = lines.length;
    };

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };

    // A chunk may hold several keys (fast typing, paste); arrow keys are 3-byte escapes.
    const onData = (chunk) => {
      for (const key of chunk.toString("utf8").match(/\x1b\[[A-D]|[^]/g)) {
        if (key === "\u0003") {
          cleanup();
          process.exit(130);
        } else if (key === "\r" || key === "\n") {
          cleanup();
          resolve(items.filter((_, i) => selected[i]));
          return;
        } else if (key === " ") selected[cursor] = !selected[cursor];
        else if (key === "a") selected.fill(!selected.every(Boolean));
        else if (key === "\x1b[A" || key === "k") cursor = (cursor + items.length - 1) % items.length;
        else if (key === "\x1b[B" || key === "j") cursor = (cursor + 1) % items.length;
      }
      draw();
    };

    draw();
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

const canPrompt = (opts) => Boolean(process.stdin.isTTY && !opts.noInput && !opts.json && !process.env.CI);

async function resolvePassword(opts) {
  const interactive = canPrompt(opts);

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

  if (result.command === "init") {
    log(!result.created ? "Using existing .gitencrypt" : result.dryRun ? "[dry run] would create .gitencrypt" : "Created .gitencrypt");
    for (const f of result.files) log(`  ${f.action === "added" ? prefix : ""}${f.action.padEnd(14)}  ${f.path}`);
    if (result.files.length === 0) log("No .env files found. Add the paths of your secret files to .gitencrypt.");
    log("Next: run 'zurik encrypt' and commit .zurik and .gitencrypt.");
  } else if (result.command === "encrypt") {
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
      init: { options: ["dryRun", "cwd"], password: false, result: "{ created, files: [{ path, action: 'added'|'already-listed'|'skipped' }] }", note: "Adds every .env file found unless run interactively in a terminal" },
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

// init needs no password: preview what would be added, let a terminal user untick files, then write.
async function runInit(opts, base) {
  const preview = await init({ ...base, dryRun: true });
  const candidates = preview.files.filter(f => f.action === "added").map(f => f.path);
  const files = canPrompt(opts) && candidates.length > 0 ? await selectFiles(candidates) : candidates;
  return init({ ...base, files, dryRun: opts.dryRun });
}

async function runWithPassword(opts, base) {
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
  return run({ ...base, password, force: opts.force, dryRun: opts.dryRun });
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
    const result = opts.command === "init" ? await runInit(opts, base) : await runWithPassword(opts, base);

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
