import crypto from "crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 16;

function deriveKey(password) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, "zurik_fixed_salt", 32, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function encryptData(data, password) {
  const key = await deriveKey(password);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);

  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export async function decryptData(base64, password) {
  const buffer = Buffer.from(base64, "base64");

  const iv = buffer.subarray(0, 16);
  const tag = buffer.subarray(16, 32);
  const ciphertext = buffer.subarray(32);

  const key = await deriveKey(password);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);
}
