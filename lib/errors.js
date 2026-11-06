// Stable error codes. Agents and scripts should branch on `code`, not on `message`.
export const ERROR_CODES = {
  E_USAGE: "Invalid command line arguments",
  E_NO_PASSWORD: "No password was provided",
  E_WEAK_PASSWORD: "Password is too short to encrypt with",
  E_WRONG_PASSWORD: "Wrong password, or the bundle was modified (details.path)",
  E_CORRUPT: "The .zurik file is not a valid bundle",
  E_OLD_FORMAT: ".zurik was written by zurik 2.x or earlier; decrypt it with `npx zurik@2 decrypt` and set it up again",
  E_NOT_FOUND: "No .zurik found in this directory or any parent (run `zurik init`)",
  E_EMPTY_LIST: ".zurik lists no files",
  E_NO_BUNDLE: ".zurik is missing",
  E_MISSING_FILES: "Files listed in .zurik (or passed to add) do not exist locally (details.files)",
  E_WOULD_OVERWRITE: "Local files differ from the bundle; rerun with --force (details.files)",
  E_UNSAFE_PATH: "A path is absolute or outside the project (details.path)",
  E_INTERNAL: "Unexpected internal error",
};

export class ZurikError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ZurikError";
    this.code = code;
    this.details = details;
  }
}
