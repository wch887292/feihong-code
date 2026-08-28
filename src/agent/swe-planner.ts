/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * M9 软件工程任务规划器（SWE Planner）：
 *  - 基于目标 + 仓库快照，将大目标拆解为有序、可独立验证的子任务
 *  - 每个子任务携带：目标文件（globs）、验收标准、验证命令（默认复用仓库能力）
 *  - 离线规则拆解（无需模型）；亦产出 modelPrompt 供真实模型生成更智能计划
 */
import type { RepoSnapshot } from './repo-reader';

export interface SweSubTask {
  id: string;
  title: string;
  description: string;
  /** 该子任务预期改动/新增的文件（globs 或具体路径），用于上下文聚焦 */
  targetFiles: string[];
  /** 验收标准（自然语言，用于模型自检与验证器对照） */
  acceptance: string;
  /** 该子任务专属的验证命令（不填则使用仓库默认 build/test） */
  verifyCommand?: string;
  /** 依赖的前置子任务 id（用于排序，当前实现线性执行） */
  dependsOn: string[];
  /** 估计复杂度（1-5），用于资源分配与汇报 */
  complexity: number;
}

export interface SwePlan {
  goal: string;
  tasks: SweSubTask[];
  /** 给模型看的增强提示（含仓库上下文摘要 + 子任务清单） */
  modelPrompt: string;
}

/** 离线规则拆解：按目标关键词映射到典型子任务模板 */
export function planSweTask(goal: string, snapshot: RepoSnapshot): SwePlan {
  const tasks: SweSubTask[] = [];
  const lower = goal.toLowerCase();
  let idx = 0;

  const push = (t: Omit<SweSubTask, 'id'>): void => {
    tasks.push({ ...t, id: `s${++idx}` });
  };

  // 1) 勘察与理解（始终第一个）
  push({
    title: '勘察仓库结构',
    description: `阅读仓库上下文，确认入口、模块边界与既有约定。\n${snapshot.contextString.slice(0, 1500)}`,
    targetFiles: snapshot.keyFiles.length ? snapshot.keyFiles : ['.'],
    acceptance: '已理解仓库结构、关键文件路径与验证方式（build/test 命令）。',
    dependsOn: [],
    complexity: 1,
  });

  // 2) 若目标含「测试」或仓库有测试框架 → 补测试任务
  const needsTest = /测试|test|覆盖|unittest|验证/.test(lower);
  const addTestTask = needsTest || !!snapshot.testFramework;

  // 3) 核心实现任务（按目标特征拆分）
  if (/新增|实现|添加|开发|create|add|implement|feature/.test(lower)) {
    push({
      title: '实现核心功能',
      description: `根据目标实现新功能：${goal}。先定位相关模块，遵循既有代码风格。`,
      targetFiles: inferTargetFiles(goal, snapshot),
      acceptance: `目标功能已实现，相关文件可通过类型检查/构建。`,
      dependsOn: ['s1'],
      complexity: 3,
    });
  } else if (/修复|修 bug|fix|bug|问题|错误|error|resolve|patch/.test(lower)) {
    push({
      title: '定位并修复缺陷',
      description: `定位导致问题的根因并修复：${goal}。优先复现，再最小化改动。`,
      targetFiles: inferTargetFiles(goal, snapshot),
      acceptance: '缺陷已修复，原有行为恢复且未引入回归。',
      dependsOn: ['s1'],
      complexity: 3,
    });
  } else if (/重构|refactor|优化|optimize|improve|清理|clean/.test(lower)) {
    push({
      title: '重构/优化目标代码',
      description: `在不改变外部行为前提下重构/优化：${goal}。保持测试通过。`,
      targetFiles: inferTargetFiles(goal, snapshot),
      acceptance: '代码已优化/重构，构建与测试仍全部通过（无行为回归）。',
      dependsOn: ['s1'],
      complexity: 2,
    });
  } else {
    // 通用：实现 + 适配
    push({
      title: '实现目标变更',
      description: `完成目标变更：${goal}。结合仓库约定落地。`,
      targetFiles: inferTargetFiles(goal, snapshot),
      acceptance: '目标变更已落实，构建通过。',
      dependsOn: ['s1'],
      complexity: 3,
    });
  }

  // 4) 测试任务（如有需要）
  if (addTestTask) {
    push({
      title: '补充/运行测试',
      description: `为目标变更编写或补全测试，并运行验证：${snapshot.testCommand ?? 'npm test'}。`,
      targetFiles: inferTestFiles(snapshot),
      acceptance: '相关测试已存在并通过（或新测试覆盖目标行为）。',
      dependsOn: ['s2'],
      complexity: 2,
      verifyCommand: snapshot.testCommand,
    });
  }

  // 5) 验证收尾（始终最后）
  push({
    title: '构建与全量验证',
    description:
      `运行构建（${snapshot.buildCommand ?? 'npx tsc --noEmit'}）与全量测试（${snapshot.testCommand ?? 'npm test'}），确认无回归。`,
    targetFiles: ['.'],
    acceptance: '构建成功、测试全绿；若有失败则回到对应子任务修复（自愈）。',
    dependsOn: tasks.length >= 2 ? [`s${tasks.length}`] : ['s2'],
    complexity: 2,
    verifyCommand: combineVerify(snapshot),
  });

  const modelPrompt = buildModelPrompt(goal, snapshot, tasks);
  return { goal, tasks, modelPrompt };
}

