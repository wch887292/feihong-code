/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * ③ 自动化任务管理命令（对标纳米Work 云端 7x24 自动化任务）：
 *   fhcode routine list                        列出所有定时任务与下次执行时间/状态
 *   fhcode routine add --cron "0 * * * *" --goal "审查当前目录代码" --name "定时审查" --tier save
 *   fhcode routine run <id>                   手动触发一次（真实执行，经三级规则引擎门控）
 *   fhcode routine enable <id> on|off         启用/停用
 *   fhcode routine rm <id>                    删除
 */
import { randomUUID } from 'crypto';
import { ensureScheduler } from '../../runtime/routines/service';
import { normalizeTier } from '../../models/tier';
import type { ComputeTier } from '../../shared/types';
import type { RoutineDef } from '../../runtime/routines/store';

export interface RoutineCmdOptions {
  action: 'list' | 'add' | 'run' | 'enable' | 'rm';
  id?: string;
  cron?: string;
  goal?: string;
  command?: string;
  name?: string;
  tier?: ComputeTier;
  workspaceDir?: string;
  enabled?: boolean;
}

export async function runRoutineCmd(opts: RoutineCmdOptions): Promise<void> {
  const s = ensureScheduler();

  switch (opts.action) {
    case 'list': {
      const defs = s.listDefs();
      if (defs.length === 0) {
        console.log('当前没有任何自动化任务。用 fhcode routine add --cron "*/30 * * * *" --goal "..." 创建一个。');
        return;
      }
      console.log('飞虹 Code 自动化任务（云端 7x24 真实执行，经三级规则引擎 + 审批收件箱门控）\n');
      for (const d of defs) {
        const st = s.getState(d.id);
        const actionDesc =
          d.action.type === 'goal'
            ? `goal：${d.action.goal.slice(0, 40)}`
            : d.action.type === 'command'
              ? `command：${d.action.command.slice(0, 40)}`
              : 'noop';
        const tierDesc = d.action.type === 'goal' && d.action.tier ? ` [${d.action.tier}]` : '';
        console.log(`• ${d.id}  ${d.enabled ? '✅启用' : '⏸停用'}  ${d.name}`);
        console.log(`    触发：${d.trigger.kind === 'cron' ? d.trigger.expr : d.trigger.event}   动作：${actionDesc}${tierDesc}`);
        console.log(`    上次：${st.lastRunAt ?? '从未'} (${st.lastStatus ?? '-'})   下次：${st.nextRunAt ?? '-'}`);
      }
      return;
    }

    case 'add': {
      const cron = opts.cron?.trim();
      const name = opts.name?.trim() || '未命名自动化';
      if (!cron) {
        console.error('缺少 --cron 表达式（如 "*/30 * * * *" 或 "@daily"）');
        process.exitCode = 1;
        return;
      }
      if (!opts.goal && !opts.command) {
        console.error('缺少任务内容：--goal "<AI 目标>" 或 --command "<shell 命令>"');
        process.exitCode = 1;
        return;
      }
      const tier = normalizeTier(opts.tier);
      const action =
        opts.command
          ? ({ type: 'command', command: opts.command } as const)
          : ({ type: 'goal', goal: opts.goal!, tier } as const);
      const id = `rt_${Date.now()}_${randomUUID().slice(0, 4)}`;
      const def: Omit<RoutineDef, 'createdAt'> = {
        id,
        name,
        trigger: { kind: 'cron', expr: cron },
        action,
        enabled: opts.enabled !== false,
        catchUp: true,
        maxRetries: 2,
        backoffBaseSec: 60,
      };
      s.addDef(def);
      console.log(`✓ 已创建自动化任务：${name}（${id}）`);
      console.log(`  触发：${cron}   类型：${action.type}${tier ? `   档位：${tier}` : ''}`);
      console.log(`  启动 serve（fhcode serve）后将在后台持续执行；或 fhcode routine run ${id} 立即试跑。`);
      return;
    }

    case 'run': {
      if (!opts.id) {
        console.error('缺少任务 id（fhcode routine list 查看）');
        process.exitCode = 1;
        return;
      }
      const r = await s.runOnce(opts.id);
      if (!r) {
        console.error(`任务不存在或已停用：${opts.id}`);
        process.exitCode = 1;
        return;
      }
      console.log(`触发类型：${r.trigger}   结果：${r.ok ? '✅成功' : '❌失败'}`);
      if (r.output) console.log(`输出：${r.output}`);
      if (r.error) console.error(`错误：${r.error}`);
      return;
    }

    case 'enable': {
      if (!opts.id) {
        console.error('缺少任务 id');
        process.exitCode = 1;
        return;
      }
      const on = opts.enabled !== false;
      const ok = s.setEnabled(opts.id, on);
      if (!ok) {
        console.error(`任务不存在：${opts.id}`);
        process.exitCode = 1;
        return;
      }
      console.log(`✓ 任务 ${opts.id} 已${on ? '启用' : '停用'}`);
      return;
    }

    case 'rm': {
      if (!opts.id) {
        console.error('缺少任务 id');
        process.exitCode = 1;
        return;
      }
      const ok = s.removeDef(opts.id);
      if (!ok) {
        console.error(`任务不存在：${opts.id}`);
        process.exitCode = 1;
        return;
      }
      console.log(`✓ 已删除任务：${opts.id}`);
      return;
    }
  }
}
