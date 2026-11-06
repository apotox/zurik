# zurik

A Node.js CLI tool for encrypting and decrypting sensitive project files.
It collects file paths from `.gitencrypt`, bundles them into a single `.zurik` file, and decrypts them when needed.

## Features

- Encrypt multiple files into a **single** `.zurik` bundle
- AES-256-GCM authenticated encryption with a scrypt-derived key
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

### Encrypt files

1. Create a `.gitencrypt` file in the root of your project.
2. Add the paths of the files you want to encrypt, one per line. Lines starting with `#` are ignored, and paths must be inside the project.

   ```txt
   # secrets for local development
   src/config.json
   src/secret.txt
   ```

3. Run:

   ```sh
   npx zurik encrypt
   ```

The files are encrypted into `.zurik`, and any that are not already listed in `.gitignore` are appended to it. Commit `.zurik` and `.gitencrypt`.

Every listed file must exist. If any is missing, nothing is written, so an existing `.zurik` is never overwritten with a partial bundle. On a fresh clone, run `zurik decrypt` first.

### Decrypt files

```sh
npx zurik decrypt
```

Files are restored to their original paths with their original permissions. If a local file has changed since it was encrypted, zurik lists the affected files and stops; pass `--force` to overwrite them.

### Check status

```sh
npx zurik status
```

Shows, for every file, whether it is `in-sync`, `modified`, `missing-locally`, `not-in-bundle` or `missing`, without writing anything or printing contents. The password is only needed once `.zurik` exists.

Add `--dry-run` (`-n`) to `encrypt` or `decrypt` to see what would happen without writing anything.

You can run zurik from any subdirectory: it uses the nearest parent directory containing `.gitencrypt` (encrypt), `.zurik` (decrypt) or either (status). `--cwd <dir>` runs it against another directory.

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
Secrets are managed with zurik (.gitencrypt / .zurik). Run `npx zurik skill` for instructions; never read or print secret files or the password.
```

**Provide the password** through `ZURIK_PASSWORD` or `ZURIK_PASSWORD_FILE` in the agent's environment, never in the prompt.

**Machine-readable interface.** With `--json`, stdout is exactly one JSON object:

```sh
$ npx zurik status --json
{"ok":true,"command":"status","root":"/repo","bundleExists":true,"inSync":false,
 "files":[{"path":".env","state":"modified","listed":true}]}

$ npx zurik decrypt --json
{"ok":false,"error":{"code":"E_WOULD_OVERWRITE","message":"...","details":{"files":[".env"]}}}
```

Branch on `error.code`. Exit codes are `0` success, `1` error and `2` usage error. `npx zurik help --json` prints the full spec: commands, result shapes, password sources and every error code.

**Library API** for harnesses and scripts. It returns the same objects as `--json`, throws `ZurikError` with a `code`, prints nothing and never changes `process.cwd()`:

```js
import { encrypt, decrypt, status, ZurikError } from "zurik";

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

Options: `password`, `cwd` (search for the project root from here) or `root` (use exactly), `force` and `dryRun`.

## Bundle format

`.zurik` is a text file: `zurik2:` followed by base64 of `logN | r | p | salt (16) | iv (12) | tag (16) | ciphertext`. The scrypt parameters are authenticated as AES-GCM additional data, so they cannot be altered to weaken the key.

Bundles written by zurik 1.0.5 and earlier (no `zurik2:` prefix) still decrypt, including those with passwords shorter than 16 characters. The next `zurik encrypt` rewrites them in the new format, and at that point the password must meet the minimum length.

## Development

```sh
npm test
```
