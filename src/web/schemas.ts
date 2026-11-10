/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P2 Web/HTTP 边界入参 zod schema（对标 fullstack-dev skill 铁律6：所有输入在边界处校验）。
 *
 * 设计约束（向后兼容）：
 *   - 全部 .passthrough()：只校验「声明的字段」，未声明的额外字段原样保留写回 req.body，
 *     不破坏既有 handler 对 body.permissions / body.attachments 等的读取。
 *   - 缺省字段用 optional，保持旧调用（字段缺省）仍合法。
 *   - 必填字段用 .min(1)：缺字段(zod 报 expected string)或空串(min 不过)均 422；
 *     handler 内部既有检查保留为兜底，双保险不改变成功路径行为。
 *   - 兼容 zod v4：不使用 v3 的 { required_error } 选项对象。
 */
import { z } from 'zod';

/** POST /api/tasks：goal 必填；agentType 限枚举；其余可选并 passthrough */
export const taskBodySchema = z
  .object({
    goal: z.string().min(1, '缺少 goal 字段'),
    agentType: z.enum(['general', 'fix-code', 'write-code', 'exec-command']).optional(),
    workspaceDir: z.string().optional(),
    modelId: z.string().optional(),
    mode: z.enum(['interactive', 'autonomous']).optional(),
  })
  .passthrough();

/** POST /api/tasks/:id/messages：message 必填 */
export const taskMessageBodySchema = z
  .object({
    message: z.string().min(1, '缺少 message 字段'),
  })
  .passthrough();

/** POST /api/webhook：url 必填字符串（格式/公网白名单仍由 handler 的 assertPublicHttpUrl 二次把关） */
export const webhookBodySchema = z
  .object({
    url: z.string().min(1, '缺少 url 字段'),
  })
  .passthrough();

/** POST /api/memory/short：title + content 必填，type 限枚举（缺省 note） */
export const memoryShortBodySchema = z
  .object({
    type: z.enum(['task', 'fix', 'feature', 'error', 'note']).optional(),
    title: z.string().min(1, '缺少 title 字段'),
    content: z.string().min(1, '缺少 content 字段'),
  })
  .passthrough();

/** POST /api/memory/long/append：title + content 必填，category 可选 */
export const memoryAppendBodySchema = z
  .object({
    category: z.string().optional(),
    title: z.string().min(1, '缺少 title 字段'),
    content: z.string().min(1, '缺少 content 字段'),
  })
  .passthrough();

/** POST /api/honcho/remember：content 必填，importance 数值可选 */
export const honchoRememberBodySchema = z
  .object({
    content: z.string().min(1, 'content required'),
    importance: z.number().optional(),
  })
  .passthrough();
