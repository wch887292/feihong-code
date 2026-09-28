/**
 * 飞虹 Code - 管理器路由域（B3-a 拆分自 web/server.ts）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 包含区块（原 771-974 / 1089-1611）：
 * - 三端同步状态（手机 / Web / 桌面共享）
 * - P3: 多文件变更管理（暂存/审批/原子提交）
 * - P1-2: MCP 协议管理 API
 * - P2-2: Git 集成 API
 * - P2-3: 团队协作 API
 * - P3-2: SOLO 全自主编程 API
 * - 阶段二-1：多智能体协同 API
 * - 阶段二-2：事件驱动 Agent API
 * - 阶段二-3：自定义 Agent API
 *
 * 共享闭包经 ManagerRoutesDeps 显式注入；serverWorkspaceDir 为可变绑定，
 * 以 getter 注入保活。本模块不得反向 import web/server。
 */
import express, { type Request, type Response } from 'express';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { ChangeManager } from '../../agent/change-manager';
import { GitIntegration } from '../../agent/git-integration';
import { TeamCollaborationManager } from '../../agent/team-collaboration';
import { EventDrivenAgentManager } from '../../agent/event-driven-agent';
import { CustomAgentManager } from '../../agent/custom-agent';
import { SoloAgent, type SoloConfig, type SoloReport } from '../../agent/solo-agent';
import { runMultiAgent, type MultiAgentConfig } from '../../agent/multi-agent';
import { connectMcp, type McpServerConfig } from '../../tools/mcp/mcp-client';
import { resolveHomeDir, loadConfig } from '../../shared/config';
import type { ModelRouter } from '../../models/model-router';

type ExpressApp = ReturnType<typeof express>;

export interface ManagerRoutesDeps {
  changeManager: ChangeManager;
  gitIntegration: GitIntegration;
  teamManager: TeamCollaborationManager;
  eventDrivenManager: EventDrivenAgentManager;
  customAgentManager: CustomAgentManager;
  soloTasks: Map<string, { agent: SoloAgent; report?: SoloReport; status: 'running' | 'completed' | 'failed' }>;
  getServerWorkspaceDir: () => string;
  assertPathAllowed: (target: string, res: Response) => boolean;
  /** 共享模型路由器（可变绑定，getter 保活；未配置模型时为 null） */
  getSharedModelRouter: () => ModelRouter | null;
}

