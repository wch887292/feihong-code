/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P-7 自建商城 · 路由（支付 + 自动发码闭环）
 * ----------------------------------------------------------------
 * 公开接口（security 已豁免 HMAC 签名，无 Bearer 即可访问）：
 *   GET  /api/shop/tiers                  档位配置（前端展示）
 *   POST /api/shop/orders                 创建订单 → 返回 orderNo
 *   GET  /api/shop/orders/:no             买家自助查单（含激活码）
 *   POST /api/shop/pay/mock/:no           模拟支付成功（SHOP_PAY_MODE=mock 启用）
 *   POST /api/shop/wechat/notify          微信支付 V3 回调（SHOP_PAY_MODE=wechat 启用，骨架）
 *
 * 运营接口（需 Bearer FH_WEB_TOKEN）：
 *   GET  /api/shop/admin/orders           订单列表
 *   GET  /api/shop/admin/stats            收入统计
 */

import express, { type Request, type Response } from 'express';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { join } from 'path';
import { getShopDB, TIERS, serializeOrder, type ShopOrder } from '../shop-db';
import { generateLicenseKey } from '../../license';
import { requireToken, type SessionStore } from '../auth';

/** Express 应用类型（与 routes/cloud-bridge.ts 保持一致） */
type ExpressApp = ReturnType<typeof express>;

/** 支付模式：mock（沙箱，默认）/ wechat（真实微信支付 V3） */
const PAY_MODE = (process.env.SHOP_PAY_MODE || 'mock').toLowerCase();
/**
 * 演示支付开关（F3 修复）：
 *  - 默认关闭（false）。生产必须显式设置 SHOP_ALLOW_MOCK=1 才允许 mock 支付，否则 fail-closed 拒发激活码。
 *  - 生产环境使用微信支付（SHOP_PAY_MODE=wechat）时，mock 支付本就不启用，此项无效。
 */
const MOCK_ALLOWED = process.env.SHOP_ALLOW_MOCK === '1';

