---
name: zurik
description: Encrypt, decrypt and check project secrets (.env files, keys, config) that are stored in a .zurik bundle and listed in .gitencrypt. Use whenever a repo contains .zurik or .gitencrypt, when secret files are missing after a clone, when the user asks to encrypt/commit/share/restore secrets, or before editing or committing a file listed in .gitencrypt. Prefer it over reading, copying, printing or hand-encrypting secret files.
---

# zurik

zurik keeps a project's secret files encrypted in one committed file, `.zurik`. The plaintext files are listed in `.gitencrypt` and are git-ignored. zurik never prints file contents, so you can manage secrets without them entering your context.

Run it with `npx zurik` (or `zurik` if it's installed). Always pass `--json` and branch on `ok` / `error.code`, never on message text.

## Commands

| Goal | Command |
|---|---|
| See what's out of sync (safe, read-only) | `npx zurik status --json` |
| Restore secrets after a clone | `npx zurik decrypt --json` |
| Save changes to secret files into `.zurik` | `npx zurik encrypt --json` |
| Preview without writing anything | add `--dry-run` |
| Machine-readable spec of all options and codes | `npx zurik help --json` |

`--cwd <dir>` runs against another directory. zurik uses the nearest parent directory containing `.gitencrypt` / `.zurik`.

## Password: never put it in your context

- Do **not** ask the user to paste the password into the chat. Do **not** use `-p <password>` or `--password <value>`: that puts it in the transcript, the shell history and the process list.
- Use what the environment already provides, in this order: `$ZURIK_PASSWORD`, `$ZURIK_PASSWORD_FILE`, or `--password-file <path>` / `--password-stdin` piped from a secret manager the user names (e.g. `op read ... | npx zurik decrypt --password-stdin --json`).
- On `E_NO_PASSWORD`, stop and tell the user to set `ZURIK_PASSWORD` (or `ZURIK_PASSWORD_FILE`) in the environment the agent runs in. Don't guess or generate one for an existing bundle.
- zurik never prompts when stdin isn't a terminal or when `--json` is set, so it won't hang.

## Workflow

1. `status --json` first. States: `in-sync`, `modified` (local differs from bundle), `missing-locally` (run decrypt), `not-in-bundle` (run encrypt), `missing` (listed but absent everywhere). `listed: false` means it's in the bundle but was removed from `.gitencrypt`.
2. After a clone or when files are `missing-locally`: `decrypt --json`.
3. After you or the user changed a secret file: `encrypt --json`, then commit `.zurik` (and `.gitencrypt` / `.gitignore` if they changed). Never commit the plaintext files.
4. To protect a new secret file: append its path to `.gitencrypt`, then `encrypt --json`. zurik adds it to `.gitignore` for you.

## Errors

| `error.code` | What to do |
|---|---|
| `E_NO_PASSWORD` | Ask the user to provide the password via the environment (see above). |
| `E_WRONG_PASSWORD` | Wrong password or tampered bundle. Tell the user; don't retry with guesses. |
| `E_WOULD_OVERWRITE` | `error.details.files` have local changes. **Ask the user** before rerunning with `--force`; it discards those changes. If they should be kept, run `encrypt` instead. |
| `E_MISSING_FILES` | `error.details.files` are listed but absent. Usually run `decrypt` first, or remove them from `.gitencrypt` if they're obsolete. |
| `E_WEAK_PASSWORD` | Encrypting needs 16+ characters. The user must choose a longer password. |
| `E_NOT_FOUND`, `E_NO_LIST`, `E_NO_BUNDLE`, `E_EMPTY_LIST` | Nothing to work on at this location; check `--cwd` or set up `.gitencrypt`. |
| `E_UNSAFE_PATH` | A path is absolute or outside the project. Fix `.gitencrypt`; for a bundle, treat it as suspicious and tell the user. |

Exit codes: `0` success, `1` error, `2` usage error.

## Rules

- Don't `cat`, print, summarize or copy decrypted secret files unless the user explicitly asks to see them. Edit them in place when a task requires it.
- Don't use `--force` without the user's go-ahead.
- Don't delete `.zurik`, and don't remove entries from `.gitencrypt` unless asked.
