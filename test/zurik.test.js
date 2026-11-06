import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PW = "correct-horse-battery-staple";
const PIPED = "piped-password-0123456789";
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "zurik.js");

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zurik-test-"));
}

function zurik(cwd, args, { password = PW, input } = {}) {
  const env = { ...process.env };
  delete env.ZURIK_PASSWORD;
  delete env.ZURIK_PASSWORD_FILE;
  if (password !== null) env.ZURIK_PASSWORD = password;
  return spawnSync(process.execPath, [CLI, ...args], { cwd, env, input, encoding: "utf8" });
}

function write(dir, file, content) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

const read = (dir, file) => fs.readFileSync(path.join(dir, file), "utf8");
const json = (res) => JSON.parse(res.stdout);
const list = (dir, paths) => write(dir, ".zurik", paths.map(p => `--- ${p}\n`).join("\n"));
// The data line under each "--- path" header.
const blocks = (dir) => Object.fromEntries(read(dir, ".zurik").split(/\n\n/).filter(s => s.startsWith("--- ")).map(s => s.split("\n")).map(([h, d]) => [h.slice(4), d]));

// A project whose files are listed in .zurik (not yet encrypted).
function project(files = { ".env": "A=1\n", "keys/a.pem": "k" }) {
  const dir = tmpProject();
  list(dir, Object.keys(files));
  for (const [f, c] of Object.entries(files)) write(dir, f, c);
  return dir;
}

test("round-trips files, including nested paths and binary content", () => {
  const binary = Buffer.from([0, 1, 2, 0xfe, 0xff, 0x80, 0x0a, 0x0d]);
  const dir = project({ ".env": "SECRET=1\n", "src/config.json": '{"a":1}', "keys/cert.bin": binary, "empty.txt": "" });

  assert.equal(zurik(dir, ["-e"]).status, 0);
  for (const f of [".env", "src", "keys", "empty.txt"]) fs.rmSync(path.join(dir, f), { recursive: true });

  const res = zurik(dir, ["-d"]);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(read(dir, ".env"), "SECRET=1\n");
  assert.equal(read(dir, "src/config.json"), '{"a":1}');
  assert.deepEqual(fs.readFileSync(path.join(dir, "keys/cert.bin")), binary);
  assert.equal(read(dir, "empty.txt"), "");
});

test("writes one readable section per file under a zurik3 header", () => {
  const dir = project();
  zurik(dir, ["-e"]);
  const text = read(dir, ".zurik");
  assert.match(text, /^zurik3 scrypt logN=17 r=8 p=1 salt=[A-Za-z0-9+/]{22}==\n\n--- \.env\n[A-Za-z0-9+/=]+\n\n--- keys\/a\.pem\n[A-Za-z0-9+/=]+\n$/);
  assert.doesNotMatch(text, /A=1/);
});

test("re-encrypting keeps unchanged blocks byte-identical, so diffs are per file", () => {
  const dir = project({ ".env": "A=1\n", "b.env": "B=1\n" });
  zurik(dir, ["-e"]);
  const before = blocks(dir);

  write(dir, "b.env", "B=2\n");
  const res = json(zurik(dir, ["encrypt", "--json"]));
  assert.deepEqual(res.files, [{ path: ".env", action: "unchanged" }, { path: "b.env", action: "encrypted" }]);
  const after = blocks(dir);
  assert.equal(after[".env"], before[".env"]);
  assert.notEqual(after["b.env"], before["b.env"]);
});

test("wrong password gives a clear error, and encrypt won't mix passwords", () => {
  const dir = project();
  zurik(dir, ["-e"]);
  const before = read(dir, ".zurik");

  const dec = zurik(dir, ["-d"], { password: "wrong-password-123456" });
  assert.equal(dec.status, 1);
  assert.match(dec.stderr, /wrong password/);

  const enc = zurik(dir, ["-e"], { password: "wrong-password-123456" });
  assert.equal(enc.status, 1);
  assert.match(enc.stderr, /--rekey/);
  assert.equal(read(dir, ".zurik"), before);
});

