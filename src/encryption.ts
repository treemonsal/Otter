// Versioned binary envelope: magic/version (8), random salt (16), IV (12), AES-GCM payload.
const MAGIC = new Uint8Array([77, 85, 82, 77, 85, 82, 0, 1]);
const HEADER = 36;
const LIMIT = 512 * 1024 * 1024 + HEADER + 16;
async function key(password: string, salt: Uint8Array<ArrayBuffer>, usage: KeyUsage) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}
export async function isEncryptedBackup(blob: Blob) {
  const bytes = new Uint8Array(await blob.slice(0, MAGIC.length).arrayBuffer());
  return MAGIC.every((byte, i) => bytes[i] === byte);
}
export async function encryptBackup(blob: Blob, password: string) {
  if (password.length < 12) throw new Error('Verwende mindestens 12 Zeichen als Passwort.');
  if (blob.size + HEADER + 16 > LIMIT) throw new Error('Die Sicherung ist zu gross.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = new Uint8Array(HEADER);
  header.set(MAGIC);
  header.set(salt, 8);
  header.set(iv, 24);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: header },
    await key(password, salt, 'encrypt'),
    await blob.arrayBuffer(),
  );
  return new Blob([header, encrypted], { type: 'application/octet-stream' });
}
export async function decryptBackup(blob: Blob, password: string) {
  if (blob.size < HEADER + 16 || blob.size > LIMIT || !(await isEncryptedBackup(blob)))
    throw new Error('Das ist keine gültige verschlüsselte Murmur-Sicherung.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const header = bytes.slice(0, HEADER);
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: header.slice(24), additionalData: header },
      await key(password, header.slice(8, 24), 'decrypt'),
      bytes.slice(HEADER),
    );
    return new File([decrypted], 'Murmur-Sicherung.zip', { type: 'application/zip' });
  } catch {
    throw new Error(
      'Passwort falsch oder Sicherung beschädigt. Vorhandene Gespräche bleiben unverändert.',
    );
  }
}
