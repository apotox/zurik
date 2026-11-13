# Security policy

zurik encrypts a project's secret files into one committed `.zurik` bundle (AES-256-GCM, a scrypt-derived key) and restores them. Vulnerabilities in this package are treated as seriously as vulnerabilities in the secrets it protects.

## Supported versions

| Version | Security fixes |
|---|---|
| 3.x | yes |
| 2.x and earlier | no (they also use the old bundle format) |

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting**: on https://github.com/apotox/zurich, go to Security &rarr; Report a vulnerability. Please don't open a public issue for anything security-relevant.

You'll get an acknowledgement within a few days and a fix or a mitigation plan for the next release. A fix that changes the bundle format (making an existing `.zurik` unreadable) ships with a migration path, like the 2.x &rarr; 3.x one in the readme.

## What belongs here

- Anything that lets someone decrypt `.zurik` without the password, or tamper with it without detection (`lib/crypto.js`, `lib/bundle.js`)
- A crafted `.zurik` that crashes zurik, burns unbounded CPU or memory, or makes it write outside the project (`lib/paths.js`, `lib/bundle.js`)
- The CLI, the `--json` interface or the library printing secrets or password material to stdout, stderr, logs or error messages
- The agent docs (`skills/zurik/SKILL.md`) teaching agents to mishandle the password or decrypted files

## What does not

- Offline guessing of a weak or leaked password. zurik deliberately makes each guess expensive, but the security model is a strong password (see "Choosing a password" in the readme); if the password leaks, the files are exposed.
- Problems that require access to the machine holding the plaintext files or running `decrypt`.
