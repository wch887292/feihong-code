/**
 * 飞虹 Code - 语音编程 (阶段四-1)
 *
 * 支持语音编程能力：
 * - 语音指令解析：将自然语言语音转换为编程操作
 * - 语音转代码：根据语音描述生成代码
 * - 语音命令：常用操作的语音快捷命令
 * - 语音上下文：维护语音对话上下文
 */
import { logger } from '../shared/logger';

/** 语音指令类型 */
export type VoiceCommandType =
  | 'new_file' | 'open_file' | 'save_file' | 'close_file'
  | 'run_code' | 'debug_code' | 'stop_code'
  | 'search' | 'replace' | 'goto_line'
  | 'comment' | 'uncomment' | 'format'
  | 'undo' | 'redo' | 'copy' | 'paste' | 'cut'
  | 'zoom_in' | 'zoom_out' | 'reset_zoom'
  | 'toggle_terminal' | 'toggle_sidebar' | 'toggle_fullscreen'
  | 'generate_code' | 'explain_code' | 'refactor_code' | 'review_code'
  | 'chat' | 'unknown';

/** 语音指令 */
export interface VoiceCommand {
  type: VoiceCommandType;
  rawText: string;
  params: Record<string, any>;
  confidence: number;
  needConfirm: boolean;
}

/** 语音转代码结果 */
export interface VoiceToCodeResult {
  code: string;
  language: string;
  explanation: string;
  confidence: number;
}

/** 语音对话上下文 */
export interface VoiceContext {
  sessionId: string;
  history: Array<{
    role: 'user' | 'assistant';
    text: string;
    timestamp: string;
  }>;
  currentFile?: string;
  currentLanguage?: string;
  createdAt: string;
  lastActiveAt: string;
}

/** 语音命令映射规则 */
const COMMAND_RULES: Array<{
  type: VoiceCommandType;
  patterns: RegExp[];
  extractParams?: (text: string) => Record<string, any>;
  needConfirm?: boolean;
}> = [
  {
    type: 'new_file',
    patterns: [/新建文件|创建文件|新文件|new file|create file|创建一个?/i],
    extractParams: (text) => {
      const match = text.match(/(?:新建|创建|new|create)(?:文件|file)?(?:一个)?(?:叫|名为|named)?\s*([\w.-]+)/i);
      return match ? { fileName: match[1] } : {};
    },
  },
  // 面板/视图类开关（语义更具体）须排在 open_file 之前：
  // 「打开终端/侧边栏/全屏」与 open_file 的宽泛「打开」匹配置信度相同，
  // 并列时先匹配者胜，若排在后面会被 open_file 错误抢占。
  { type: 'toggle_terminal', patterns: [/终端|terminal|控制台/i] },
  { type: 'toggle_sidebar', patterns: [/侧边栏|侧栏|sidebar/i] },
  { type: 'toggle_fullscreen', patterns: [/全屏|fullscreen/i] },
  {
    type: 'open_file',
    patterns: [/打开文件|打开|open file|open/i],
    extractParams: (text) => {
      const match = text.match(/(?:打开|open)\s*(?:文件|file)?\s*([\w./]+)/i);
      return match ? { fileName: match[1] } : {};
    },
  },
  { type: 'save_file', patterns: [/保存|存盘|save/i] },
  { type: 'close_file', patterns: [/关闭文件|关掉文件|close file|close/i] },
  { type: 'run_code', patterns: [/运行|执行|跑一下|run|execute/i] },
  { type: 'debug_code', patterns: [/调试|debug/i] },
  { type: 'stop_code', patterns: [/停止|终止|stop/i] },
  {
    type: 'search',
    patterns: [/搜索|查找|search|find/i],
    extractParams: (text) => {
      const match = text.match(/(?:搜索|查找|search|find)\s*(?:什么|什么是|for)?\s*(.+)/i);
      return match ? { query: match[1].trim() } : {};
    },
  },
  {
    type: 'replace',
    patterns: [/替换|replace/i],
    extractParams: (text) => {
      const m = text.match(/(?:把|将)?\s*([^\s，。]+?)\s*(?:替换|replace)\s*(?:成|为|换成)?\s*([^\s，。]+)/i);
      return m ? { from: m[1], to: m[2] } : {};
    },
  },
  {
    type: 'goto_line',
    patterns: [/跳到第?\d+行|跳转到|goto line|go to line/i],
    extractParams: (text) => {
      const match = text.match(/(\d+)\s*行/);
      return match ? { line: parseInt(match[1], 10) } : {};
    },
  },
  { type: 'comment', patterns: [/注释|comment/i] },
  { type: 'uncomment', patterns: [/取消注释|去掉注释|uncomment/i] },
  { type: 'format', patterns: [/格式化|format|美化代码/i] },
  { type: 'undo', patterns: [/撤销|undo/i] },
  { type: 'redo', patterns: [/重做|恢复|redo/i] },
  { type: 'copy', patterns: [/复制|拷贝|copy/i] },
  { type: 'paste', patterns: [/粘贴|paste/i] },
  { type: 'cut', patterns: [/剪切|cut/i] },
  {
    type: 'generate_code',
    patterns: [/生成代码|写代码|帮我写|generate code|write code/i],
    extractParams: (text) => {
      const match = text.match(/(?:生成|写|帮我写|generate|write)\s*(?:代码|code)?\s*(?:实现|做|一个|一个)?\s*(.+)/i);
      return match ? { description: match[1].trim() } : {};
    },
    needConfirm: true,
  },
  { type: 'explain_code', patterns: [/解释|讲解|explain/i] },
  { type: 'refactor_code', patterns: [/重构|优化代码|refactor/i], needConfirm: true },
  { type: 'review_code', patterns: [/审查代码|代码审查|review code|code review/i] },
  { type: 'zoom_in', patterns: [/放大|zoom in/i] },
  { type: 'zoom_out', patterns: [/缩小|zoom out/i] },
  { type: 'reset_zoom', patterns: [/重置缩放|reset zoom/i] },
];

