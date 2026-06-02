import crypto from 'crypto';
import os from 'os';
// Generate a stable machine-specific key
function getMachineKey() {
    const salt = 'vudu-dm-stealth-salt-2026';
    // Safe userInfo lookup fallback for platform robustness
    let username = 'default';
    try {
        username = os.userInfo().username;
    }
    catch {
        username = process.env.USERNAME || process.env.USER || 'default';
    }
    const machineInfo = [
        os.hostname(),
        username,
        os.platform(),
        os.arch(),
        salt
    ].join('-');
    return crypto.createHash('sha256').update(machineInfo).digest();
}
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
export function encryptString(text) {
    const key = getMachineKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    // Format: iv:authTag:ciphertext
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}
export function decryptString(encryptedText) {
    const key = getMachineKey();
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted format');
    }
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const ciphertext = parts[2];
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
//# sourceMappingURL=crypto.js.map