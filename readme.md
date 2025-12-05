# zurik

A Node.js CLI tool for encrypting and decrypting sensitive project files.
It collects file paths from `.gitencrypt`, bundles them into a single `.zurik` file, and decrypts them when needed.

## Features

- Encrypt multiple files into a **single** `.zurik` bundle
- AES-256-GCM authenticated encryption
- Automatically append sensitive files to `.gitignore` when encrypting.

## Installation

You can run it directly using `npx`:

```sh
export ZURIK_PASSWORD="your-secret"
npx zurik -e

# or install it globally
npm install -g zurik

# also you can pass the password as an argument
npx zurik -e -p "your-password"
```