/**
 * 语音编程管理器
 */
export class VoiceProgrammingManager {
  private contexts: Map<string, VoiceContext> = new Map();

  constructor() {
    logger.info('voice programming manager initialized');
  }

  /**
   * 解析语音指令
   */
  parseCommand(text: string): VoiceCommand {
    const trimmed = text.trim();
    let bestMatch: { type: VoiceCommandType; confidence: number; params: Record<string, any>; needConfirm: boolean } | null = null;

    for (const rule of COMMAND_RULES) {
      for (const pattern of rule.patterns) {
        if (pattern.test(trimmed)) {
          const match = trimmed.match(pattern);
          const matchLength = match ? match[0].length : 0;
          const confidence = Math.min(1, matchLength / trimmed.length + 0.3);
          const params = rule.extractParams ? rule.extractParams(trimmed) : {};

          if (!bestMatch || confidence > bestMatch.confidence) {
            bestMatch = { type: rule.type, confidence, params, needConfirm: rule.needConfirm || false };
          }
        }
      }
    }

    if (!bestMatch) {
      return { type: 'chat', rawText: trimmed, params: { text: trimmed }, confidence: 0.5, needConfirm: false };
    }

    return {
      type: bestMatch.type,
      rawText: trimmed,
      params: bestMatch.params,
      confidence: bestMatch.confidence,
      needConfirm: bestMatch.needConfirm,
    };
  }

  /**
   * 语音转代码
   */
  async voiceToCode(description: string, language: string = 'typescript', _context?: string): Promise<VoiceToCodeResult> {
    logger.info('voice to code', { description, language });
    const code = this.generateCodeFromTemplate(description, language);
    return {
      code,
      language,
      explanation: `根据语音描述"${description}"生成的${language}代码`,
      confidence: 0.7,
    };
  }

  /**
   * 基于模板生成代码
   */
  private generateCodeFromTemplate(description: string, language: string): string {
    const desc = description.toLowerCase();

    if (desc.includes('函数') || desc.includes('function')) {
      const nameMatch = description.match(/(?:函数|function)\s*(?:叫|名为)?\s*(\w+)/);
      const name = nameMatch ? nameMatch[1] : 'myFunction';
      if (language === 'typescript' || language === 'javascript') {
        return `function ${name}(params: any): any {\n  // TODO: 实现逻辑\n  return null;\n}`;
      }
    }

    if (desc.includes('类') || desc.includes('class')) {
      const nameMatch = description.match(/(?:类|class)\s*(?:叫|名为)?\s*(\w+)/);
      const name = nameMatch ? nameMatch[1] : 'MyClass';
      if (language === 'typescript') {
        return `class ${name} {\n  constructor() {\n    // TODO: 初始化\n  }\n\n  method(): void {\n    // TODO: 实现方法\n  }\n}`;
      }
    }

    return `// ${description}\n// TODO: 实现以下功能\n`;
  }

