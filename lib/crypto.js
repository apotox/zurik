import crypto from "crypto";

const ALGO = "aes-256-gcm";
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;

// Current format: "zurik2:" + base64( logN | r | p | salt(16) | iv(12) | tag(16) | ciphertext )
// The KDF params are authenticated as GCM additional data, so they can't be altered.
const V2_PREFIX = "zurik2:";
const V2_IV_LENGTH = 12;
const KDF = { logN: 17, r: 8, p: 1 }; // N = 2^17 ≈ 128 MiB of memory per guess

// Upper bounds so a crafted file can't make decryption allocate gigabytes.
const MAX_KDF = { logN: 20, r: 16, p: 4 };

export const MIN_PASSWORD_LENGTH = 16;

function deriveKey(password, salt, { logN, r, p }) {
  const N = 2 ** logN;
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 32, { N, r, p, maxmem: 2 * 128 * N * r + 1024 * 1024 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function encryptData(data, password) {
  const params = Buffer.from([KDF.logN, KDF.r, KDF.p]);
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(V2_IV_LENGTH);
  const key = await deriveKey(password, salt, KDF);

  const cipher = crypto.createCipheriv(ALGO, key, iv);
  cipher.setAAD(params);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();

  return V2_PREFIX + Buffer.concat([params, salt, iv, tag, encrypted]).toString("base64");
}

export async function decryptData(text, password) {
  text = text.trim();
  return text.startsWith(V2_PREFIX)
    ? decryptV2(text.slice(V2_PREFIX.length), password)
    : decryptV1(text, password);
}

async function decryptV2(base64, password) {
  const buffer = Buffer.from(base64, "base64");
  const headerLength = 3 + SALT_LENGTH + V2_IV_LENGTH + TAG_LENGTH;
  if (buffer.length < headerLength) {
    throw new Error("Corrupted .zurik file");
  }

  const params = buffer.subarray(0, 3);
  const kdf = { logN: params[0], r: params[1], p: params[2] };
  if (
    kdf.logN < 1 || kdf.logN > MAX_KDF.logN ||
    kdf.r < 1 || kdf.r > MAX_KDF.r ||
    kdf.p < 1 || kdf.p > MAX_KDF.p
  ) {
    throw new Error("Corrupted .zurik file: unsupported key derivation parameters");
  }

  let offset = 3;
  const salt = buffer.subarray(offset, (offset += SALT_LENGTH));
  const iv = buffer.subarray(offset, (offset += V2_IV_LENGTH));
  const tag = buffer.subarray(offset, (offset += TAG_LENGTH));
  const ciphertext = buffer.subarray(offset);

  const key = await deriveKey(password, salt, kdf);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAAD(params);
  decipher.setAuthTag(tag);
  return finish(decipher, ciphertext);
}

// Legacy format (zurik <= 1.0.5): base64( salt(16) | iv(16) | tag(16) | ciphertext ), default scrypt params.
async function decryptV1(base64, password) {
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length < 48) {
    throw new Error("Corrupted .zurik file");
  }
  const salt = buffer.subarray(0, 16);
  const iv = buffer.subarray(16, 32);
  const tag = buffer.subarray(32, 48);
  const ciphertext = buffer.subarray(48);

  const key = await deriveKey(password, salt, { logN: 14, r: 8, p: 1 });
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return finish(decipher, ciphertext);
}

function finish(decipher, ciphertext) {
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("Decryption failed: wrong password or corrupted .zurik file");
  }
}
