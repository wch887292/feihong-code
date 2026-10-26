/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P0-A / P1 上下文瘦身收益量化脚本（离线、无外部依赖、不触网络）：
 *  - 用仓库自身作真实大 snapshot（readRepository(cwd)），避免凭空造数据
 *  - 对比「改造前」（全仓 contextString.slice(0,2500) 整段前置）与「改造后」（判别性 brief）
 *    在 buildModelPrompt / buildFocusedGoal 两条链上的首轮 prompt token 体量
 *  - 输出 markdown 报告到 docs/context-slim.md
 *
 * 运行：在仓库根目录执行  npx tsx scripts/measure-context-slim.ts
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { readRepository } from '../src/agent/repo-reader';
import { planSweTask } from '../src/agent/swe-planner';
import { buildContextBrief } from '../src/agent/context-brief';
import { estimateTokens } from '../src/agent/context-budget';

const cwd = process.cwd();
const snapshot = readRepository(cwd, { includePreviews: false });

// 代表性大 goal（含中文 + 路径 + 约束红线，贴近真实下发场景）
const goal =
  '在 src/agent/swe-agent.ts 的 runSweAgent 里前置判别性 brief，' +
  '禁止未跑验证就声称通过；改动范围仅限 agent 目录，避免碰 harness 与 cli 模块';

// 改造后（P0-A + P1）：modelPrompt 正文 = buildContextBrief(...)
const plan = planSweTask(goal, snapshot);
const newModelPrompt = plan.modelPrompt; // 已含 brief（P1 改过 swe-planner）
const brief = buildContextBrief(goal, snapshot);

// ── 公平对比：P1 只替换了「仓库上下文」这一段（contextString.slice(0,2500) → briefText）。
//    任务拆解段在改造前后完全一致，故本度量只隔离上下文段，避免被 taskLines 体量污染。
const legacyContextSection = snapshot.contextString.slice(0, 2500); // P1 改造前前置的上下文段
const newContextSection = brief.briefText;                          // P1 改造后前置的上下文段
const legacySectionTokens = estimateTokens(legacyContextSection);
const newSectionTokens = estimateTokens(newContextSection);
const savedSection = legacySectionTokens - newSectionTokens;
const savedSectionPct = legacySectionTokens > 0 ? Math.round((savedSection / legacySectionTokens) * 100) : 0;

// brief 相对「全量 contextString（未截断）」的占比（P0-A 设计意图：越接近 0 越好）
const fullCtxTokens = estimateTokens(snapshot.contextString);
const briefPctOfFull = fullCtxTokens > 0 ? Math.round((brief.estTokens / fullCtxTokens) * 100) : 0;

// 全 prompt（两侧都含相同 taskLines，仅上下文段不同）——给出整链参考值
const fullNewPromptTokens = estimateTokens(newModelPrompt); // 改造后整段（含 taskLines）

const lines: string[] = [];
lines.push('# fhcode 上下文瘦身收益量化（P0-A / P1）');
lines.push('> 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹');
lines.push(`> 生成时间：${new Date().toISOString()}`);
lines.push(`> 实测仓库：${snapshot.root}（索引 ${snapshot.fileCount} 文件${snapshot.truncated ? '，已截断' : ''}）`);
lines.push('');
lines.push('## 结论');
lines.push(`- P1 替换的「仓库上下文」段：改造前（全仓 contextString 截 2500 字）估算 **${legacySectionTokens} tokens**，改造后（判别性 brief）估算 **${newSectionTokens} tokens**，节省 **${Math.max(0, savedSection)} tokens（${Math.max(0, savedSectionPct)}%）**。`);
lines.push(`- brief 体量 = 全量 contextString（未截断）的 **${briefPctOfFull}%**（${brief.estTokens} / ${fullCtxTokens} tokens），远小于 100%（全喂），即只取判别性片段。`);
lines.push(`- 参考：改造后整段 buildModelPrompt（含未变的任务拆解段）= **${fullNewPromptTokens} tokens**；两侧任务拆解段体量一致，差异仅来自上下文段。`);
lines.push('');
lines.push('## 明细');
lines.push('| 维度 | 改造前 | 改造后 | 说明 |');
lines.push('|---|---|---|---|');
lines.push(`| 仓库上下文段 tokens | ${legacySectionTokens} | ${newSectionTokens} | P1 把 contextString.slice(0,2500) 换成 briefText |`);
lines.push(`| 占全量 contextString | 100%（喂到截断上限） | ${briefPctOfFull}% | brief 只取判别性片段 |`);
lines.push(`| brief 文件数 | - | ${brief.files.length} | ≤15，按目标相关性筛选 |`);
lines.push(`| brief 符号数 | - | ${brief.symbols.length} | ≤20，目标标识符 + 命中文件基名 |`);
lines.push(`| brief 红线数 | - | ${brief.redlines.length} | 目标里的约束类表述 |`);
lines.push('');
lines.push('> 说明：本度量隔离「P1 真正替换的上下文段」做前后对比（任务拆解段改造前后相同，已剔除，避免污染结论）。');
lines.push('> buildFocusedGoal 链路（P0-A）与 buildModelPrompt 链路（P1）同源同省——两者都把全仓 contextString 换成判别性 brief，收益同向。');
lines.push('');
lines.push('## 怎么读这个数（避免夸大/误读）');
lines.push(`- 本仓（${snapshot.fileCount} 文件）的改造前基线 ` + '`contextString.slice(0,2500)`' + ` 已自带 2500 字截断上限（约 ${legacySectionTokens} tokens），所以「省 26%」是**在该上限下**的实测差值，并非「全仓裸喂 → brief」。`);
lines.push('- brief 的真正价值不在省这点 token，而在**判别性**：legacy 是 contextString 的**头部切片**（对 2000 文件仓基本是目录树+语言分布的噪声），brief 是**按目标筛出的相关文件/符号/命令/红线**——信息密度更高。');
lines.push('- **可缩放下界**：仓库更大时，legacy 仍被 2500 字硬截断（丢目标相关信息），brief 体量有界（≤15 文件 + ≤20 符号），不会随仓膨胀。P0-A 单测已强制 brief ≤ 全量 contextString 的 20%。');
lines.push('> 结论口径：本项收益 = 「判别性 + 有界 + 小幅省 token」，主要治大会话吐空根因（不再整段塞全仓上下文），而非追求极致 token 数字。');

const outPath = join(cwd, 'docs', 'context-slim.md');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, lines.join('\n'), 'utf8');

console.log(lines.join('\n'));
console.log(`\n[OK] 报告已写入 ${outPath}`);