test("--rekey changes the password", () => {
  const dir = project();
  zurik(dir, ["-e"]);
  const NEW = "a-brand-new-password-42";
  assert.equal(zurik(dir, ["-e", "--rekey"], { password: NEW }).status, 0);
  assert.equal(zurik(dir, ["-d"], { password: PW }).status, 1);
  assert.equal(json(zurik(dir, ["status", "--json"], { password: NEW })).inSync, true);
});

test("rejects blocks moved to another path or a tampered header", () => {
  const dir = project({ "a.env": "a", "b.env": "b" });
  zurik(dir, ["-e"]);
  const b = blocks(dir);
  const header = read(dir, ".zurik").split("\n")[0];

  write(dir, ".zurik", `${header}\n\n--- a.env\n${b["b.env"]}\n\n--- b.env\n${b["a.env"]}\n`);
  assert.match(zurik(dir, ["-d", "-f"]).stderr, /Cannot decrypt a\.env/);

  write(dir, ".zurik", `${header.replace("logN=17", "logN=14")}\n\n--- a.env\n${b["a.env"]}\n`);
  assert.match(zurik(dir, ["-d", "-f"]).stderr, /wrong password or the \.zurik file was modified/);

  write(dir, ".zurik", `${header.replace("logN=17", "logN=30")}\n\n--- a.env\n${b["a.env"]}\n`);
  assert.match(zurik(dir, ["-d", "-f"]).stderr, /unsupported header/);
});

test("refuses to encrypt when a listed file is missing and keeps the old bundle", () => {
  const dir = project({ ".env": "x" });
  zurik(dir, ["-e"]);
  const before = read(dir, ".zurik");

  fs.rmSync(path.join(dir, ".env"));
  const res = zurik(dir, ["-e"]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Missing files/);
  assert.equal(read(dir, ".zurik"), before);
});

test(".gitignore uses whole-line matching and is idempotent", () => {
  const dir = project({ ".env": "x" });
  write(dir, ".gitignore", "!.env.example\n");
  zurik(dir, ["-e"]);
  zurik(dir, ["-e"]);
  assert.equal(read(dir, ".gitignore"), "!.env.example\n.env\n");
});

test("rejects unsafe paths and malformed files without writing anything", () => {
  const cases = [
    ["--- ../outside.txt\n", /outside project/],
    ["--- /etc/passwd\n", /unsafe path/],
    ["--- a.env\n\n--- ./a.env\n", /listed twice/],
    ["--- a.env\nnot base64!\n", /unexpected content on line 2/],
    ["--- a.env\nQUJD\n", /without a header/],
    ["zurik2:QUJD\n", /zurik 2\.x or earlier/],
  ];
  for (const [text, error] of cases) {
    const dir = tmpProject();
    write(dir, ".zurik", text);
    const res = zurik(dir, ["-d"]);
    assert.equal(res.status, 1, text);
    assert.match(res.stderr, error, text);
    assert.deepEqual(fs.readdirSync(dir), [".zurik"], text);
  }
  const dir = tmpProject();
  write(dir, ".zurik", "QUJD\n");
  assert.equal(json(zurik(dir, ["status", "--json"])).error.code, "E_OLD_FORMAT");
});

test("does not overwrite changed local files without --force", () => {
  const dir = project({ ".env": "original" });
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
  const dir = project({ key: "k" });
  fs.chmodSync(path.join(dir, "key"), 0o640);
  zurik(dir, ["-e"]);
  fs.rmSync(path.join(dir, "key"));

  zurik(dir, ["-d"]);
  assert.equal(fs.statSync(path.join(dir, "key")).mode & 0o777, 0o640);
});

test("works from a subdirectory", () => {
  const dir = project({ ".env": "x" });
  fs.mkdirSync(path.join(dir, "sub/deeper"), { recursive: true });
  const res = zurik(path.join(dir, "sub/deeper"), ["-e"]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(read(dir, ".zurik"), /^zurik3 /);
});

test("reads the password from piped stdin with -p", () => {
  const dir = project({ ".env": "x" });
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
  const dir = project({ ".env": "x" });
  const res = zurik(dir, ["-e"], { password: "short-pw" });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /at least 16 characters/);
  assert.doesNotMatch(read(dir, ".zurik"), /zurik3/);
});