export function registerShopRoutes(app: ExpressApp, deps: { token: string; sessions: SessionStore }): void {
  const shop = getShopDB();
  const authMw = requireToken(deps.token, deps.sessions);

  /** 档位配置（公开） */
  app.get('/api/shop/tiers', (_req: Request, res: Response) => {
    res.json({ ok: true, tiers: Object.values(TIERS), payMode: PAY_MODE, mockAllowed: MOCK_ALLOWED });
  });

  /** 创建订单（公开）；body: { tier, contact, contactType? } */
  app.post('/api/shop/orders', (req: Request, res: Response) => {
    const body = (req.body || {}) as { tier?: unknown; contact?: unknown; contactType?: unknown };
    const tier = String(body.tier ?? '').toLowerCase();
    const contact = String(body.contact ?? '').trim();
    const contactType = String(body.contactType ?? (contact.includes('@') ? 'email' : 'phone')).trim();
    if (!TIERS[tier]) return res.status(400).json({ ok: false, error: '档位不存在' });
    if (!contact) return res.status(400).json({ ok: false, error: '请填写联系方式（手机或邮箱）' });
    try {
      const order = shop.createOrder({ tier, contact, contactType });
      const payUrl = PAY_MODE === 'mock' ? `/api/shop/pay/mock/${order.order_no}` : null;
      res.json({ ok: true, order: serializeOrder(order), payUrl });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /**
   * 买家自助查单（公开）：返回订单状态，但**绝不返回激活码明文**（F3 修复）。
   * 激活码需经 /api/shop/deliver 按联系方式校验后交付。
   */
  app.get('/api/shop/orders/:no', (req: Request, res: Response) => {
    const order = shop.getOrder(String(req.params.no));
    if (!order) return res.status(404).json({ ok: false, error: '订单不存在' });
    const safe = serializeOrder(order);
    safe.licenseKey = null; // 公开接口不裸返激活码
    res.json({ ok: true, order: safe });
  });

  /**
   * 激活码交付（公开，需验证联系方式）：仅当 query.contact 与下单时一致才返回激活码。
   * 避免任何知道订单号的人直接拿走激活码（F3 修复）。
   */
  app.get('/api/shop/deliver/:no', (req: Request, res: Response) => {
    const order = shop.getOrder(String(req.params.no));
    if (!order) return res.status(404).json({ ok: false, error: '订单不存在' });
    if (order.status !== 'paid') return res.status(409).json({ ok: false, error: '订单尚未支付' });
    const contact = String((req.query.contact as string) || '').trim().toLowerCase();
    const stored = String(order.contact || '').trim().toLowerCase();
    if (!contact || contact !== stored) {
      return res.status(403).json({ ok: false, error: '联系方式校验失败' });
    }
    res.json({ ok: true, licenseKey: order.license_key, tier: order.tier });
  });

  /**
   * 模拟支付成功（沙箱）
   * 真实支付时，此步骤由微信支付回调 /api/shop/wechat/notify 中的同一套发码逻辑完成。
   */
  app.post('/api/shop/pay/mock/:no', (req: Request, res: Response) => {
    if (PAY_MODE !== 'mock' || !MOCK_ALLOWED) {
      return res.status(403).json({ ok: false, error: '演示支付未开启，请使用真实支付通道' });
    }
    const orderNo = String(req.params.no);
    const order = shop.getOrder(orderNo);
    if (!order) return res.status(404).json({ ok: false, error: '订单不存在' });
    if (order.status === 'paid') return res.json({ ok: true, order: serializeOrder(order), message: '订单已支付' });
    try {
      const key = issueLicense(order);
      const updated = shop.markPaid(orderNo, key, JSON.stringify({ mode: 'mock', at: Date.now() }));
      res.json({ ok: true, order: serializeOrder(updated!), message: '模拟支付成功，激活码已生成' });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /**
   * 微信支付 V3 回调（骨架）
   * SHOP_PAY_MODE=wechat 时启用。完整实现待微信商户凭据就绪：
   *   1) 用平台证书验签回调头 Wechatpay-Signature
   *   2) 用 APIv3 密钥解密 resource.ciphertext 得到明文（含 out_trade_no / trade_state）
   *   3) trade_state=SUCCESS 时：查单 → 若未发码则 issueLicense → markPaid
   *   4) 返回 { code: 'SUCCESS', message: 'OK' }（微信要求）
   */
  app.post('/api/shop/wechat/notify', (_req: Request, res: Response) => {
    if (PAY_MODE !== 'wechat') {
      return res.status(403).json({ code: 'FAIL', message: '未启用微信支付' });
    }
    // TODO: 验签 + 解密 + 发码（商户凭据就绪后补全）
    console.warn('[shop] 微信支付回调收到，但真实处理逻辑尚未实现（需配置商户凭据）');
    res.json({ code: 'SUCCESS', message: 'OK' });
  });

  /** 运营：订单列表（Bearer） */
  app.get('/api/shop/admin/orders', (req: Request, res: Response) => {
    authMw(req, res, () => {
      res.json({ ok: true, orders: shop.listOrders(200).map(serializeOrder) });
    });
  });

  /** 运营：收入统计（Bearer） */
  app.get('/api/shop/admin/stats', (req: Request, res: Response) => {
    authMw(req, res, () => {
      res.json({ ok: true, stats: shop.stats() });
    });
  });
}

/**
 * 发码：调用核心授权模块 generateLicenseKey。
 * 商城是开发商自营服务端，只需配置 FH_LICENSE_SECRET 即可发码（无需客户侧 FH_LICENSE_MASTER 门禁）。
 *
 * 密钥一致性（重要）：
 *  - generateLicenseKey 默认用 secret() 回落（FH_LICENSE_SECRET 环境变量 > FH_HOME/license-secret 文件 > 内置占位）。
 *  - 客户端 `fhcode activate` 同样使用 secret() 默认回落。
 *  - 为让买家在本地 fhcode「零配置」激活成功，云端发码密钥必须与客户端激活密钥一致：
 *      演示/当前开源版 → 两端都未配置，统一回落内置占位 secret，闭环可跑通；
 *      生产安全版   → 需在云端配置 FH_LICENSE_SECRET，并配套客户端密钥安全下发机制（超出 P-7 范围）。
 */
function issueLicense(order: ShopOrder): string {
  const cfg = TIERS[order.tier];
  if (!cfg) throw new Error('订单档位无效: ' + order.tier);
  // F3 修复：演示支付仅当显式开启时可用；生产（wechat 模式或 mock 未授权）一律 fail-closed 拒发，杜绝免费拿激活码。
  if (PAY_MODE === 'mock' && !MOCK_ALLOWED) {
    throw new Error('演示支付未授权，无法发码（生产环境请使用真实支付通道）');
  }
  const issuedTo = (order.contact || 'customer').slice(0, 64);
  // F1 修复：使用 Ed25519 私钥签名（FH_LICENSE_SIGN_PRIVATE_KEY 生产 / FH_LICENSE_DEV 本地自测）。
  const signKey = process.env.FH_LICENSE_SIGN_PRIVATE_KEY?.trim() || undefined;
  if (!signKey && process.env.FH_LICENSE_DEV !== '1') {
    console.warn('[shop] 警告：未配置 FH_LICENSE_SIGN_PRIVATE_KEY，将回退开发签名（仅本地自测有效，生产请配置真私钥）。');
  }
  return generateLicenseKey({
    type: order.tier as 'standard' | 'pro' | 'enterprise',
    issuedTo,
    days: cfg.days,
    seats: cfg.seats,
    privateKey: signKey,
  });
}

/** 仅用于本地自检：判断开发商主密钥文件是否存在（默认不需要，FH_LICENSE_SECRET 即可） */
export function hasDevMasterKey(): boolean {
  const home = process.env.FH_HOME || join(homedir(), '.feihong-code');
  return existsSync(join(home, 'license-master'));
}
