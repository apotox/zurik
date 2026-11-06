import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { encryptData, decryptData } from "../lib/crypto.js";

const PW = "correct-horse-battery-staple";
const PIPED = "piped-password-0123456789";
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "zurik.js");

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zurik-test-"));
}

function zurik(cwd, args, { password = PW, input } = {}) {
  const env = { ...process.env };
  delete env.ZURIK_PASSWORD;
  if (password !== null) env.ZURIK_PASSWORD = password;
  return spawnSync(process.execPath, [CLI, ...args], { cwd, env, input, encoding: "utf8" });
}

function write(dir, file, content) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

const read = (dir, file) => fs.readFileSync(path.join(dir, file), "utf8");

test("round-trips files, including nested paths and binary content", () => {
  const dir = tmpProject();
  const binary = Buffer.from([0, 1, 2, 0xfe, 0xff, 0x80, 0x0a, 0x0d]);
  write(dir, ".gitencrypt", "# comment\n.env\nsrc/config.json\nkeys/cert.bin\n");
  write(dir, ".env", "SECRET=1\n");
  write(dir, "src/config.json", '{"a":1}');
  write(dir, "keys/cert.bin", binary);

  assert.equal(zurik(dir, ["-e"]).status, 0);
  fs.rmSync(path.join(dir, ".env"));
  fs.rmSync(path.join(dir, "src"), { recursive: true });
  fs.rmSync(path.join(dir, "keys"), { recursive: true });

  const res = zurik(dir, ["-d"]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(read(dir, ".env"), "SECRET=1\n");
  assert.equal(read(dir, "src/config.json"), '{"a":1}');
  assert.deepEqual(fs.readFileSync(path.join(dir, "keys/cert.bin")), binary);
});

test("wrong password gives a clear error", () => {
  const dir = tmpProject();
  write(dir, ".gitencrypt", ".env\n");
  write(dir, ".env", "x");
  zurik(dir, ["-e"]);

  const res = zurik(dir, ["-d"], { password: "wrong-password-123456" });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /wrong password/);
});

test("refuses to encrypt when a listed file is missing and keeps the old bundle", () => {
  const dir = tmpProject();
  write(dir, ".gitencrypt", ".env\n");
  write(dir, ".env", "x");
  zurik(dir, ["-e"]);
  const before = read(dir, ".zurik");

  fs.rmSync(path.join(dir, ".env"));
  const res = zurik(dir, ["-e"]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Missing files/);
  assert.equal(read(dir, ".zurik"), before);
});

test(".gitignore uses whole-line matching and is idempotent", () => {
  const dir = tmpProject();
  write(dir, ".gitignore", "!.env.example\n");
  write(dir, ".gitencrypt", ".env\n./.env\n");
  write(dir, ".env", "x");

  zurik(dir, ["-e"]);
  zurik(dir, ["-e"]);
  assert.equal(read(dir, ".gitignore"), "!.env.example\n.env\n");
});

test("rejects paths outside the project on encrypt", () => {
  const dir = tmpProject();
  write(dir, ".gitencrypt", "../outside.txt\n");
  const res = zurik(dir, ["-e"]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /outside project/);
});

test("rejects a malicious bundle without writing any file", async () => {
  const dir = tmpProject();
  const bundle = { version: 1, files: { "ok.txt": "aGk=", "../pwned.txt": "aGk=" } };
  write(dir, ".zurik", await encryptData(JSON.stringify(bundle), PW));

  const res = zurik(dir, ["-d"]);
  assert.equal(res.status, 1);
  assert.equal(fs.existsSync(path.join(dir, "ok.txt")), false);
  assert.equal(fs.existsSync(path.join(dir, "..", "pwned.txt")), false);
});

test("does not overwrite changed local files without --force", () => {
  const dir = tmpProject();
  write(dir, ".gitencrypt", ".env\n");
  write(dir, ".env", "original");
  zurik(dir, ["-e"]);
  write(dir, ".env", "local edit");

  const res = zurik(dir, ["-d"]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /--force/);
  assert.equal(read(dir, ".env"), "local edit");

  assert.equal(zurik(dir, ["-d", "--force"]).status, 0);
  assert.equal(read(dir, ".env"), "original");
});