  /**
   * 创建语音会话上下文
   */
  createContext(sessionId?: string): VoiceContext {
    const id = sessionId || `voice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const context: VoiceContext = {
      sessionId: id,
      history: [],
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    this.contexts.set(id, context);
    return context;
  }

  getContext(sessionId: string): VoiceContext | undefined {
    return this.contexts.get(sessionId);
  }

  addHistory(sessionId: string, role: 'user' | 'assistant', text: string): void {
    const context = this.contexts.get(sessionId);
    if (!context) return;
    context.history.push({ role, text, timestamp: new Date().toISOString() });
    context.lastActiveAt = new Date().toISOString();
    if (context.history.length > 50) context.history = context.history.slice(-50);
  }

  setCurrentFile(sessionId: string, filePath: string, language?: string): void {
    const context = this.contexts.get(sessionId);
    if (!context) return;
    context.currentFile = filePath;
    if (language) context.currentLanguage = language;
    context.lastActiveAt = new Date().toISOString();
  }

  cleanupExpiredSessions(maxAgeMs: number = 30 * 60 * 1000): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, context] of this.contexts) {
      if (now - new Date(context.lastActiveAt).getTime() > maxAgeMs) {
        this.contexts.delete(id);
        cleaned++;
      }
    }
    if (cleaned > 0) logger.info('voice sessions cleaned', { cleaned });
    return cleaned;
  }

  getSupportedCommands(): Array<{ type: VoiceCommandType; description: string; examples: string[] }> {
    return [
      { type: 'new_file', description: '新建文件', examples: ['新建文件', '创建一个叫 utils 的文件'] },
      { type: 'open_file', description: '打开文件', examples: ['打开 index.ts', '打开配置文件'] },
      { type: 'save_file', description: '保存文件', examples: ['保存', '存盘'] },
      { type: 'close_file', description: '关闭文件', examples: ['关闭文件', 'close file'] },
      { type: 'run_code', description: '运行代码', examples: ['运行', '执行一下', '跑一下'] },
      { type: 'debug_code', description: '调试代码', examples: ['调试', 'debug'] },
      { type: 'stop_code', description: '停止代码', examples: ['停止', '终止运行'] },
      { type: 'search', description: '搜索', examples: ['搜索函数', '查找 TODO'] },
      { type: 'replace', description: '替换', examples: ['把 A 替换成 B'] },
      { type: 'goto_line', description: '跳转到指定行', examples: ['跳到第100行', '跳转到50行'] },
      { type: 'comment', description: '注释代码', examples: ['注释', '注释这行'] },
      { type: 'uncomment', description: '取消注释', examples: ['取消注释', 'uncomment'] },
      { type: 'format', description: '格式化代码', examples: ['格式化', '美化代码'] },
      { type: 'undo', description: '撤销', examples: ['撤销', 'undo'] },
      { type: 'redo', description: '重做', examples: ['重做', '恢复', 'redo'] },
      { type: 'copy', description: '复制', examples: ['复制', 'copy'] },
      { type: 'paste', description: '粘贴', examples: ['粘贴', 'paste'] },
      { type: 'cut', description: '剪切', examples: ['剪切', 'cut'] },
      { type: 'generate_code', description: '生成代码', examples: ['生成一个排序函数', '帮我写一个登录接口'] },
      { type: 'explain_code', description: '解释代码', examples: ['解释这段代码', 'explain'] },
      { type: 'refactor_code', description: '重构代码', examples: ['重构', '优化这段代码'] },
      { type: 'review_code', description: '审查代码', examples: ['审查代码', 'code review'] },
      { type: 'toggle_terminal', description: '切换终端', examples: ['打开终端', '关闭终端'] },
      { type: 'toggle_sidebar', description: '切换侧边栏', examples: ['打开侧边栏', '关闭侧栏'] },
      { type: 'toggle_fullscreen', description: '切换全屏', examples: ['全屏', '退出全屏'] },
      { type: 'zoom_in', description: '放大', examples: ['放大', 'zoom in'] },
      { type: 'zoom_out', description: '缩小', examples: ['缩小', 'zoom out'] },
      { type: 'reset_zoom', description: '重置缩放', examples: ['重置缩放', 'reset zoom'] },
    ];
  }
}

export function createVoiceProgrammingManager(): VoiceProgrammingManager {
  return new VoiceProgrammingManager();
}