/** 从目标文本中推断可能相关的文件（按关键词匹配文件名） */
function inferTargetFiles(goal: string, snapshot: RepoSnapshot): string[] {
  const words = goal
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .map((w) => w.replace(/[es]$/, '')); // 简单去复数
  const hits = new Set<string>();
  for (const f of snapshot.files) {
    const base = basenameNoExt(f.path).toLowerCase();
    for (const w of words) {
      if (w && (base.includes(w) || f.path.toLowerCase().includes(w))) {
        hits.add(f.path);
        break;
      }
    }
  }
  // 若无命中，退回源码文件前若干
  if (hits.size === 0) {
    for (const f of snapshot.files.filter((x) => x.isSource).slice(0, 5)) hits.add(f.path);
  }
  return [...hits].slice(0, 8);
}

function inferTestFiles(snapshot: RepoSnapshot): string[] {
  const tests = snapshot.files.filter((f) => f.isTest).map((f) => f.path);
  return tests.length ? tests.slice(0, 8) : ['（请新建测试文件）'];
}

function basenameNoExt(p: string): string {
  const b = p.split('/').pop() ?? p;
  return b.replace(/\.[^.]+$/, '');
}

function combineVerify(snapshot: RepoSnapshot): string {
  const parts: string[] = [];
  if (snapshot.buildCommand) parts.push(snapshot.buildCommand);
  if (snapshot.testCommand) parts.push(snapshot.testCommand);
  return parts.join(' && ') || 'echo no-verify-available';
}

function buildModelPrompt(goal: string, snapshot: RepoSnapshot, tasks: SweSubTask[]): string {
  const taskLines = tasks
    .map(
      (t) =>
        `- [${t.id}] ${t.title} (复杂度${t.complexity})\n  目标文件: ${t.targetFiles.join(', ') || '（自动定位）'}\n  验收: ${t.acceptance}`,
    )
    .join('\n');
  return [
    '你是全自动软件工程 Agent。请严格按以下计划，使用可用工具（读/写/编辑/列目录/搜索/执行命令/跑测试）完成任务。',
    `总目标: ${goal}`,
    '',
    '## 仓库上下文摘要',
    snapshot.contextString.slice(0, 2500),
    '',
    '## 任务拆解（请逐条执行，前一条完成并通过验证后再进入下一条）',
    taskLines,
    '',
    '## 执行纪律（真实模型务必遵守）',
    '1. 你只能通过调用工具（read/edit/write/bash 等）来实际修改文件，禁止只在回复里「描述」代码而不落地。',
    '2. 每步先用 read/list/grep 确认现状，再动手；优先 Edit 局部修改，避免整文件重写破坏既有逻辑。',
    '3. 改动后必须实际运行仓库的验证命令（见「验证能力」），并依据命令的【真实退出码与输出】判断成败，严禁在没有运行验证的情况下声称「已完成/已通过」。',
    '4. 只改动与当前子任务相关的文件，避免无谓地触碰无关模块、不破坏其它功能。',
    '5. 若验证失败：完整阅读错误输出 → 定位根因 → 就地修复 → 重新运行验证；重复直至通过或确认不可行，不要跳过或编造结果。',
    '6. 所有子任务完成后，用自然语言如实总结：改了哪些文件、跑了什么验证、最终结果。',
  ].join('\n');
}
