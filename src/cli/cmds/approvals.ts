/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * ③ 审批收件箱 CLI 出口（把v8.6.0 建的审批能力真正暴露给人）：
 *   fhcode approvals list                 列出待决审批项（默认只看待决）
 *   fhcode approvals list --all           含已裁决/已过期
 *   fhcode approvals show <id>            查看单个审批项详情
 *   fhcode approvals approve <id>         批准（放行后续执行）
 *   fhcode approvals reject <id>          拒绝
 *
 * 背景：ask 级动作在 CLI 默认 requireApproval=true 时会挂起到这里，
 * 但此前只有 Web 的 GET /api/routines/approvals 能看，CLI 无出口——
 * 导致"挂起了却看不到、只能去翻 approvals.json"。
 */
import { ensureScheduler, getInbox } from '../../runtime/routines/service';
import type { ApprovalStatus } from '../../security/approval-inbox';

export interface ApprovalsCmdOptions {
  action: 'list' | 'show' | 'approve' | 'reject';
  id?: string;
  all?: boolean;
  by?: string;
}

/** 审批命令是独立的用户入口，需主动 ensureScheduler 以确保收件箱单例存在 */
function requireInbox() {
  ensureScheduler();
  const inbox = getInbox();
  if (!inbox) {
    console.error('✗ 审批收件箱初始化失败（无法读写~/.feihong-code/routines/approvals.json）。');
    process.exitCode = 1;
    return null;
  }
  return inbox;
}

const STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: '待决',
  approved: '已批准',
  rejected: '已拒绝',
  expired: '已过期',
};

function printItem(it: ReturnType<NonNullable<ReturnType<typeof getInbox>>['list']>[number]): void {
  const who = it.decidedBy ? `  裁决人=${it.decidedBy}` : '';
  const when = it.decidedAt ? `  裁决于=${it.decidedAt}` : '';
  console.log(
    `  [${it.id}] ${STATUS_LABEL[it.status] ?? it.status}\n` +
      `     动作：${it.action}\n` +
      `     原因：${it.reason}\n` +
      `     提交：${it.requestedAt}${it.expiresAt ? `  过期：${it.expiresAt}` : ''}${who}${when}`,
  );
}

export async function runApprovalsCmd(opts: ApprovalsCmdOptions): Promise<void> {
  const inbox = requireInbox();
  if (!inbox) return;

  if (opts.action === 'list') {
    const items = opts.all ? inbox.list() : inbox.list('pending');
    if (items.length === 0) {
      console.log(opts.all ? '审批收件箱为空（无任何记录）。' : '当前没有待决审批项。');
      return;
    }
    const tpl = opts.all ? 'all' : 'pending';
    console.log(`审批收件箱（${tpl}）：共 ${items.length} 条`);
    for (const it of items) printItem(it);
    if (!opts.all) {
      console.log('\n提示：用 --all 可查看已裁决记录；用 approve/reject <id> 裁决。');
    }
    return;
  }

  const id = opts.id?.trim();
  if (!id) {
    console.error(`✗ 缺少审批项 id。用法：fhcode approvals ${opts.action} <id>`);
    process.exitCode = 1;
    return;
  }

  if (opts.action === 'show') {
    const it = inbox.list().find((x) => x.id === id);
    if (!it) {
      console.error(`✗ 审批项不存在：${id}`);
      process.exitCode = 1;
      return;
    }
    printItem(it);
    return;
  }

  // approve / reject
  const by = opts.by?.trim() || 'cli';
  const r = inbox.decide(id, opts.action === 'approve', by);
  if (!r.ok) {
    console.error(`✗ 裁决失败：${r.error ?? '未知原因'}`);
    process.exitCode = 1;
    return;
  }
  const it = r.item!;
  if (opts.action === 'approve') {
    console.log(`✓ 已批准 ${it.id}（${it.action}）`);
    console.log('  注：批准仅解除挂起；已挂起的自动化任务需重新触发（fhcode routine run <id>）或等下一个 cron 窗口。');
  } else {
    console.log(`✗ 已拒绝 ${it.id}（${it.action}）——该动作不会被执行。`);
  }
}
