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

# or you can type the password interactively
npx zurik -e -p
```

## Usage
### Encrypt files
- create *.gitencrypt* file in the root of your project
- add paths to files you want to encrypt, one per line
- for example:
```txt
# .gitencrypt
src/config.json
src/secret.txt
```
- run the command below
```sh
npx zurik -e -p "your-password"
```
- the encrypted files will be saved in `.zurik` file
- it will also add the encrypted files to `.gitignore` if they are not already ignored

### Decrypt files
- run the command below to decrypt the files
```sh
npx zurik -d -p "your-password"
```
- the decrypted files will be saved in the same directory as the original files
