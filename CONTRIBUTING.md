# Contributing to zurik

Thanks for helping out. Bug reports, fixes and docs improvements are all welcome.

## Reporting a security issue

zurik protects secrets, so **do not open a public issue for a vulnerability**. Report it privately through GitHub's [private vulnerability reporting](https://github.com/apotox/zurik/security/advisories/new) instead.

## Reporting a bug

Open an [issue](https://github.com/apotox/zurik/issues) with:

- your zurik version (`npx zurik --version`), Node.js version and OS
- the command you ran and its output (`--json` output is ideal)
- what you expected to happen

Never paste real secrets, passwords or `.zurik` bundles from a real project.

## Making a change

zurik has no runtime dependencies and needs Node.js 18 or newer.

```sh
git clone https://github.com/apotox/zurik.git
cd zurik
npm ci
npm test
```

- Code lives in `lib/`, the CLI entry point in `bin/zurik.js`, and tests in `test/zurik.test.js` (Node's built-in test runner).
- Add or update a test for any behaviour you change.
- Keep it dependency-free; open an issue first if you think a dependency is needed.
- Changes to the CLI output, error codes or `--json` shapes are part of the public interface: update `readme.md`, the `help --json` spec and `skills/zurik/SKILL.md` to match.
- Changes to the `.zurik` format or key derivation are breaking changes and need a major version and migration notes in `readme.md`.

CI runs the tests on Linux, macOS and Windows with Node 18, 20 and 22, so a pull request must pass on all of them.

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Make your change with tests, and run `npm test`.
3. Open a pull request describing what changed and why.

## Releases

Maintainers release by bumping the version (`npm version <patch|minor|major>`) and pushing the tag (`git push --follow-tags`). The `v*.*.*` tag triggers the publish workflow, which publishes to npm with provenance.

## Code of Conduct

By taking part in this project you agree to follow its [Code of Conduct](CODE_OF_CONDUCT.md).
