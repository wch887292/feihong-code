/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * Web/HTTP 边界守卫（对标 fullstack-dev skill 铁律 5/6/7）：
 *   1. requestIdMiddleware：每个请求注入唯一 requestId，透传到日志（铁律7 结构化日志）
 *   2. validateBody：zod schema 校验 HTTP 入参，失败即 422 + 字段级错误（铁律6 边界校验）
 *   3. notFoundHandler：/api 未知路径统一 404（铁律5 错误格式一致）
 *   4. globalErrorHandler：全局 typed 错误处理器（铁律5 所有错误可分类、结构化返回）
 *      - AppError（含 ValidationError）→ 返回其 status + code + 结构化 body
 *      - 未知错误 → 记日志 + 通用 500，绝不外泄堆栈/内部信息
 *
 * 设计约束：
 *   - 复用 shared/errors.ts 的 AppError 层级，不另造一套错误类型。
 *   - 复用 shared/logger.ts 的结构化日志（自带 requestId 传播与脱敏）。
 *   - express 类型走本地 ambient shim（src/web/express.d.ts），保持 tsc skipLibCheck 绿灯。
 */
import type { Request, Response, NextFunction, Handler } from 'express';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { AppError, ValidationError, isAppError } from '../shared/errors';
import { logger } from '../shared/logger';

/**
 * 请求 ID 透传：每个请求生成/沿用 X-Request-Id，写入 req.requestId，
 * 并随结构化日志自动带上（logger.emit 已含 runId，这里补 request 维度）。
 * 置于所有路由之前。
 */
export const requestIdMiddleware: Handler = (req: Request, _res: Response, next: NextFunction) => {
  const incoming = req.header('x-request-id');
  const requestId = incoming && incoming.length > 0 ? incoming.slice(0, 128) : randomBytes(8).toString('hex');
  (req as Request & { requestId?: string }).requestId = requestId;
  next();
};

/**
 * zod 入参校验中间件工厂：校验 req.body，失败 → 422 + 字段级错误。
 * 用法：app.post('/api/x', validateBody(schema), handler)
 * 校验通过后将 parse 后的数据写回 req.body（已归一/补默认值），下游拿到的是合法数据。
 */
export function validateBody(schema: z.ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      const fields = result.error.issues.map((i) => ({
        path: i.path.length > 0 ? i.path.join('.') : '(root)',
        message: i.message,
      }));
      res.status(422).json({ ok: false, code: 'VALIDATION_ERROR', fields, error: '输入校验失败' });
      return;
    }
    req.body = result.data;
    next();
  };
}

/** /api 未知路径统一 404（置于所有 /api 路由之后、错误处理器之前） */
export const notFoundHandler: Handler = (req: Request, res: Response) => {
  res.status(404).json({ ok: false, code: 'NOT_FOUND', error: `路径不存在: ${req.path}` });
};

/**
 * 全局 typed 错误处理器（Express 4 错误中间件签名，必须 4 参）。
 * 置于所有路由/守卫之后。
 */
export function globalErrorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) return;
  if (isAppError(err) && err.isOperational) {
    // ValidationError 附带字段级错误，便于前端定位到具体输入项
    const fields = err instanceof ValidationError ? err.fields : undefined;
    logger.warn('http boundary error', { code: err.code, status: err.status, message: err.message });
    res.status(err.status).json({
      ok: false,
      code: err.code,
      error: err.message,
      ...(fields ? { fields } : {}),
    });
    return;
  }
  // 未知/编程错误：记日志（含堆栈），返回通用 500，不外泄内部细节
  const msg = err instanceof Error ? err.message : String(err);
  logger.error('unhandled http error', { error: msg, stack: err instanceof Error ? err.stack : undefined });
  res.status(500).json({ ok: false, code: 'INTERNAL_ERROR', error: '内部错误，请稍后重试' });
}

/** 便捷构造：直接抛 ValidationError（供 handler 内部主动校验用） */
export function assertValid(schema: z.ZodTypeAny, input: unknown): z.output<z.ZodTypeAny> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const fields = r.error.issues.map((i) => ({
      path: i.path.length > 0 ? i.path.join('.') : '(root)',
      message: i.message,
    }));
    throw new ValidationError(fields);
  }
  return r.data;
}

export type { AppError };
