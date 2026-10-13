import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

@Injectable()
export class CredentialVault {
  encrypt(data: unknown, customKey?: string): string {
    return CredentialVault.encrypt(data, customKey);
  }

  decrypt<T = any>(payload: string, customKey?: string): T {
    return CredentialVault.decrypt<T>(payload, customKey);
  }

  private static getKeyBuffer(secret?: string): Buffer {
    const raw = secret || process.env.ENCRYPTION_KEY || 'crm-vault-master-key-32-chars-!!';
    return crypto.createHash('sha256').update(raw).digest();
  }

  static encrypt(data: unknown, customKey?: string): string {
    const key = this.getKeyBuffer(customKey);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const plaintext = JSON.stringify(data ?? {});
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  static decrypt<T = any>(payload: string, customKey?: string): T {
    if (!payload || typeof payload !== 'string') {
      return {} as T;
    }

    const parts = payload.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted payload format');
    }

    const [ivHex, tagHex, dataHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const encrypted = Buffer.from(dataHex, 'hex');
    const key = this.getKeyBuffer(customKey);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    return JSON.parse(decrypted.toString('utf8'));
  }

  static mask(credentials: Record<string, any>): Record<string, any> {
    if (!credentials || typeof credentials !== 'object') {
      return {};
    }

    const masked: Record<string, any> = {};
    for (const [k, v] of Object.entries(credentials)) {
      if (typeof v === 'string') {
        const lower = k.toLowerCase();
        if (
          lower.includes('pass') ||
          lower.includes('secret') ||
          lower.includes('token') ||
          lower.includes('key')
        ) {
          if (v.length > 8) {
            masked[k] = `••••••••${v.slice(-4)}`;
          } else {
            masked[k] = '••••••••';
          }
        } else {
          masked[k] = v;
        }
      } else {
        masked[k] = v;
      }
    }
    return masked;
  }

  static rotateKey(payload: string, oldKey: string, newKey: string): string {
    const decrypted = this.decrypt(payload, oldKey);
    return this.encrypt(decrypted, newKey);
  }
}
