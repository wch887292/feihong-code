/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 自主编程命令（code-write / quality-gate，M8）
 * 从 cli/run.ts 抽离（B3 架构治理延续，2026-09-28）。
 */

import { t } from '../../shared/i18n';
import { loadConfig } from '../../shared/config';
import { ModelRouter } from '../../models/model-router';
import { createCodeWriter } from '../../agent/code-writer';
import { createQualityGate } from '../../agent/quality-gate';

function slugifyGoal(goal: string): string {
  const slug = goal.replace(/[^\w一-龥]/g, '').slice(0, 24);
  return slug || 'output';
}

/** 去除 ```lang ... ``` 围栏，提取纯代码 */
function stripCodeFences(text: string): string {
  const m = text.match(/```(?:[a-zA-Z]+)?\s*([\s\S]*?)```/);
  return (m ? m[1] : text).trim();
}

/** 离线 / 无可用模型时的目标相关脚手架（不再输出固定的「佣金示例」） */
function goalScaffold(goal: string): string {
  return `/**
 * 飞虹 Code 自主编写脚手架（离线模式 / 未配置模型）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 * 目标：${goal}
 * 说明：未检测到可用模型或生成失败，已生成目标相关的占位骨架；
 *       配置 FH_PROVIDERS 后重跑即可享受真实代码生成。
 */
// TODO: 根据目标实现：${goal}
export function placeholder(): void {
  throw new Error('请配置 FH_PROVIDERS 后重跑 fhcode code-write 以生成真实实现');
}
`;
}

/** 调用真实模型按 goal 生成代码（复用 ModelRouter + loadConfig） */
async function generateCodeFromGoal(goal: string): Promise<string> {
  const cfg = loadConfig();
  const router = ModelRouter.fromConfig(cfg);
  const resp = await router.chat({
    messages: [
      {
        role: 'system',
        content:
          '你是一名资深 TypeScript 工程师，请根据用户目标生成可直接运行的代码。' +
          '只输出代码本身，必要时用 ```ts 代码块包裹，不要附加解释性文字。',
      },
      { role: 'user', content: goal },
    ],
    maxTokens: 2048,
    temperature: 0.2,
  });
  return stripCodeFences(resp.message.content);
}

export async function runCodeWrite(goal: string): Promise<void> {
  const writer = createCodeWriter(process.cwd());
  // A3 修复(2026-09-27)：先用真实模型按 goal 生成代码，失败/离线时回退到目标相关脚手架；
  // 生成的代码交由 write→test→review→selfHeal 流水线（writer.run）处理，不再写入固定的佣金示例。
  const filePath = 'generated/' + slugifyGoal(goal) + '.ts';
  const code = await generateCodeFromGoal(goal).catch(() => goalScaffold(goal));
  const result = await writer.run(goal, code, filePath);
  console.log('\n' + t('codewrite.resultTitle'));
  console.log(result.summary);
  console.log(t('codewrite.files', { files: result.finalFiles.join(', ') }));
}

/** fhcode quality-gate [路径]：质量门禁审查 */
export function runQualityGate(path?: string): void {
  const targetPath = path || process.cwd();
  const gate = createQualityGate();
  const results = gate.gateDirectory(targetPath, 10);
  console.log(gate.report(results));
  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    console.log('\n' + t('quality.failed', { n: failed.length }));
  }
}

/** fhcode self-improve：自我改进统计 + 经验库概览 + 学习提示预览 */
