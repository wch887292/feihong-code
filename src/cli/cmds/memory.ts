/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * ④ 工作记忆增强 CLI（对标纳米Work 记忆复用 / Codex memories 命名空间）：
 *   fhcode memory profile   业务画像：跨会话沉淀的任务/决策/产物/偏好总览
 *   fhcode memory stats     分层记忆统计（工作/任务/项目三层 + 压缩次数）
 *   fhcode memory list [--project <p>]  事实记忆列表（缺省=全局，--project * 全部）
 *   fhcode memory clear     清空当前临时目录下的项目记忆（谨慎，需 --yes）
 */
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { resolveAccountHome } from '../../security/account';
import { createLayeredMemory } from '../../agent/layered-memory';
import { aggregateProfile, formatProfile } from '../../memory/profile';
import { TransparentMemory } from '../../memory/transparent';
import { getStore } from '../../shared/sqlite-store';
import { deriveProjectId } from '../../shared/project-env';

export async function runMemoryCmd(
  action: 'profile' | 'stats' | 'list' | 'clear',
  yes = false,
  project?: string,
): Promise<void> {
  const lm = createLayeredMemory();

  switch (action) {
    case 'profile': {
      const entries = lm.getProjectMemory();
      console.log(formatProfile(aggregateProfile(entries)));
      return;
    }
    case 'stats': {
      const s = lm.getStats();
      console.log('飞虹 Code 分层记忆统计');
      console.log(`  工作记忆消息数：${s.workingMemoryCount}`);
      console.log(`  任务记忆 Checkpoint：${s.taskMemoryCount}（累计 ${s.totalCheckpoints}）`);
      console.log(`  项目记忆条目：${s.projectMemoryCount}`);
      console.log(`  压缩次数：${s.totalCompressions}${s.lastCompactionAt ? `（最近 ${s.lastCompactionAt}）` : ''}`);
      return;
    }
    case 'list': {
      // 事实记忆（user_memory）按项目作用域列出；缺省=全局
      const scope = project ?? undefined;
      const mem = new TransparentMemory(getStore(), 'default');
      const rows = mem.list(50, scope);
      if (rows.length === 0) {
        console.log(`（${scope === undefined ? '全局' : scope === '*' ? '全部' : `项目 ${scope}`}事实记忆为空）`);
        return;
      }
      console.log(`事实记忆（${scope === undefined ? '全局' : scope === '*' ? '全部作用域' : `项目 ${scope}`}，共 ${rows.length} 条）:`);
      for (const r of rows) {
        const p = r.project ? ` [${r.project}]` : '';
        console.log(`  #${r.id}${p} ${r.importance.toFixed(2)} ${r.createdAt.slice(0, 19)} ${r.content.slice(0, 100)}`);
      }
      console.log(`\n当前目录项目标识：${deriveProjectId()}（fhcode memory list --project <名> 可查看指定项目）`);
      return;
    }
    case 'clear': {
      if (!yes) {
        console.error('清空项目记忆需显式确认：fhcode memory clear --yes');
        process.exitCode = 1;
        return;
      }
      const file = join(resolveAccountHome(), 'layered-memory', 'project-memory.json');
      if (existsSync(file)) {
        rmSync(file, { force: true });
        console.log('✓ 已清空项目记忆（project-memory.json）');
      } else {
        console.log('项目记忆文件不存在，无需清空。');
      }
      return;
    }
  }
}
