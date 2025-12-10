import crypto from "crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 16;

function deriveKey(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 32, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function encryptData(data, password) {
  const salt = crypto.randomBytes(16);
  const key = await deriveKey(password, salt);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);

  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([salt, iv, tag, encrypted]).toString("base64");
}

export async function decryptData(base64, password) {
  const buffer = Buffer.from(base64, "base64");
  const salt = buffer.subarray(0, 16);
  const iv = buffer.subarray(16, 32);
  const tag = buffer.subarray(32, 48);
  const ciphertext = buffer.subarray(48);

  const key = await deriveKey(password, salt);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
