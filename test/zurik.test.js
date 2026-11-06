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
  assert.equal(none.status, 2);
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

// ---------- agent / harness interface ----------

const json = (res) => JSON.parse(res.stdout);

function project(files = { ".env": "A=1\n", "keys/a.pem": "k" }) {
  const dir = tmpProject();
  write(dir, ".gitencrypt", Object.keys(files).join("\n") + "\n");
  for (const [f, c] of Object.entries(files)) write(dir, f, c);
  return dir;
}

test("--json: success and error are single JSON objects on stdout with stable codes", () => {
  const dir = project();
  const ok = zurik(dir, ["encrypt", "--json"]);
  assert.equal(ok.status, 0);
  assert.deepEqual(json(ok), {
    ok: true,
    command: "encrypt",
    root: fs.realpathSync(dir),
    dryRun: false,
    files: [{ path: ".env", action: "encrypted" }, { path: "keys/a.pem", action: "encrypted" }],
    gitignoreAdded: [".env", "keys/a.pem"],
  });

  write(dir, ".env", "changed");
  const err = zurik(dir, ["decrypt", "--json"]);
  assert.equal(err.status, 1);
  assert.equal(err.stderr, "");
  assert.deepEqual(json(err).error.code, "E_WOULD_OVERWRITE");
  assert.deepEqual(json(err).error.details.files, [".env"]);

  const usage = zurik(dir, ["frobnicate", "--json"]);
  assert.equal(usage.status, 2);
  assert.equal(json(usage).error.code, "E_USAGE");
});

test("never hangs waiting for a password when stdin is not a terminal", () => {
  const dir = project();
  const res = zurik(dir, ["encrypt", "--json"], { password: null, input: "" });
  assert.equal(res.status, 1);
  assert.equal(json(res).error.code, "E_NO_PASSWORD");
});

test("password from --password-file, $ZURIK_PASSWORD_FILE and --password-stdin", () => {
  const dir = project();
  const pwFile = path.join(tmpProject(), "pw");
  fs.writeFileSync(pwFile, PW + "\n");

  assert.equal(zurik(dir, ["encrypt", "--password-file", pwFile], { password: null }).status, 0);

  const env = { ...process.env, ZURIK_PASSWORD_FILE: pwFile };
  delete env.ZURIK_PASSWORD;
  const viaEnv = spawnSync(process.execPath, [CLI, "status", "--json"], { cwd: dir, env, encoding: "utf8" });
  assert.equal(json(viaEnv).inSync, true);

  const viaStdin = zurik(dir, ["status", "--password-stdin", "--json"], { password: null, input: PW + "\n" });
  assert.equal(json(viaStdin).inSync, true);
});

test("status reports every state without revealing contents", () => {
  const dir = project({ ".env": "A=1\n", "a.key": "a", "b.key": "b", "old.key": "o" });
  zurik(dir, ["encrypt"]);

  write(dir, ".env", "A=2\n"); // modified
  fs.rmSync(path.join(dir, "a.key")); // missing-locally
  write(dir, ".gitencrypt", ".env\na.key\nb.key\nnew.key\nghost.key\n"); // old.key unlisted
  write(dir, "new.key", "n"); // not-in-bundle

  const res = json(zurik(dir, ["status", "--json"]));
  assert.equal(res.inSync, false);
  assert.deepEqual(res.files, [
    { path: ".env", state: "modified", listed: true },
    { path: "a.key", state: "missing-locally", listed: true },
    { path: "b.key", state: "in-sync", listed: true },
    { path: "ghost.key", state: "missing", listed: true },
    { path: "new.key", state: "not-in-bundle", listed: true },
    { path: "old.key", state: "in-sync", listed: false },
  ]);
  assert.doesNotMatch(JSON.stringify(res), /A=2|A=1/);
});

test("status needs no password before a bundle exists", () => {
  const dir = project();
  const res = zurik(dir, ["status", "--json"], { password: null });
  assert.equal(res.status, 0);
  assert.equal(json(res).bundleExists, false);
});

test("--dry-run writes nothing and reports the planned actions", () => {
  const dir = project();
  const enc = json(zurik(dir, ["encrypt", "--dry-run", "--json"]));
  assert.equal(enc.dryRun, true);
  assert.equal(fs.existsSync(path.join(dir, ".zurik")), false);
  assert.equal(fs.existsSync(path.join(dir, ".gitignore")), false);

  zurik(dir, ["encrypt"]);
  write(dir, ".env", "local");
  fs.rmSync(path.join(dir, "keys/a.pem"));
  const dec = json(zurik(dir, ["decrypt", "-f", "-n", "--json"]));
  assert.deepEqual(dec.files, [{ path: ".env", action: "updated" }, { path: "keys/a.pem", action: "created" }]);
  assert.equal(read(dir, ".env"), "local");
  assert.equal(fs.existsSync(path.join(dir, "keys/a.pem")), false);
});

test("--cwd runs against another directory", () => {
  const dir = project();
  const res = zurik(tmpProject(), ["encrypt", "--cwd", dir, "--json"]);
  assert.equal(res.status, 0, res.stdout);
  assert.ok(fs.existsSync(path.join(dir, ".zurik")));
});

test("help --json and skill describe the interface for agents", () => {
  const spec = json(zurik(tmpProject(), ["help", "--json"], { password: null }));
  assert.ok(spec.errorCodes.E_WOULD_OVERWRITE);
  assert.deepEqual(Object.keys(spec.commands), ["encrypt", "decrypt", "status"]);

  const skill = zurik(tmpProject(), ["skill"], { password: null });
  assert.equal(skill.status, 0);
  assert.match(skill.stdout, /^---\r?\nname: zurik\r?\n/);
});

test("programmatic API returns results and throws coded errors without printing", async () => {
  const { encrypt, decrypt, status, ZurikError } = await import("../lib/index.js");
  const dir = project();

  const enc = await encrypt({ cwd: dir, password: PW });
  assert.equal(enc.files.length, 2);

  write(dir, ".env", "changed");
  await assert.rejects(decrypt({ cwd: dir, password: PW }), (e) => {
    assert.ok(e instanceof ZurikError);
    assert.equal(e.code, "E_WOULD_OVERWRITE");
    return true;
  });

  const dec = await decrypt({ root: dir, password: PW, force: true });
  assert.deepEqual(dec.files.map(f => f.action), ["updated", "unchanged"]);
  assert.equal((await status({ cwd: dir, password: PW })).inSync, true);
});
