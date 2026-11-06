# zurik

A Node.js CLI tool for encrypting and decrypting sensitive project files.
It collects file paths from `.gitencrypt`, bundles them into a single `.zurik` file, and decrypts them when needed.

## Features

- Encrypt multiple files into a **single** `.zurik` bundle
- AES-256-GCM authenticated encryption with a scrypt-derived key
- Automatically appends sensitive files to `.gitignore` when encrypting
- Preserves file permissions; never overwrites changed local files without `--force`

## Installation

Requires Node.js 18 or newer. Run it directly with `npx`, or install it globally:

```sh
npx zurik -h
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
# 1. interactive prompt (nothing ends up in shell history or the process list)
npx zurik -e -p

# 2. environment variable, e.g. in CI
export ZURIK_PASSWORD="your-secret"
npx zurik -e

# 3. piped from a password manager or secret store
pass show my-project/zurik | npx zurik -d -p

# 4. inline (avoid: visible in `ps` and saved in shell history)
npx zurik -e -p "your-password"
```

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
   npx zurik -e -p
   ```

The files are encrypted into `.zurik`, and any that are not already listed in `.gitignore` are appended to it. Commit `.zurik` and `.gitencrypt`.

Every listed file must exist. If any is missing, nothing is written, so an existing `.zurik` is never overwritten with a partial bundle. On a fresh clone, run `zurik -d` first.

### Decrypt files

```sh
npx zurik -d -p
```

Files are restored to their original paths with their original permissions. If a local file has changed since it was encrypted, zurik lists the affected files and stops; pass `--force` to overwrite them.

You can run zurik from any subdirectory: it uses the nearest parent directory containing `.gitencrypt` (encrypt) or `.zurik` (decrypt).

## Bundle format

`.zurik` is a text file: `zurik2:` followed by base64 of `logN | r | p | salt (16) | iv (12) | tag (16) | ciphertext`. The scrypt parameters are authenticated as AES-GCM additional data, so they cannot be altered to weaken the key.

Bundles written by zurik 1.0.5 and earlier (no `zurik2:` prefix) still decrypt, including those with passwords shorter than 16 characters. The next `zurik -e` rewrites them in the new format, and at that point the password must meet the minimum length.

## Development

```sh
npm test
```
