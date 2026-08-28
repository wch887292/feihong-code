/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * P1-2 工具：load_skill —— 按名加载 SKILL.md 完整指令（渐进式披露 Tier-2）。
 * 模型从 system prompt 的技能索引中看到 name+description，
 * 需要时调用本工具取回完整指令，避免把全部技能正文常驻上下文。
 */
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from '../tool.interface';
import { discoverSkills, loadSkillBody, type Skill } from '../../skills/skill-loader';

/** 打包技能目录（仓库内 skills/，随 dist 分发） */
const PACKAGED_SKILL_DIRS = [require('path').join(__dirname, '..', '..', '..', 'skills')];

export const loadSkillTool: Tool = {
  name: 'load_skill',
  description: '加载指定技能的完整指令（技能名见 system prompt 中的技能索引）',
  jsonSchema: {
    type: 'object',
    properties: { name: { type: 'string', description: '技能名，如 plan / grill / goal' } },
    required: ['name'],
  },
  schema: z.object({ name: z.string().min(1) }),
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const { name } = args as { name: string };
    const skills: Skill[] = discoverSkills(ctx.cwd, PACKAGED_SKILL_DIRS);
    const body = loadSkillBody(skills, name);
    if (body === null) {
      const available = skills.map((s) => s.name).join(', ') || '（无）';
      return { ok: false, output: '', error: `未找到技能 ${name}；可用技能: ${available}` };
    }
    return { ok: true, output: body.slice(0, 12000) };
  },
};