test("preserves file permissions", { skip: process.platform === "win32" }, () => {
  const dir = tmpProject();
  write(dir, ".gitencrypt", "key\n");
  write(dir, "key", "k");
  fs.chmodSync(path.join(dir, "key"), 0o600);
  zurik(dir, ["-e"]);
  fs.rmSync(path.join(dir, "key"));

  zurik(dir, ["-d"]);
  assert.equal(fs.statSync(path.join(dir, "key")).mode & 0o777, 0o600);
});

test("bundles without modes (older versions) decrypt as owner-only", { skip: process.platform === "win32" }, async () => {
  const dir = tmpProject();
  const bundle = { version: 1, files: { key: "aGk=" } };
  write(dir, ".zurik", await encryptData(JSON.stringify(bundle), PW));

  assert.equal(zurik(dir, ["-d"]).status, 0);
  assert.equal(fs.statSync(path.join(dir, "key")).mode & 0o777, 0o600);
});

test("works from a subdirectory", () => {
  const dir = tmpProject();
  write(dir, ".gitencrypt", ".env\n");
  write(dir, ".env", "x");
  fs.mkdirSync(path.join(dir, "sub/deeper"), { recursive: true });

  const res = zurik(path.join(dir, "sub/deeper"), ["-e"]);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(path.join(dir, ".zurik")));
});

test("reads the password from piped stdin with -p", () => {
  const dir = tmpProject();
  write(dir, ".gitencrypt", ".env\n");
  write(dir, ".env", "x");
  assert.equal(zurik(dir, ["-e", "-p"], { password: null, input: `${PIPED}\n` }).status, 0);
  assert.equal(zurik(dir, ["-d", "--force"], { password: PIPED }).status, 0);
});

test("shows usage for -h and for no command, without asking for a password", () => {
  const dir = tmpProject();
  const help = zurik(dir, ["-h"], { password: null });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage/);

  const none = zurik(dir, [], { password: null });
  assert.equal(none.status, 1);
  assert.match(none.stdout, /Usage/);
});

test("rejects passwords shorter than 16 characters when encrypting", () => {
  const dir = tmpProject();
  write(dir, ".gitencrypt", ".env\n");
  write(dir, ".env", "x");

  const res = zurik(dir, ["-e"], { password: "short-pw" });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /at least 16 characters/);
  assert.equal(fs.existsSync(path.join(dir, ".zurik")), false);
});

test("writes the v2 format with scrypt N=2^17", async () => {
  const blob = await encryptData("hello", PW);
  assert.ok(blob.startsWith("zurik2:"));
  const header = Buffer.from(blob.slice("zurik2:".length), "base64").subarray(0, 3);
  assert.deepEqual([...header], [17, 8, 1]);
  assert.equal((await decryptData(blob, PW)).toString(), "hello");
});

test("rejects a v2 file whose KDF parameters were tampered with", async () => {
  const raw = Buffer.from((await encryptData("hello", PW)).slice("zurik2:".length), "base64");

  const weakened = Buffer.from(raw);
  weakened[0] = 14; // try to downgrade N
  await assert.rejects(decryptData("zurik2:" + weakened.toString("base64"), PW), /wrong password or corrupted/);

  const huge = Buffer.from(raw);
  huge[0] = 30; // try to force a multi-GB allocation
  await assert.rejects(decryptData("zurik2:" + huge.toString("base64"), PW), /unsupported key derivation/);
});

test("decrypts legacy (v1) bundles and upgrades them on the next encrypt", async () => {
  // Same layout as zurik <= 1.0.5: base64(salt16 | iv16 | tag16 | ciphertext), default scrypt params.
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync("short", salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const bundle = JSON.stringify({ version: 1, files: { ".env": Buffer.from("legacy").toString("base64") } });
  const ct = Buffer.concat([cipher.update(bundle), cipher.final()]);
  const legacy = Buffer.concat([salt, iv, cipher.getAuthTag(), ct]).toString("base64");

  const dir = tmpProject();
  write(dir, ".zurik", legacy);
  write(dir, ".gitencrypt", ".env\n");

  // Old short passwords still decrypt...
  assert.equal(zurik(dir, ["-d"], { password: "short" }).status, 0);
  assert.equal(read(dir, ".env"), "legacy");

  // ...and re-encrypting with a compliant password writes v2.
  assert.equal(zurik(dir, ["-e"]).status, 0);
  assert.ok(read(dir, ".zurik").startsWith("zurik2:"));
});
