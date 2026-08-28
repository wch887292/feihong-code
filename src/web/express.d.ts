/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 本地 Express 类型占位声明（ambient shim）。
 *
 * 说明：本项目运行期依赖 express 已正常安装（node_modules/express）。
 * 因本地 Windows Defender 实时扫描锁住 node_modules/@types 写入，
 * @types/express 无法在本环境通过 npm 安装（与 FyqyClaw app.asar 同类锁定，非项目 bug）。
 * 这里仅声明本控制台用到的极窄 API 面，使 tsc 在 skipLibCheck 下保持绿灯。
 * 若后续在不受限环境执行 `npm i -D @types/express`，请删除本文件以避免重复声明冲突。
 */
declare module 'express' {
  import { Server } from 'http';

  export interface Request {
    header(name: string): string | undefined;
    headers: Record<string, string | undefined>;
    method?: string;
    url?: string;
    path?: string;
    query: Record<string, string | string[] | undefined>;
    params: Record<string, string>;
    body: unknown;
    // 允许少量动态字段（如自定义属性）
    [key: string]: unknown;
  }

  export interface Response {
    status(code: number): Response;
    json(body: unknown): Response;
    send(body: unknown): Response;
    end(): Response;
    setHeader(name: string, value: string): void;
    [key: string]: unknown;
  }

  export type NextFunction = (err?: unknown) => void;

  export type Handler = (req: Request, res: Response, next: NextFunction) => void;

  export interface Application {
    use(handler: Handler): Application;
    use(path: string, handler: Handler): Application;
    get(path: string, handler: Handler): Application;
    post(path: string, handler: Handler): Application;
    put(path: string, handler: Handler): Application;
    delete(path: string, handler: Handler): Application;
    listen(port: number, callback?: () => void): Server;
    [key: string]: unknown;
  }

  export interface ExpressFactory {
    (): Application;
    json(options?: unknown): Handler;
    static(root: string, options?: unknown): Handler;
    [key: string]: unknown;
  }

  const express: ExpressFactory;
  export default express;
}