export function registerManagerRoutes(app: ExpressApp, deps: ManagerRoutesDeps): void {
  const { changeManager, gitIntegration, teamManager, eventDrivenManager, customAgentManager, soloTasks, assertPathAllowed } = deps;
  /* ========== 三端同步状态（手机 / Web / 桌面共享：执行端 + 当前项目） ========== */
  const syncStateFile = join(resolveHomeDir(), '.feihong-code', 'sync-state.json');
  const readSyncState = (): Record<string, any> => {
    try { return JSON.parse(readFileSync(syncStateFile, 'utf-8')); } catch { return {}; }
  };
  const writeSyncState = (patch: Record<string, any>): void => {
    try {
      mkdirSync(dirname(syncStateFile), { recursive: true });
      const next = { ...readSyncState(), ...patch, updatedAt: new Date().toISOString() };
      writeFileSync(syncStateFile, JSON.stringify(next, null, 2), 'utf-8');
    } catch (e) {
      console.warn('[sync] 保存三端同步状态失败: ' + (e as Error).message);
    }
  };
  app.get('/api/sync', (_req: Request, res: Response) => {
    res.json({ ok: true, ...readSyncState() });
  });
  app.post('/api/sync', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const clean: Record<string, any> = {};
    if (typeof body?.execEnd === 'string' && ['phone', 'direct', 'cloud'].includes(body.execEnd)) clean.execEnd = body.execEnd;
    if (typeof body?.project === 'string') clean.project = body.project.slice(0, 2000);
    if (typeof body?.deviceId === 'string') clean.deviceId = body.deviceId.slice(0, 200);
    if (Object.keys(clean).length) writeSyncState(clean);
    res.json({ ok: true, ...readSyncState() });
  });

  app.post('/api/files/read', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const file = typeof body?.path === 'string' ? body.path.trim() : '';
    if (!file || !assertPathAllowed(file, res)) return;
    try {
      const st = statSync(file);
      if (!st.isFile()) {
        res.status(400).json({ ok: false, error: '不是文件' });
        return;
      }
      if (st.size > 2 * 1024 * 1024) {
        res.status(400).json({ ok: false, error: '文件超过 2MB，建议用本地编辑器打开' });
        return;
      }
      const content = readFileSync(file, 'utf8');
      res.json({ ok: true, path: file, content });
    } catch (e) {
      res.status(500).json({ ok: false, error: '读取失败: ' + (e as Error).message });
    }
  });

  /* ========== P3: 多文件变更管理（暂存/审批/原子提交） ========== */

  // 暂存变更（AI 生成的文件内容先暂存，不直接写入）
  app.post('/api/changes/stage', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const path = typeof body?.path === 'string' ? body.path.trim() : '';
    const content = typeof body?.content === 'string' ? body.content : '';
    if (!path) { res.status(400).json({ ok: false, error: '缺少 path 字段' }); return; }
    const change = changeManager.stageChange(path, content);
    if (!change) { res.status(400).json({ ok: false, error: '内容未变化或暂存区已满' }); return; }
    res.json({ ok: true, change: { path: change.path, type: change.type, additions: change.additions, deletions: change.deletions, status: change.status, hunks: change.hunks } });
  });

  // 获取所有暂存变更（变更面板数据）
  app.get('/api/changes', (_req: Request, res: Response) => {
    res.json({ ok: true, ...changeManager.toPanelData() });
  });

  // 接受整个文件的变更
  app.post('/api/changes/accept', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const path = typeof body?.path === 'string' ? body.path.trim() : '';
    if (!path) { res.status(400).json({ ok: false, error: '缺少 path 字段' }); return; }
    const ok = changeManager.acceptFile(path);
    res.json({ ok, ...(ok ? {} : { error: '文件不存在' }) });
  });

  // 拒绝整个文件的变更
  app.post('/api/changes/reject', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const path = typeof body?.path === 'string' ? body.path.trim() : '';
    if (!path) { res.status(400).json({ ok: false, error: '缺少 path 字段' }); return; }
    const ok = changeManager.rejectFile(path);
    res.json({ ok, ...(ok ? {} : { error: '文件不存在' }) });
  });

  // 接受单个 Hunk
  app.post('/api/changes/hunk/accept', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const path = typeof body?.path === 'string' ? body.path.trim() : '';
    const hunkIndex = typeof body?.hunkIndex === 'number' ? body.hunkIndex : -1;
    if (!path || hunkIndex < 0) { res.status(400).json({ ok: false, error: '缺少 path 或 hunkIndex' }); return; }
    const ok = changeManager.acceptHunk(path, hunkIndex);
    res.json({ ok, ...(ok ? {} : { error: '文件或 Hunk 不存在' }) });
  });

  // 拒绝单个 Hunk
  app.post('/api/changes/hunk/reject', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const path = typeof body?.path === 'string' ? body.path.trim() : '';
    const hunkIndex = typeof body?.hunkIndex === 'number' ? body.hunkIndex : -1;
    if (!path || hunkIndex < 0) { res.status(400).json({ ok: false, error: '缺少 path 或 hunkIndex' }); return; }
    const ok = changeManager.rejectHunk(path, hunkIndex);
    res.json({ ok, ...(ok ? {} : { error: '文件或 Hunk 不存在' }) });
  });

  // 原子化提交（写入所有已接受的变更，失败自动回滚）
  app.post('/api/changes/commit', (_req: Request, res: Response) => {
    const result = changeManager.commit();
    res.json({ ok: result.success, ...result });
  });

  // 丢弃所有暂存变更
  app.post('/api/changes/discard', (_req: Request, res: Response) => {
    changeManager.discardAll();
    res.json({ ok: true });
  });

  // 检测冲突
  app.post('/api/changes/detect-conflicts', (_req: Request, res: Response) => {
    const conflicts = changeManager.detectConflicts();
    res.json({ ok: true, conflicts });
  });

  /* ========== P1-2: MCP 协议管理 API ========== */
  // 获取当前 MCP 服务器配置
  app.get('/api/mcp/config', (_req: Request, res: Response) => {
    try {
      const cfg = loadConfig();
      const servers = (cfg.mcp?.servers ?? []).map((s: McpServerConfig) => ({
        name: s.name,
        command: s.command,
        args: s.args ?? [],
        env: s.env ? Object.keys(s.env) : [], // 只暴露环境变量名，不暴露值
      }));
      res.json({ ok: true, servers, count: servers.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: `读取配置失败: ${e instanceof Error ? e.message : String(e)}` });
    }
  });

  // 测试指定 MCP 服务器连接（临时连接，列出工具后关闭）
  app.post('/api/mcp/test', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) { res.status(400).json({ ok: false, error: '缺少 name 字段' }); return; }

    try {
      const cfg = loadConfig();
      const serverCfg = (cfg.mcp?.servers ?? []).find((s: McpServerConfig) => s.name === name);
      if (!serverCfg) {
        res.status(404).json({ ok: false, error: `未找到 MCP 服务器: ${name}` });
        return;
      }

      const startTime = Date.now();
      const client = await connectMcp(serverCfg);
      const tools = await client.listTools();
      const latencyMs = Date.now() - startTime;
      await client.close().catch(() => undefined);

      res.json({
        ok: true,
        name,
        connected: true,
        latencyMs,
        toolCount: tools.length,
        tools: tools.map((t: { name: string; description?: string }) => ({
          name: t.name,
          description: (t.description || '').slice(0, 100),
        })),
      });
    } catch (e) {
      res.json({
        ok: false,
        name,
        connected: false,
        error: `连接失败: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  });

  // 列出所有 MCP 服务器的工具（逐个连接测试，返回汇总）
  app.get('/api/mcp/tools', async (_req: Request, res: Response) => {
    try {
      const cfg = loadConfig();
      const servers = cfg.mcp?.servers ?? [];
      const results: Array<{ name: string; ok: boolean; toolCount: number; error?: string }> = [];

      for (const s of servers) {
        try {
          const client = await connectMcp(s);
          const tools = await client.listTools();
          await client.close().catch(() => undefined);
          results.push({ name: s.name, ok: true, toolCount: tools.length });
        } catch (e) {
          results.push({ name: s.name, ok: false, toolCount: 0, error: e instanceof Error ? e.message : String(e) });
        }
      }

      res.json({ ok: true, servers: results, totalServers: servers.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: `获取 MCP 工具失败: ${e instanceof Error ? e.message : String(e)}` });
    }
  });

  /* ========== P2-2: Git 集成 API ========== */
  // 获取 Git 状态
  app.get('/api/git/status', async (_req: Request, res: Response) => {
    try {
      const status = await gitIntegration.status();
      res.json({ ok: true, ...status });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // 获取文件 diff
  app.post('/api/git/diff', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const path = typeof body?.path === 'string' ? body.path : undefined;
    const staged = body?.staged === true;
    try {
      const diffs = await gitIntegration.diff(path, staged);
      res.json({ ok: true, diffs });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // 暂存文件
  app.post('/api/git/add', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const paths = Array.isArray(body?.paths) ? body.paths.filter((p: unknown) => typeof p === 'string') : [];
    if (!paths.length) { res.status(400).json({ ok: false, error: '缺少 paths 字段' }); return; }
    try {
      const result = await gitIntegration.add(paths);
      res.json({ ok: result.success, message: result.message });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // 取消暂存
  app.post('/api/git/reset', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const paths = Array.isArray(body?.paths) ? body.paths.filter((p: unknown) => typeof p === 'string') : [];
    if (!paths.length) { res.status(400).json({ ok: false, error: '缺少 paths 字段' }); return; }
    try {
      const result = await gitIntegration.reset(paths);
      res.json({ ok: result.success, message: result.message });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // 提交
  app.post('/api/git/commit', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    const paths = Array.isArray(body?.paths) ? body.paths.filter((p: unknown) => typeof p === 'string') : undefined;
    if (!message) { res.status(400).json({ ok: false, error: '提交信息不能为空' }); return; }
    try {
      const result = await gitIntegration.commit(message, paths);
      res.json({ ok: result.success, hash: result.hash, message: result.message });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // 获取分支列表
  app.get('/api/git/branches', async (_req: Request, res: Response) => {
    try {
      const branches = await gitIntegration.branches();
      res.json({ ok: true, branches });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // 切换分支
  app.post('/api/git/checkout', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const branch = typeof body?.branch === 'string' ? body.branch.trim() : '';
    const createNew = body?.createNew === true;
    if (!branch) { res.status(400).json({ ok: false, error: '缺少 branch 字段' }); return; }
    try {
      const result = await gitIntegration.checkout(branch, createNew);
      res.json({ ok: result.success, message: result.message });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // 获取提交历史
  app.get('/api/git/log', async (req: Request, res: Response) => {
    const count = typeof req.query?.count === 'string' ? parseInt(req.query.count) : 20;
    try {
      const commits = await gitIntegration.log(Math.min(Math.max(count, 1), 100));
      res.json({ ok: true, commits });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // 推送
  app.post('/api/git/push', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const remote = typeof body?.remote === 'string' ? body.remote : 'origin';
    const branch = typeof body?.branch === 'string' ? body.branch : undefined;
    const force = body?.force === true;
    try {
      const result = await gitIntegration.push(remote, branch, force);
      res.json({ ok: result.success, message: result.message });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // 拉取
  app.post('/api/git/pull', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const remote = typeof body?.remote === 'string' ? body.remote : 'origin';
    const branch = typeof body?.branch === 'string' ? body.branch : undefined;
    try {
      const result = await gitIntegration.pull(remote, branch);
      res.json({ ok: result.success, message: result.message });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // 初始化仓库
  app.post('/api/git/init', async (_req: Request, res: Response) => {
    try {
      const result = await gitIntegration.init();
      res.json({ ok: result.success, message: result.message });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  /* ========== P2-3: 团队协作 API ========== */
  app.get('/api/team', (_req: Request, res: Response) => {
    try {
      const team = teamManager.getTeam();
      const stats = teamManager.getStats();
      res.json({ ok: true, team, stats });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  app.put('/api/team/config', (req: Request, res: Response) => {
    try {
      const config = teamManager.updateConfig(req.body || {});
      res.json({ ok: true, config });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  app.get('/api/team/members', (_req: Request, res: Response) => {
    try { res.json({ ok: true, members: teamManager.getMembers() }); }
    catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  app.post('/api/team/members/invite', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const role = body?.role || 'developer';
    if (!name || !email) { res.status(400).json({ ok: false, error: '缺少 name 或 email' }); return; }
    try {
      const member = teamManager.inviteMember(name, email, role);
      res.json({ ok: true, member });
    } catch (e) { res.status(400).json({ ok: false, error: (e as Error).message }); }
  });

  app.put('/api/team/members/:id/role', (req: Request, res: Response) => {
    try {
      const role = ((req.body ?? {}) as Record<string, any>).role;
      const member = teamManager.updateMemberRole(req.params.id, role);
      res.json({ ok: true, member });
    } catch (e) { res.status(400).json({ ok: false, error: (e as Error).message }); }
  });

  app.delete('/api/team/members/:id', (req: Request, res: Response) => {
    try { teamManager.removeMember(req.params.id); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ ok: false, error: (e as Error).message }); }
  });

  app.get('/api/team/tasks', (req: Request, res: Response) => {
    try {
      const status = typeof req.query?.status === 'string' ? req.query.status as any : undefined;
      res.json({ ok: true, tasks: teamManager.getTasks(status) });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  app.post('/api/team/tasks', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (!title) { res.status(400).json({ ok: false, error: '缺少 title' }); return; }
    try {
      const task = teamManager.createTask(title, body.createdBy || 'system', body);
      res.json({ ok: true, task });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  app.put('/api/team/tasks/:id', (req: Request, res: Response) => {
    try { res.json({ ok: true, task: teamManager.updateTask(req.params.id, req.body || {}) }); }
    catch (e) { res.status(400).json({ ok: false, error: (e as Error).message }); }
  });

  app.delete('/api/team/tasks/:id', (req: Request, res: Response) => {
    try { teamManager.deleteTask(req.params.id); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ ok: false, error: (e as Error).message }); }
  });

  app.post('/api/team/tasks/:id/comments', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const content = typeof body?.content === 'string' ? body.content.trim() : '';
    if (!content) { res.status(400).json({ ok: false, error: '缺少 content' }); return; }
    try {
      const task = teamManager.addComment(req.params.id, body.author || 'anonymous', content);
      res.json({ ok: true, task });
    } catch (e) { res.status(400).json({ ok: false, error: (e as Error).message }); }
  });

  app.get('/api/team/stats', (_req: Request, res: Response) => {
    try { res.json({ ok: true, stats: teamManager.getStats() }); }
    catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  /* ========== P3-2: SOLO 全自主编程 API ========== */
  // 启动 SOLO 任务
  app.post('/api/solo/run', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const goal = typeof body?.goal === 'string' ? body.goal.trim() : '';
    if (!goal) { res.status(400).json({ ok: false, error: '缺少 goal' }); return; }

    const taskId = `solo-${Date.now()}`;
    const config: SoloConfig = {
      cwd: deps.getServerWorkspaceDir(),
      goal,
      maxTasks: body.maxTasks || 8,
      maxRetries: body.maxRetries || 3,
      parallel: body.parallel || false,
      maxParallel: body.maxParallel || 2,
      planOnly: body.planOnly || false,
      verifyOnly: body.verifyOnly || false,
      autoCorrect: body.autoCorrect !== false,
    };

    // 创建子任务执行器（简化版，实际应委托给 orchestrator）
    const executor = async (focusedGoal: string) => {
      try {
        // 简化执行：返回成功，实际应调用 orchestrator
        return { ok: true, output: `已执行: ${focusedGoal}`, touchedFiles: [], iterations: 1 };
      } catch (e) {
        return { ok: false, output: (e as Error).message, touchedFiles: [], iterations: 0 };
      }
    };

    const agent = new SoloAgent(config, executor);
    soloTasks.set(taskId, { agent, status: 'running' });

    // 异步执行
    (async () => {
      try {
        const report = await agent.run();
        const task = soloTasks.get(taskId);
        if (task) {
          task.report = report;
          task.status = report.overall === 'failed' ? 'failed' : 'completed';
        }
      } catch (e) {
        const task = soloTasks.get(taskId);
        if (task) {
          task.status = 'failed';
          task.report = {
            goal, cwd: deps.getServerWorkspaceDir(), overall: 'failed', phase: 'failed',
            startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
            totalTasks: 0, completedTasks: 0, failedTasks: 0, skippedTasks: 0,
            tasks: [], summary: `执行失败: ${(e as Error).message}`, events: [],
          };
        }
      }
    })();

    res.json({ ok: true, taskId, message: 'SOLO 任务已启动' });
  });

  // 获取 SOLO 任务状态
  app.get('/api/solo/status/:id', (req: Request, res: Response) => {
    const task = soloTasks.get(req.params.id);
    if (!task) { res.status(404).json({ ok: false, error: '任务不存在' }); return; }
    const status = task.agent.getStatus();
    res.json({ ok: true, taskId: req.params.id, status: task.status, ...status });
  });

  // 获取 SOLO 任务报告
  app.get('/api/solo/report/:id', (req: Request, res: Response) => {
    const task = soloTasks.get(req.params.id);
    if (!task) { res.status(404).json({ ok: false, error: '任务不存在' }); return; }
    if (!task.report) { res.status(202).json({ ok: false, error: '任务尚未完成', status: task.status }); return; }
    res.json({ ok: true, report: task.report });
  });

  // 取消 SOLO 任务
  app.post('/api/solo/cancel/:id', (req: Request, res: Response) => {
    const task = soloTasks.get(req.params.id);
    if (!task) { res.status(404).json({ ok: false, error: '任务不存在' }); return; }
    if (task.status === 'running') {
      task.status = 'failed';
      res.json({ ok: true, message: '任务已取消' });
    } else {
      res.json({ ok: false, error: '任务已结束，无法取消' });
    }
  });

  // 列出所有 SOLO 任务
  app.get('/api/solo/list', (_req: Request, res: Response) => {
    const tasks = Array.from(soloTasks.entries()).map(([id, task]) => ({
      id,
      status: task.status,
      goal: task.report?.goal || '',
      startedAt: task.report?.startedAt,
      completedAt: task.report?.completedAt,
    }));
    res.json({ ok: true, tasks });
  });

  /* ========== 阶段二-1：多智能体协同 API ========== */
  // 运行多智能体协同（架构师/开发/测试/评审）
  app.post('/api/multi-agent/run', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const goal = typeof body?.goal === 'string' ? body.goal.trim() : '';
    if (!goal) { res.status(400).json({ ok: false, error: '缺少 goal' }); return; }
    const sharedRouter = deps.getSharedModelRouter();
    if (!sharedRouter) { res.status(500).json({ ok: false, error: '模型未配置' }); return; }

    const config: MultiAgentConfig = {
      roles: body.roles || ['architect', 'developer', 'tester', 'reviewer'],
      maxRounds: body.maxRounds || 3,
      enableReviewLoop: body.enableReviewLoop !== false,
    };

    try {
      const result = await runMultiAgent(sharedRouter, goal, config, body.context);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: '多智能体协同失败: ' + (e as Error).message });
    }
  });

  // 获取角色配置
  app.get('/api/multi-agent/roles', (_req: Request, res: Response) => {
    try {
      import('../../agent/multi-agent').then(({ AGENT_ROLES }) => {
        const roles = Object.values(AGENT_ROLES).map((r) => ({
          role: r.role,
          name: r.name,
          description: r.description,
          capabilities: r.capabilities,
        }));
        res.json({ ok: true, roles });
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  /* ========== 阶段二-2：事件驱动 Agent API ========== */
  // 获取事件驱动配置
  app.get('/api/event-driven/config', (_req: Request, res: Response) => {
    try { res.json({ ok: true, config: eventDrivenManager.getConfig() }); }
    catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  // 获取事件历史
  app.get('/api/event-driven/events', (req: Request, res: Response) => {
    try {
      const limit = typeof req.query?.limit === 'string' ? parseInt(req.query.limit, 10) : 50;
      res.json({ ok: true, events: eventDrivenManager.getEvents(limit) });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  // 手动触发事件
  app.post('/api/event-driven/trigger', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    if (!body.type || !body.title) { res.status(400).json({ ok: false, error: '缺少 type 或 title' }); return; }
    eventDrivenManager.triggerEvent({
      type: body.type,
      severity: body.severity || 'info',
      title: body.title,
      description: body.description || '',
      source: body.source || 'manual',
      payload: body.payload,
    }).then((event) => res.json({ ok: true, event }))
      .catch((e) => res.status(500).json({ ok: false, error: (e as Error).message }));
  });

  // Cron 任务 CRUD
  app.get('/api/event-driven/cron', (_req: Request, res: Response) => {
    try {
      const cfg = eventDrivenManager.getConfig() as { cronTasks?: unknown[] };
      res.json({ ok: true, cronTasks: cfg.cronTasks ?? [] });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });
  app.post('/api/event-driven/cron', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    if (!body.name || !body.cron || !body.task) { res.status(400).json({ ok: false, error: '缺少 name/cron/task' }); return; }
    try {
      const task = eventDrivenManager.addCronTask({
        name: body.name,
        cron: body.cron,
        task: body.task,
        enabled: body.enabled !== false,
        debounceMs: body.debounceMs || 0,
      } as any);
      res.json({ ok: true, task });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  app.put('/api/event-driven/cron/:id', (req: Request, res: Response) => {
    try {
      const task = eventDrivenManager.updateCronTask(req.params.id, (req.body ?? {}) as any);
      if (!task) { res.status(404).json({ ok: false, error: '任务不存在' }); return; }
      res.json({ ok: true, task });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  app.delete('/api/event-driven/cron/:id', (req: Request, res: Response) => {
    try {
      const ok = eventDrivenManager.removeCronTask(req.params.id);
      res.json({ ok, message: ok ? '已删除' : '任务不存在' });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  // Webhook 接收
  app.post('/api/event-driven/webhook/:path', (req: Request, res: Response) => {
    const path = `/webhook/${req.params.path}`;
    eventDrivenManager.handleWebhook(path, (req.body || {}) as Record<string, unknown>, req.headers as Record<string, string>)
      .then((result) => res.json(result))
      .catch((e) => res.status(500).json({ ok: false, error: (e as Error).message }));
  });

  /* ========== 阶段二-3：自定义 Agent API ========== */
  // 获取所有自定义 Agent
  app.get('/api/custom-agents', (req: Request, res: Response) => {
    try {
      const category = typeof req.query?.category === 'string' ? req.query.category : undefined;
      res.json({ ok: true, agents: customAgentManager.getAllAgents(category) });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  // 获取 Agent 分类
  app.get('/api/custom-agents/categories', (_req: Request, res: Response) => {
    try { res.json({ ok: true, categories: customAgentManager.getCategories() }); }
    catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  // 匹配推荐 Agent
  app.post('/api/custom-agents/match', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const input = typeof body?.input === 'string' ? body.input : '';
    if (!input) { res.status(400).json({ ok: false, error: '缺少 input' }); return; }
    try {
      const limit = typeof body?.limit === 'number' ? body.limit : 3;
      res.json({ ok: true, agents: customAgentManager.matchAgents(input, limit) });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  // 获取单个 Agent
  app.get('/api/custom-agents/:id', (req: Request, res: Response) => {
    try {
      const agent = customAgentManager.getAgent(req.params.id);
      if (!agent) { res.status(404).json({ ok: false, error: 'Agent 不存在' }); return; }
      res.json({ ok: true, agent });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  // 创建自定义 Agent
  app.post('/api/custom-agents', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    if (!body.name || !body.systemPrompt) { res.status(400).json({ ok: false, error: '缺少 name 或 systemPrompt' }); return; }
    try {
      const agent = customAgentManager.createAgent({
        name: body.name,
        description: body.description || '',
        systemPrompt: body.systemPrompt,
        tools: body.tools || [],
        modelConfig: body.modelConfig || { temperature: 0.3, maxTokens: 2000, timeoutMs: 30000 },
        triggers: body.triggers || [],
        icon: body.icon || '🤖',
        category: body.category || 'custom',
        enabled: body.enabled !== false,
        author: body.author,
        version: body.version || '1.0.0',
      });
      res.json({ ok: true, agent });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  // 更新自定义 Agent
  app.put('/api/custom-agents/:id', (req: Request, res: Response) => {
    try {
      const agent = customAgentManager.updateAgent(req.params.id, (req.body ?? {}) as any);
      if (!agent) { res.status(404).json({ ok: false, error: 'Agent 不存在' }); return; }
      res.json({ ok: true, agent });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  // 删除自定义 Agent
  app.delete('/api/custom-agents/:id', (req: Request, res: Response) => {
    try {
      const ok = customAgentManager.deleteAgent(req.params.id);
      res.json({ ok, message: ok ? '已删除' : 'Agent 不存在或为内置 Agent' });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  // 执行自定义 Agent
  app.post('/api/custom-agents/:id/execute', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const input = typeof body?.input === 'string' ? body.input : '';
    if (!input) { res.status(400).json({ ok: false, error: '缺少 input' }); return; }
    const sharedRouter2 = deps.getSharedModelRouter();
    if (!sharedRouter2) { res.status(500).json({ ok: false, error: '模型未配置' }); return; }
    try {
      const result = await customAgentManager.executeAgent(req.params.id, input, sharedRouter2, body?.context);
      res.json({ ok: result.success, ...result });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

}
