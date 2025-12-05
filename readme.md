# zurich

A Node.js CLI tool for encrypting and decrypting sensitive project files.  
It collects file paths from `.gitencrypt`, bundles them into a single `.encrypted` file, and decrypts them when needed.

## Features

- Encrypt multiple files into a **single** `.encrypted` bundle
- AES-256-GCM authenticated encryption
- Automatically append sensitive files to `.gitignore` when encrypting.

## Installation

You can run it directly using `npx`:

```sh
export ZURICH_PASSWORD="your-secret"
npx zurich -e

# or install it globally
npm install -g zurich

# also you can pass the password as an argument
npx zurich -e -p "your-password"
```
