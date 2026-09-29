/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P-7 自建商城 · 订单数据库（独立 shop.db）
 * ----------------------------------------------------------------
 * 设计原则：零侵入核心 SQLiteStore，独立 $FH_HOME/shop.db（node:sqlite, WAL）。
 * 订单号规则：FH + yyMMddHHmmss + 4 位随机（与商业闭环策划一致）。
 * 金额一律以「分」(cents) 存储，符合支付行业规范。
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

/** 档位配置（锁定价，见《商业闭环交付策划》4.3 节，2026-09-29 已锁定） */
export interface TierConfig {
  tier: 'standard' | 'pro' | 'enterprise';
  name: string;
  priceCents: number; // 价格（分）；对外展示 = priceCents/100
  days: number; // 授权有效期（天）
  seats: number; // 授权设备数（0 = 不限）
  tagline: string;
  features: string[];
}

export const TIERS: Record<string, TierConfig> = {
  standard: {
    tier: 'standard',
    name: '标准版',
    priceCents: 39900,
    days: 365,
    seats: 1,
    tagline: '个人 / 小微工具化',
    features: ['1 台设备激活', '60 天试用转正式', '基础文档', '工单 48h 响应'],
  },
  pro: {
    tier: 'pro',
    name: '专业版',
    priceCents: 199900,
    days: 365,
    seats: 5,
    tagline: '小团队 / 技术服务商',
    features: ['≤ 5 台设备', '云电脑托管额度', '优先支持', '工单 24h + 月度回访'],
  },
  enterprise: {
    tier: 'enterprise',
    name: '企业版',
    priceCents: 999900,
    days: 365,
    seats: 0,
    tagline: '企业私有化',
    features: ['不限席位 / 定制', '完全私有化部署', '商业支持 + 定制模块', '专属群 + 4h 故障介入'],
  },
};

export type OrderStatus = 'pending' | 'paid' | 'cancelled' | 'refunded';

export interface ShopOrder {
  order_no: string;
  tier: string;
  amount_cents: number;
  currency: string;
  contact: string | null;
  contact_type: string | null;
  status: OrderStatus;
  license_key: string | null;
  created_at: number; // unix 秒
  paid_at: number | null;
  expire_at: number | null;
  raw: string | null; // 支付通道原始回执（JSON）
}

function resolveShopDbPath(): string {
  const home = process.env.FH_HOME || join(process.env.HOME || process.env.USERPROFILE || '.', '.feihong-code');
  return join(home, 'shop.db');
}

class ShopDB {
  private db: DatabaseSync;

  constructor() {
    const dbPath = resolveShopDbPath();
    const sep = /[\\/]/.exec(dbPath)?.[0] || '/';
    const dir = dbPath.substring(0, dbPath.lastIndexOf(sep));
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS shop_orders (
        order_no     TEXT PRIMARY KEY,
        tier         TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency     TEXT NOT NULL DEFAULT 'CNY',
        contact      TEXT,
        contact_type TEXT,
        status       TEXT NOT NULL DEFAULT 'pending',
        license_key  TEXT,
        created_at   INTEGER NOT NULL,
        paid_at      INTEGER,
        expire_at    INTEGER,
        raw          TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_shop_orders_status ON shop_orders(status);
      CREATE INDEX IF NOT EXISTS idx_shop_orders_created ON shop_orders(created_at);
    `);
  }

  /** 生成订单号：FH + 年月日时分秒(12位) + 4 位随机大写十六进制 */
  genOrderNo(): string {
    const d = new Date();
    const p = (n: number, l = 2) => String(n).padStart(l, '0');
    const ts = `${p(d.getFullYear() % 100)}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    const rnd = randomBytes(2).toString('hex').toUpperCase().slice(0, 4);
    return `FH${ts}${rnd}`;
  }

  createOrder(input: { tier: string; contact?: string; contactType?: string }): ShopOrder {
    const cfg = TIERS[input.tier];
    if (!cfg) throw new Error('未知档位: ' + input.tier);
    const orderNo = this.genOrderNo();
    const now = Math.floor(Date.now() / 1000);
    const expireAt = now + cfg.days * 86400;
    this.db
      .prepare(
        `INSERT INTO shop_orders(order_no, tier, amount_cents, currency, contact, contact_type, status, created_at, expire_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(orderNo, input.tier, cfg.priceCents, 'CNY', input.contact ?? null, input.contactType ?? null, 'pending', now, expireAt);
    return this.getOrder(orderNo)!;
  }

  getOrder(orderNo: string): ShopOrder | undefined {
    return this.db.prepare('SELECT * FROM shop_orders WHERE order_no = ?').get(orderNo) as ShopOrder | undefined;
  }

  markPaid(orderNo: string, licenseKey: string, raw?: string): ShopOrder | undefined {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare('UPDATE shop_orders SET status = ?, paid_at = ?, license_key = ?, raw = ? WHERE order_no = ?')
      .run('paid', now, licenseKey, raw ?? null, orderNo);
    return this.getOrder(orderNo);
  }

  cancelOrder(orderNo: string): ShopOrder | undefined {
    this.db.prepare("UPDATE shop_orders SET status = 'cancelled' WHERE order_no = ? AND status = 'pending'").run(orderNo);
    return this.getOrder(orderNo);
  }

  listOrders(limit = 200): ShopOrder[] {
    return this.db.prepare('SELECT * FROM shop_orders ORDER BY created_at DESC LIMIT ?').all(limit) as unknown as ShopOrder[];
  }

  stats(): { total: number; paid: number; pending: number; revenueCents: number } {
    const row = (sql: string) => (this.db.prepare(sql).get() as { c: number }).c;
    return {
      total: row('SELECT COUNT(*) c FROM shop_orders'),
      paid: row("SELECT COUNT(*) c FROM shop_orders WHERE status = 'paid'"),
      pending: row("SELECT COUNT(*) c FROM shop_orders WHERE status = 'pending'"),
      revenueCents: row("SELECT COALESCE(SUM(amount_cents), 0) c FROM shop_orders WHERE status = 'paid'"),
    };
  }
}

let instance: ShopDB | null = null;

export function getShopDB(): ShopDB {
  if (!instance) instance = new ShopDB();
  return instance;
}

/** 序列化为前端安全结构（避免暴露内部字段命名约定） */
export function serializeOrder(o: ShopOrder) {
  return {
    orderNo: o.order_no,
    tier: o.tier,
    amountCents: o.amount_cents,
    currency: o.currency,
    contact: o.contact,
    contactType: o.contact_type,
    status: o.status,
    licenseKey: o.license_key,
    createdAt: o.created_at,
    paidAt: o.paid_at,
    expireAt: o.expire_at,
  };
}
