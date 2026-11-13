<p align="center"><img src="assets/logo.svg" width="220" alt="zurik mascot: a cheerful padlock waving from the Alps, holding its key"></p>

<h1 align="center">zurik</h1>

A Node.js CLI tool for encrypting and decrypting sensitive project files.
It encrypts your secret files into a single `.zurik` file that you commit, and decrypts them when needed.

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/apotox/zurich/badge)](https://scorecard.dev/viewer/?uri=github.com/apotox/zurich)

## Features

- Encrypt multiple files into a **single** `.zurik` file, one section per file, so git diffs and merges each secret separately
- AES-256-GCM authenticated encryption with a scrypt-derived key
- **Zero dependencies**: everything is Node's built-in crypto — nothing extra to install, audit or keep updated
- Automatically appends sensitive files to `.gitignore` when encrypting
- Preserves file permissions; never overwrites changed local files without `--force`
- Built for automation and AI agents: `--json` output, stable error codes, `status` and `--dry-run`, never blocks on a prompt, and a library API

## Installation

Requires Node.js 18 or newer. Run it directly with `npx`, or install it globally:

```sh
npx zurik help
npm install -g zurik
```

## Choosing a password

Anyone who obtains `.zurik` can try passwords offline, as fast as their hardware allows. zurik makes each guess expensive (scrypt with N=2¹⁷, ~128 MiB of memory per guess), but only a strong password actually protects the files.

- Passwords must be at least **16 characters** to encrypt.
- Use a randomly generated one, stored in a password manager or your CI secret store:

  ```sh
  openssl rand -base64 24
  ```

## Providing the password

In order of preference:

```sh
# 1. interactive prompt (zurik prompts automatically in a terminal when no other source is set)
npx zurik encrypt

# 2. environment variable or a file, e.g. in CI or an agent's environment
export ZURIK_PASSWORD="your-secret"          # or: export ZURIK_PASSWORD_FILE=~/.secrets/zurik
npx zurik encrypt
npx zurik encrypt --password-file ~/.secrets/zurik

# 3. piped from a password manager or secret store
pass show my-project/zurik | npx zurik decrypt --password-stdin

# 4. inline (avoid: visible in `ps` and saved in shell history)
npx zurik encrypt -p "your-password"
```

zurik never prompts when stdin is not a terminal, or with `--json`, `--no-input` or `$CI` set; it fails with `E_NO_PASSWORD` instead of hanging.

## Usage

### Set up a project

```sh
npx zurik init
```

`init` finds the `.env` files in your project (`.env`, `.env.local`, `prod.env`, ...; skipping `node_modules` and templates like `.env.example`) and lists them with all of them selected. Untick any you don't want (space toggles, enter confirms) and they are listed in `.zurik`, which is created if it doesn't exist. Run it again any time to pick up new `.env` files; files already listed are left alone. It needs no password.

Outside a terminal (`--json`, `--no-input`, `$CI` or piped stdin) it adds every file found without asking. Add `--dry-run` to only see what it would do.

### Add more files

```sh
npx zurik add config/secret.json keys/deploy.pem
```

Lists the files in `.zurik` (creating it if needed); run `zurik encrypt` afterwards. Paths are relative to where you run it, must be files inside the project, and files already listed are left alone. It needs no password. You can also add a `--- <path>` line to `.zurik` by hand. To stop encrypting a file, delete its section.

### Encrypt files

```sh
npx zurik encrypt
```

Every file listed in `.zurik` is encrypted into its section, and any that are not already in `.gitignore` are appended to it. Commit `.zurik`.

Files that haven't changed keep their exact encrypted text, so a commit only touches the sections of the secrets that changed, and two people changing different secrets merge without a conflict. If two people change the *same* secret, resolve the conflict by keeping one side and running `zurik encrypt` again.

Every listed file must exist. If any is missing, nothing is written, so secrets are never dropped from `.zurik`. On a fresh clone, run `zurik decrypt` first.

To change the password, run `zurik encrypt --rekey` with the new one; every file is re-encrypted. Without `--rekey`, encrypting with a different password than the one `.zurik` uses fails, so a typo can't lock the team out.

### Decrypt files

```sh
npx zurik decrypt
```

Files are restored to their original paths with their original permissions. If a local file has changed since it was encrypted, zurik lists the affected files and stops; pass `--force` to overwrite them.

### Check status

```sh
npx zurik status
```

Shows, for every file, whether it is `in-sync`, `modified`, `missing-locally`, `not-in-bundle` (listed, not encrypted yet) or `missing`, without writing anything or printing contents. The password is only needed once something is encrypted.

### Verify the bundle

```sh
npx zurik verify
```

Proves `.zurik` is intact and authentic: the structure is valid and every section decrypts under the password. It writes nothing and never prints contents, so it is safe to run in CI or from an agent — it fails with `E_WRONG_PASSWORD` or `E_CORRUPT` when the file was edited or damaged, even by someone with commit access. Like `status`, it needs no password until something is encrypted.

Add `--dry-run` (`-n`) to `encrypt` or `decrypt` to see what would happen without writing anything.

You can run zurik from any subdirectory: it uses the nearest parent directory containing `.zurik`. `--cwd <dir>` runs it against another directory.

The short flags from earlier versions still work: `-e` (encrypt), `-d` (decrypt), `-s` (status).

## Use with AI agents and automation

zurik lets an agent manage secrets without the secrets, or the password, ever entering its context: it never prints file contents, and the password comes from the environment.

**Give your agent the skill.** `zurik skill` prints a `SKILL.md` that tells an agent when to use zurik, how to supply the password safely, and how to handle each error (including asking before `--force`):

```sh
# Claude Code (project-level; use ~/.claude/skills for all projects)
mkdir -p .claude/skills/zurik && npx zurik skill > .claude/skills/zurik/SKILL.md
```

For other agents, add the output to `AGENTS.md`, or add this line:

```md
Secrets are managed with zurik (.zurik). Run `npx zurik skill` for instructions; never read or print secret files or the password.
```

**Provide the password** through `ZURIK_PASSWORD` or `ZURIK_PASSWORD_FILE` in the agent's environment, never in the prompt.

**Machine-readable interface.** With `--json`, stdout is exactly one JSON object:

```sh
$ npx zurik status --json
{"ok":true,"command":"status","root":"/repo","inSync":false,
 "files":[{"path":".env","state":"modified"}]}

$ npx zurik decrypt --json
{"ok":false,"error":{"code":"E_WOULD_OVERWRITE","message":"...","details":{"files":[".env"]}}}
```

Branch on `error.code`. Exit codes are `0` success, `1` error and `2` usage error. `npx zurik help --json` prints the full spec: commands, result shapes, password sources and every error code.

**Library API** for harnesses and scripts. It returns the same objects as `--json`, throws `ZurikError` with a `code`, prints nothing and never changes `process.cwd()`:

```js
import { init, add, encrypt, decrypt, status, verify, ZurikError } from "zurik";

const s = await status({ cwd: "/repo", password: process.env.ZURIK_PASSWORD });
if (!s.inSync) {
  try {
    await decrypt({ root: "/repo", password: process.env.ZURIK_PASSWORD });
  } catch (err) {
    if (err instanceof ZurikError && err.code === "E_WOULD_OVERWRITE") console.log(err.details.files);
    else throw err;
  }
}
```

`init({ cwd, files, dryRun })` lists `files` (default: every `.env` file found) in `.zurik`, and `add({ cwd, files, dryRun })` lists the given files (relative to `cwd`). Neither needs a password. `verify({ password, cwd })` proves `.zurik` decrypts under the password and returns `{ verified, files }`.

Options: `password`, `cwd` (search for the project root from here) or `root` (use exactly), `force`, `rekey` and `dryRun`.

## zurik vs git-crypt, sops and dotenvx

| | zurik | git-crypt | sops | dotenvx |
|---|---|---|---|---|
| Install | `npx`, Node 18+ | native binary + git filters | Go binary | npm or binary |
| Keys | one password | GPG keys or a key file | age, PGP or cloud KMS | key pair in `.env.keys` |
| Encrypts | whole files, any type | whole files | values in YAML/JSON/ENV/INI | values in `.env` files |
| Committed | one `.zurik` file | the encrypted files in place | the encrypted files in place | the encrypted `.env` files |
| Built for agents | `--json`, error codes, skill, never prints secrets | no | no | no |

Pick zurik when you want one shared password, no extra tooling beyond Node, and an agent that can restore and check secrets without reading them. Pick sops or git-crypt when you need per-person keys or a cloud KMS.

## File format

`.zurik` is a text file with a comment line, a header line and one section per file:

```txt
# Encrypted with zurik (https://github.com/apotox/zurik). Restore: npx zurik decrypt; agent docs: npx zurik skill
zurik3 scrypt logN=17 r=8 p=1 salt=<base64>

--- .env
<base64 of iv (12) | tag (16) | ciphertext>

--- api/.env.production
<base64 ...>
```

The key is derived once from the password with the scrypt parameters and salt in the header. Each file is encrypted separately with AES-256-GCM; its plaintext is its permission bits followed by its content. The header line and the file's path are authenticated as additional data, so the scrypt parameters can't be weakened and a section can't be moved to another path. A section with no data line is listed but not encrypted yet. Lines starting with `#` are ignored and not kept: zurik rewrites the comment line each time it writes the file, so anyone (or any agent) who opens `.zurik` knows what it is.

Because files are encrypted separately, anyone who can read `.zurik` can see each file's approximate size and which file changed in each commit (the paths are visible anyway, as they are in `.gitignore`).

## Upgrading from zurik 2.x

zurik 3 uses a new format and no longer reads `.zurik` files from 2.x or `.gitencrypt`. To migrate a project:

```sh
npx zurik@2 decrypt      # restore the files with the old version
rm .zurik                # keep .gitencrypt for now: it shows which files to list
npx zurik init           # lists the .env files; add a "--- <path>" line for any others
npx zurik encrypt
git rm .gitencrypt
```

Everyone on the team needs zurik 3 after that; zurik 2.x can't read the new file.

The `#` comment line was added after 3.1.0, and zurik 3.1.0 and earlier reject it, so after upgrading make sure everyone uses `npx zurik@latest`.

## Development

```sh
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).
