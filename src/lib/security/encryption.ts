import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const PREFIX = "v1";

function getKey() {
  const secret = process.env.EMAIL_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("EMAIL_ENCRYPTION_KEY is not set");
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptSecret(value: string) {
  const [prefix, ivBase64, tagBase64, encryptedBase64] = value.split(":");
  if (prefix !== PREFIX || !ivBase64 || !tagBase64 || !encryptedBase64) {
    throw new Error("Encrypted secret has an unsupported format");
  }

  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivBase64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagBase64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
