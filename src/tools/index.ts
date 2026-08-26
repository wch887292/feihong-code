/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 工具聚合：注册全部内置工具
 */
import { ToolRegistry } from './tool.registry';
import { readFileTool } from './file/read.tool';
import { writeFileTool } from './file/write.tool';
import { editFileTool } from './file/edit.tool';
import { listDirTool } from './file/list.tool';
import { grepTool } from './search/grep.tool';
import { runShellTool } from './shell/run-shell.tool';
import { runTestsTool } from './verify/test-run.tool';
import { buildCheckTool } from './verify/build-check.tool';
import { loadSkillTool } from './skills/load-skill.tool';
import { webFetchTool, webSearchTool } from './web/web.tool';
import { browserTools } from './browser/browser.tool';

export function createDefaultRegistry(): ToolRegistry {
  const reg = new ToolRegistry();
  for (const t of [
    readFileTool,
    writeFileTool,
    editFileTool,
    listDirTool,
    grepTool,
    runShellTool,
    runTestsTool,
    buildCheckTool,
    loadSkillTool,
    webFetchTool,
    webSearchTool,
    ...browserTools,
  ]) {
    reg.register(t);
  }
  return reg;
}

export { ToolRegistry } from './tool.registry';
export * from './tool.interface';
