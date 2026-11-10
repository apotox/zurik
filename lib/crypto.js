import crypto from "crypto";
import { ZurikError } from "./errors.js";

// One key per bundle, derived from the password with the scrypt parameters and salt in the header line:
//   zurik3 scrypt logN=17 r=8 p=1 salt=<base64, 16 bytes>
// Each file is sealed on its own with AES-256-GCM: base64( iv(12) | tag(16) | ciphertext ),
// where the plaintext is mode (2 bytes, big-endian) | content. The header line and the file's path
// are authenticated as additional data, so the KDF parameters can't be weakened and a block can't
// be moved to another path.
const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KDF = { logN: 17, r: 8, p: 1 }; // N = 2^17 ≈ 128 MiB of memory per guess

// Upper bounds so a crafted header can't make decryption allocate gigabytes or spin for minutes.
const MAX_MEM = 256 * 1024 * 1024;
const MAX_P = 4;
const HEADER = /^zurik3 scrypt logN=(\d+) r=(\d+) p=(\d+) salt=([A-Za-z0-9+/]{22}==)$/;

export const HEADER_PREFIX = "zurik3 ";
export const MIN_PASSWORD_LENGTH = 16;

export function newHeader() {
  return `zurik3 scrypt logN=${KDF.logN} r=${KDF.r} p=${KDF.p} salt=${crypto.randomBytes(16).toString("base64")}`;
}

export function deriveKey(header, password) {
  const m = HEADER.exec(header);
  const [logN, r, p] = m ? m.slice(1, 4).map(Number) : [];
  const N = 2 ** logN;
  const mem = 128 * r * (N + 2 + p); // what OpenSSL's scrypt allocates
  if (!m || logN < 1 || r < 1 || p < 1 || p > MAX_P || mem > MAX_MEM) {
    throw new ZurikError("E_CORRUPT", "Corrupted .zurik file: invalid or unsupported header");
  }
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, Buffer.from(m[4], "base64"), 32, { N, r, p, maxmem: MAX_MEM }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

const aad = (header, filePath) => Buffer.from(`${header}\n${filePath}`, "utf8");

export function seal(key, header, filePath, { content, mode }) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  cipher.setAAD(aad(header, filePath));
  const modeBytes = Buffer.alloc(2);
  modeBytes.writeUInt16BE(mode & 0o777);
  const encrypted = Buffer.concat([cipher.update(modeBytes), cipher.update(content), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

export function open(key, header, filePath, data) {
  const buffer = Buffer.from(data, "base64");
  try {
    const decipher = crypto.createDecipheriv(ALGO, key, buffer.subarray(0, IV_LENGTH));
    decipher.setAAD(aad(header, filePath));
    decipher.setAuthTag(buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH));
    const plain = Buffer.concat([decipher.update(buffer.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]);
    return { mode: plain.readUInt16BE(0) & 0o777, content: plain.subarray(2) };
  } catch {
    throw new ZurikError("E_WRONG_PASSWORD", `Cannot decrypt ${filePath}: wrong password or the .zurik file was modified`, {
      path: filePath,
    });
  }
}
