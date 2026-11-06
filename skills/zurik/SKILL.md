---
name: zurik
description: Encrypt, decrypt and check project secrets (.env files, keys, config) that are stored in a .zurik file. Use whenever a repo contains .zurik, when secret files are missing after a clone, when the user asks to encrypt/commit/share/restore secrets, or before editing or committing a file listed in .zurik. Prefer it over reading, copying, printing or hand-encrypting secret files.
---

# zurik

zurik keeps a project's secret files encrypted in one committed file, `.zurik`, with one `--- <path>` section per file. The plaintext files are git-ignored. zurik never prints file contents, so you can manage secrets without them entering your context.

Run it with `npx zurik` (or `zurik` if it's installed). Always pass `--json` and branch on `ok` / `error.code`, never on message text.

## Commands

| Goal | Command |
|---|---|
| Set up a repo without `.zurik` (lists every `.env` file found; no password) | `npx zurik init --dry-run --json`, confirm the list with the user, then `npx zurik init --json` |
| See what's out of sync (safe, read-only) | `npx zurik status --json` |
| Restore secrets after a clone | `npx zurik decrypt --json` |
| Save changes to secret files into `.zurik` | `npx zurik encrypt --json` |
| Preview without writing anything | add `--dry-run` |
| Machine-readable spec of all options and codes | `npx zurik help --json` |

`--cwd <dir>` runs against another directory. zurik uses the nearest parent directory containing `.zurik`.

## Password: never put it in your context

- Do **not** ask the user to paste the password into the chat. Do **not** use `-p <password>` or `--password <value>`: that puts it in the transcript, the shell history and the process list.
- Use what the environment already provides, in this order: `$ZURIK_PASSWORD`, `$ZURIK_PASSWORD_FILE`, or `--password-file <path>` / `--password-stdin` piped from a secret manager the user names (e.g. `op read ... | npx zurik decrypt --password-stdin --json`).
- On `E_NO_PASSWORD`, stop and tell the user to set `ZURIK_PASSWORD` (or `ZURIK_PASSWORD_FILE`) in the environment the agent runs in. Don't guess or generate one for an existing bundle.
- zurik never prompts when stdin isn't a terminal or when `--json` is set, so it won't hang.

## Workflow

1. `status --json` first. States: `in-sync`, `modified` (local differs from bundle), `missing-locally` (run decrypt), `not-in-bundle` (listed, not encrypted yet: run encrypt), `missing` (listed but absent everywhere).
2. After a clone or when files are `missing-locally`: `decrypt --json`.
3. After you or the user changed a secret file: `encrypt --json`, then commit `.zurik` (and `.gitignore` if it changed). Never commit the plaintext files.
4. To protect a new secret file: append a `--- <path>` line to `.zurik`, then `encrypt --json`. zurik adds it to `.gitignore` for you.

## Errors

| `error.code` | What to do |
|---|---|
| `E_NO_PASSWORD` | Ask the user to provide the password via the environment (see above). |
| `E_WRONG_PASSWORD` | Wrong password or tampered `.zurik`. Tell the user; don't retry with guesses, and never use `--rekey` unless the user asks to change the password. |
| `E_WOULD_OVERWRITE` | `error.details.files` have local changes. **Ask the user** before rerunning with `--force`; it discards those changes. If they should be kept, run `encrypt` instead. |
| `E_MISSING_FILES` | `error.details.files` are listed but absent. Usually run `decrypt` first, or remove their sections from `.zurik` if they're obsolete. |
| `E_WEAK_PASSWORD` | Encrypting needs 16+ characters. The user must choose a longer password. |
| `E_NOT_FOUND`, `E_NO_BUNDLE`, `E_EMPTY_LIST` | Nothing to work on at this location; check `--cwd`, or run `init` to set up `.zurik`. |
| `E_OLD_FORMAT` | `.zurik` is from zurik 2.x. Tell the user; migrating needs `npx zurik@2 decrypt` and the password (see the readme). Don't delete `.zurik` yourself. |
| `E_UNSAFE_PATH` | A path in `.zurik` is absolute or outside the project. If you added it, fix it; otherwise treat the file as suspicious and tell the user. |

Exit codes: `0` success, `1` error, `2` usage error.

## Rules

- Don't `cat`, print, summarize or copy decrypted secret files unless the user explicitly asks to see them. Edit them in place when a task requires it.
- Don't use `--force` without the user's go-ahead.
- Don't delete `.zurik`, and don't remove its sections unless asked.
