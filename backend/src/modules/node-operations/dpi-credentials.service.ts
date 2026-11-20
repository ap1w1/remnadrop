import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '@common/database/prisma.service';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** AES-256-GCM encryption at rest; decryption material lives only in server env. */
@Injectable()
export class DpiCredentialsService {
  constructor(private readonly db: PrismaService) {}

  private encryptionKey(): Buffer {
    const secret = process.env.DPICHECKER_ENCRYPTION_KEY ?? process.env.APP_SECRET ?? process.env.JWT_AUTH_SECRET;
    if (!secret || secret.length < 32 || secret === 'change_me') {
      throw new ServiceUnavailableException('Configure stable DPICHECKER_ENCRYPTION_KEY (min. 32 characters)');
    }
    return createHash('sha256').update('remnadrop-dpichecker-v1\0').update(secret).digest();
  }

  async getKey(): Promise<string> {
    const rows = await this.db.$queryRaw<{iv:Uint8Array;tag:Uint8Array;ciphertext:Uint8Array}[]>`
      SELECT iv,tag,ciphertext FROM dpi_checker_credentials WHERE id=1`;
    if (rows.length) {
      try {
        const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), Buffer.from(rows[0].iv));
        decipher.setAuthTag(Buffer.from(rows[0].tag));
        return Buffer.concat([decipher.update(Buffer.from(rows[0].ciphertext)), decipher.final()]).toString('utf8');
      } catch {
        throw new ServiceUnavailableException('Cannot decrypt DPI Checker key; verify server encryption secret');
      }
    }
    const fallback = process.env.DPICHECKER_API_KEY;
    if (!fallback) throw new ServiceUnavailableException('DPI Checker API key is not configured');
    return fallback;
  }

  async status(): Promise<{configured:boolean;source:'stored'|'environment'|'none';updatedAt:Date|null}> {
    const rows=await this.db.$queryRaw<{updated_at:Date}[]>`SELECT updated_at FROM dpi_checker_credentials WHERE id=1`;
    if (rows.length) return {configured:true,source:'stored',updatedAt:rows[0].updated_at};
    return {configured:!!process.env.DPICHECKER_API_KEY,source:process.env.DPICHECKER_API_KEY?'environment':'none',updatedAt:null};
  }

  async setKey(key:string, probe:(key:string)=>Promise<unknown>) {
    const trimmed=typeof key==='string'?key.trim():'';
    if (trimmed.length<12 || trimmed.length>512 || /[\s\x00-\x1f]/.test(trimmed)) throw new BadRequestException('Invalid API key');
    // Validate credentials with upstream before writing anything.
    await probe(trimmed);
    const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',this.encryptionKey(),iv);
    const ciphertext=Buffer.concat([cipher.update(trimmed,'utf8'),cipher.final()]);
    const tag=cipher.getAuthTag();
    await this.db.$executeRaw`INSERT INTO dpi_checker_credentials(id,iv,tag,ciphertext)
      VALUES(1,${iv},${tag},${ciphertext}) ON CONFLICT(id) DO UPDATE SET
      iv=EXCLUDED.iv,tag=EXCLUDED.tag,ciphertext=EXCLUDED.ciphertext,updated_at=now()`;
    return {response:await this.status()};
  }

  async clear() {
    await this.db.$executeRaw`DELETE FROM dpi_checker_credentials WHERE id=1`;
    return {response:await this.status()};
  }
}
