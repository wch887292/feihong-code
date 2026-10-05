/**
 * 全量测试强制离线 + 数据隔离闸口（npm test 经 --import 预加载）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 1) FH_OFFLINE=true：isOfflineByDefault() 中为最高优先级，防止测试遗漏
 *    offline: true 时读取 cwd/.env 的 providers 产生真实外网 LLM 调用
 *    （v8.8.1 实测单用例可拖 200s+）。loadDotEnv 不覆盖已存在的环境变量，
 *    因此本闸口对所有测试文件生效且不可被 .env 翻转。
 *
 * 2) FH_HOME 进程级隔离：node --test 按文件并行 spawn 多个子进程，若共享
 *    同一审计目录（.env 显式设过 FH_HOME 时会指向真实 ~/.feihong-code），
 *    进程 A 的锁释放被宿主 safe-delete shim 拦截后残留，并行进程 B 无法
 *    区分「A 持锁中」与「A 残留锁」（A 活跃且 mtime 被 A 反复刷新），
 *    只能死等到 AUDIT_LOCK_TIMEOUT_MS 超时 → 任务 failed（实测随机挂
 *    routine-runner / task-queue / task-webhook 用例）。每个子进程独立
 *    FH_HOME 从根上消除跨进程锁竞争，同时避免测试污染真实用户数据。
 */
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

process.env.FH_OFFLINE = 'true';
process.env.FH_HOME = join(tmpdir(), `fhcode-test-${process.pid}-${randomUUID().slice(0, 8)}`);