// ---------- agent / harness interface ----------

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

  assert.equal(json(zurik(tmpProject(), ["encrypt", "--json"])).error.code, "E_NOT_FOUND");
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
  const dir = project({ ".env": "A=1\n", "a.key": "a", "b.key": "b" });
  zurik(dir, ["encrypt"]);

  write(dir, ".env", "A=2\n"); // modified
  fs.rmSync(path.join(dir, "a.key")); // missing-locally
  fs.appendFileSync(path.join(dir, ".zurik"), "\n--- new.key\n\n--- ghost.key\n");
  write(dir, "new.key", "n"); // not-in-bundle

  const res = json(zurik(dir, ["status", "--json"]));
  assert.equal(res.inSync, false);
  assert.deepEqual(res.files, [
    { path: ".env", state: "modified" },
    { path: "a.key", state: "missing-locally" },
    { path: "b.key", state: "in-sync" },
    { path: "new.key", state: "not-in-bundle" },
    { path: "ghost.key", state: "missing" },
  ]);
  assert.doesNotMatch(JSON.stringify(res), /A=2|A=1/);
});

test("status needs no password before anything is encrypted", () => {
  const dir = project();
  const res = zurik(dir, ["status", "--json"], { password: null });
  assert.equal(res.status, 0, res.stdout);
  assert.equal(json(res).files[0].state, "not-in-bundle");
});

test("--dry-run writes nothing and reports the planned actions", () => {
  const dir = project();
  const listed = read(dir, ".zurik");
  const enc = json(zurik(dir, ["encrypt", "--dry-run", "--json"]));
  assert.equal(enc.dryRun, true);
  assert.equal(read(dir, ".zurik"), listed);
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
  assert.match(read(dir, ".zurik"), /^zurik3 /);
});

test("help --json and skill describe the interface for agents", () => {
  const spec = json(zurik(tmpProject(), ["help", "--json"], { password: null }));
  assert.ok(spec.errorCodes.E_OLD_FORMAT);
  assert.deepEqual(Object.keys(spec.commands), ["init", "encrypt", "decrypt", "status"]);

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

test("init finds .env files, creates .zurik and only appends new sections", async () => {
  const dir = tmpProject();
  for (const f of [".env", ".env.local", "api/prod.env", "api/.env.example", "node_modules/x/.env", "notes.txt"]) write(dir, f, "x");

  const res = json(zurik(dir, ["init", "--json"], { password: null }));
  assert.equal(res.created, true);
  assert.deepEqual(res.files.map(f => [f.path, f.action]), [[".env", "added"], [".env.local", "added"], ["api/prod.env", "added"]]);
  assert.equal(read(dir, ".zurik"), "--- .env\n\n--- .env.local\n\n--- api/prod.env\n");

  // Encrypted sections survive a later init; unticked files are reported as skipped and not written.
  zurik(dir, ["encrypt"]);
  const { init } = await import("../lib/index.js");
  write(dir, ".env.test", "x");
  const again = await init({ cwd: dir, files: [] });
  assert.equal(again.created, false);
  assert.equal(again.files.find(f => f.path === ".env.test").action, "skipped");
  assert.equal(again.files.filter(f => f.action === "already-listed").length, 3);

  const before = blocks(dir);
  await init({ cwd: path.join(dir, "api") }); // nearest .zurik wins from a subdirectory
  assert.deepEqual(blocks(dir), { ...before, ".env.test": "" });
  assert.match(read(dir, ".zurik"), /^zurik3 /);

  const empty = tmpProject();
  const none = json(zurik(empty, ["init", "--json", "--dry-run"], { password: null }));
  assert.deepEqual([none.created, none.files], [true, []]);
  assert.equal(fs.existsSync(path.join(empty, ".zurik")), false);
});
