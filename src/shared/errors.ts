/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 类型化错误层级（铁律：业务错误必须可分类、可结构化返回）
 */

/** 所有可预期错误的基类 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly isOperational = true,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** 配置缺失：启动即失败（fail-fast） */
export class ConfigError extends AppError {
  constructor(key: string) {
    super(`缺少必需环境变量: ${key}`, 'CONFIG_ERROR', 500);
  }
}

/** 模型调用失败 */
export class ModelError extends AppError {
  constructor(
    message: string,
    public readonly provider: string,
    /** 上游 HTTP 状态码（如 429/500/401/400），供路由层按状态码决定轮换/重试策略 */
    public readonly statusCode?: number,
  ) {
    super(`模型调用失败[${provider}]: ${message}`, 'MODEL_ERROR', statusCode ?? 502);
  }
}

/** 工具执行失败 */
export class ToolError extends AppError {
  constructor(tool: string, message: string) {
    super(`工具[${tool}]执行失败: ${message}`, 'TOOL_ERROR', 400);
  }
}

/** 需要人工审批 */
export class ApprovalRequiredError extends AppError {
  constructor(action: string) {
    super(`需人工审批: ${action}`, 'APPROVAL_REQUIRED', 401);
  }
}

/** 安全拦截（危险命令 / 越权） */
export class SecurityError extends AppError {
  constructor(message: string) {
    super(`安全拦截: ${message}`, 'SECURITY_ERROR', 403);
  }
}

/** 类型守卫：判断是否为可预期的业务错误 */
export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
