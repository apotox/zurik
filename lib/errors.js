// Stable error codes. Agents and scripts should branch on `code`, not on `message`.
export const ERROR_CODES = {
  E_USAGE: "Invalid command line arguments",
  E_NO_PASSWORD: "No password was provided",
  E_WEAK_PASSWORD: "Password is too short to encrypt with",
  E_WRONG_PASSWORD: "Wrong password, or the bundle was modified",
  E_CORRUPT: "The .zurik file is not a valid bundle",
  E_NOT_FOUND: "No .gitencrypt / .zurik found in this directory or any parent",
  E_NO_LIST: ".gitencrypt is missing",
  E_EMPTY_LIST: ".gitencrypt lists no files",
  E_NO_BUNDLE: ".zurik is missing",
  E_MISSING_FILES: "Files listed in .gitencrypt do not exist (details.files)",
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
