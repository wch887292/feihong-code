/**
 * 飞虹 Code - 安全存储与通信加密工具
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 三重加密体系支撑模块：
 *  - AES-256-GCM：敏感数据落盘加密（模型 API Key、会话令牌）【存储层】
 *  - RSA-2048：敏感参数端到端加密传输（App 公钥加密 → 服务器私钥解密）【通信层】
 *  - 密钥管理：主密钥优先取环境变量 FH_SECRET，否则首次生成持久化 $FH_HOME/.secret
 *    （RSA 私钥持久化 $FH_HOME/rsa_private.pem，公钥经 API 提供给客户端）
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  generateKeyPairSync,
  publicEncrypt,
  privateDecrypt,
  constants,
} from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

/** 主密钥：优先环境变量 FH_SECRET（>=16 字符），否则首次生成并持久化 $FH_HOME/.secret */
export function getMasterKey(homeDir: string): Buffer {
  const env = process.env.FH_SECRET;
  if (env && env.length >= 16) return createHash('sha256').update(env).digest();
  const file = join(homeDir, '.secret');
  if (existsSync(file)) {
    const hex = readFileSync(file, 'utf8').trim();
    if (hex.length === 64) return Buffer.from(hex, 'hex');
  }
  try {
    mkdirSync(homeDir, { recursive: true });
    const key = randomBytes(32);
    writeFileSync(file, key.toString('hex'), 'utf8');
    return key;
  } catch {
    // 极端情况（目录不可写）：退回进程内随机密钥（重启失效，仅兜底）
    return randomBytes(32);
  }
}

/** AES-256-GCM 加密，输出格式 v1:iv:cipher:tag（全部 base64） */
export function encryptText(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${enc.toString('base64')}:${tag.toString('base64')}`;
}

/** AES-256-GCM 解密；格式错误/密钥错误返回空串（调用方按空处理） */
export function decryptText(payload: string, key: Buffer): string {
  try {
    const parts = String(payload).split(':');
    if (parts.length !== 4 || parts[0] !== 'v1') return '';
    const iv = Buffer.from(parts[1], 'base64');
    const enc = Buffer.from(parts[2], 'base64');
    const tag = Buffer.from(parts[3], 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

/** 是否已是加密格式 */
export function isEncrypted(s: unknown): boolean {
  return typeof s === 'string' && s.startsWith('v1:');
}

/** RSA-2048 密钥对：首次生成并持久化，后续复用；读取到空/无效密钥时自动重建 */
export function getRsaKeys(homeDir: string): { publicKey: string; privateKey: string } {
  const pubFile = join(homeDir, 'rsa_public.pem');
  const prvFile = join(homeDir, 'rsa_private.pem');
  if (existsSync(pubFile) && existsSync(prvFile)) {
    try {
      const pub = readFileSync(pubFile, 'utf8');
      const prv = readFileSync(prvFile, 'utf8');
      // 防御性校验：密钥必须包含 PEM 标记且非空，否则视为损坏，重新生成
      if (pub && pub.includes('BEGIN PUBLIC KEY') && prv && prv.includes('BEGIN PRIVATE KEY')) {
        return { publicKey: pub, privateKey: prv };
      }
    } catch {
      // 读取失败，走重新生成逻辑
    }
  }
  try {
    mkdirSync(homeDir, { recursive: true });
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    writeFileSync(pubFile, publicKey, 'utf8');
    writeFileSync(prvFile, privateKey, 'utf8');
    return { publicKey, privateKey };
  } catch {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return { publicKey, privateKey };
  }
}

/** RSA 公钥加密（OAEP-SHA256），返回 base64 */
export function rsaEncrypt(plain: string, publicKeyPem: string): string {
  return publicEncrypt(
    { key: publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(String(plain), 'utf8'),
  ).toString('base64');
}

/** RSA 私钥解密（OAEP-SHA256）；失败返回空串 */
export function rsaDecrypt(cipherB64: string, privateKeyPem: string): string {
  try {
    return privateDecrypt(
      { key: privateKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(String(cipherB64), 'base64'),
    ).toString('utf8');
  } catch {
    return '';
  }
}
