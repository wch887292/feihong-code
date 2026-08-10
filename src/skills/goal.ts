/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * /goal 技能：把高层目标分解为可跟踪子目标，保存为本地目标文件，支持查询进度。
 * 离线用规则分解；联调时可由模型生成。
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

export interface Goal {
  id: string;
  title: string;
  subGoals: string[];
  createdAt: string;
  status: 'active' | 'done';
}

export function decomposeGoalToGoal(title: string): Goal {
  const subs = title
    .split(/[；;\n。并且同时分别以及]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    id: randomUUID().slice(0, 8),
    title,
    subGoals: subs.length ? subs : [title],
    createdAt: new Date().toISOString(),
    status: 'active',
  };
}

export function saveGoal(goal: Goal, homeDir: string): string {
  const dir = join(homeDir, 'goals');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${goal.id}.json`);
  writeFileSync(file, JSON.stringify(goal, null, 2), 'utf8');
  return file;
}

export function listGoals(homeDir: string): Goal[] {
  const dir = join(homeDir, 'goals');
  if (!existsSync(dir)) return [];
  const out: Goal[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(readFileSync(join(dir, name), 'utf8')) as Goal);
    } catch {
      /* ignore 损坏文件 */
    }
  }
  return out;
}

export function renderGoal(goal: Goal): string {
  return (
    `目标: ${goal.title}\n` +
    `ID: ${goal.id} · 状态: ${goal.status} · 创建: ${goal.createdAt}\n` +
    `子目标(${goal.subGoals.length}):\n` +
    goal.subGoals.map((s, i) => `  ${i + 1}. ${s}`).join('\n')
  );
}
