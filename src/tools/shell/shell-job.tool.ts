/**
 * 飞虹 Code · 后台长任务管理工具
 *
 * 与 run_shell(background:true) 配合使用：
 * - status:  查询任务运行状态
 * - logs:    获取最新日志（stdout + stderr）
 * - stop:    停止后台任务（杀进程树）
 * - list:    列出所有后台任务（默认只列 running）
 */
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../tool.interface';
import { processManager } from './process-manager';

export const shellJobTool: Tool = {
  name: 'shell_job',
  description: '管理 run_shell 后台启动的长任务（dev server / watch / 服务进程）：查询状态、获取日志、停止进程、列出所有任务',
  jsonSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'logs', 'stop', 'list'],
        description: '操作类型：status=查询状态，logs=获取日志，stop=停止任务，list=列出所有任务',
      },
      job_id: { type: 'string', description: 'run_shell(background:true) 返回的 job_id（status/logs/stop 必填，list 不需要）' },
      max_lines: { type: 'number', description: 'logs 专用：返回最近多少行日志，默认 200，最大 2000' },
      all: { type: 'boolean', description: 'list 专用：true=列出全部（含已结束），false=只列运行中（默认）' },
    },
    required: ['action'],
  },
  schema: z.object({
    action: z.enum(['status', 'logs', 'stop', 'list']),
    job_id: z.string().min(1).optional(),
    max_lines: z.number().int().min(1).max(2000).optional(),
    all: z.boolean().optional(),
  }),
  async execute(args, _ctx: ToolContext): Promise<ToolResult> {
    const { action, job_id, max_lines, all } = args as {
      action: 'status' | 'logs' | 'stop' | 'list';
      job_id?: string;
      max_lines?: number;
      all?: boolean;
    };

    if (action === 'list') {
      const jobs = processManager.list(all ?? false);
      if (jobs.length === 0) {
        return { ok: true, output: all ? '没有任何后台任务记录' : '当前没有运行中的后台任务' };
      }
      const lines = jobs.map((j) => {
        const dur = j.endedAt
          ? `${Math.round((new Date(j.endedAt).getTime() - new Date(j.startedAt).getTime()) / 1000)}s`
          : `${Math.round((Date.now() - new Date(j.startedAt).getTime()) / 1000)}s+`;
        return `[${j.status.padEnd(7)}] ${j.jobId} pid=${String(j.pid ?? '-').padEnd(6)} ${dur.padEnd(6)} | ${j.command.slice(0, 80)}`;
      });
      return { ok: true, output: `共 ${jobs.length} 个任务${all ? '（含已结束）' : '（运行中）'}：\n${lines.join('\n')}` };
    }

    // status / logs / stop 都需要 job_id
    if (!job_id) {
      return { ok: false, output: '', error: `${action} 需要 job_id 参数` };
    }

    if (action === 'status') {
      const job = processManager.status(job_id);
      if (!job) return { ok: false, output: '', error: `任务不存在: ${job_id}` };
      const dur = job.endedAt
        ? `${Math.round((new Date(job.endedAt).getTime() - new Date(job.startedAt).getTime()) / 1000)}s`
        : `${Math.round((Date.now() - new Date(job.startedAt).getTime()) / 1000)}s（仍在运行）`;
      return {
        ok: true,
        output: [
          `job_id: ${job.jobId}`,
          `状态: ${job.status}`,
          `pid: ${job.pid ?? '-'}`,
          `命令: ${job.command}`,
          `工作目录: ${job.cwd}`,
          `启动时间: ${job.startedAt}`,
          `结束时间: ${job.endedAt ?? '-'}`,
          `运行时长: ${dur}`,
          `exit code: ${job.exitCode ?? '-'}`,
          `stdout 累计: ${job.stdoutBytes} 字节（尾部 ${job.stdoutTail.length} 行）`,
          `stderr 累计: ${job.stderrBytes} 字节（尾部 ${job.stderrTail.length} 行）`,
        ].join('\n'),
      };
    }

    if (action === 'logs') {
      const result = processManager.logs(job_id, max_lines ?? 200);
      if (!result) return { ok: false, output: '', error: `任务不存在: ${job_id}` };
      const job = processManager.status(job_id)!;
      const header = `=== ${job.jobId} | ${job.status} | pid=${job.pid ?? '-'} | stdout=${job.stdoutBytes}B stderr=${job.stderrBytes}B ===`;
      return { ok: true, output: `${header}\n${result.combined || '(无输出)'}` };
    }

    if (action === 'stop') {
      const result = processManager.stop(job_id);
      return { ok: result.ok, output: result.ok ? result.message : '', error: result.ok ? undefined : result.message };
    }

    return { ok: false, output: '', error: `未知操作: ${action}` };
  },
};
