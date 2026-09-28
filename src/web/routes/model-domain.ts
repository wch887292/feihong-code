/**
 * 飞虹 Code - 模型/补全域路由（B3-b 拆分自 web/server.ts）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 包含区块（原 782-895 / 1119-1306）：
 * - P2: 代码补全 API（真实接入 CompletionEngine）
 * - 阶段一-2：补全 Pro API
 * - P2-1: 设计稿转代码 API（多模态，图片→代码）
 * - 大模型配置（三重加密：apiKey AES-256-GCM 落盘加密 + RSA 加密传输）
 * - P2: 共享 ModelRouter + CompletionEngine
 *
 * 模块约束：依赖经 ModelDomainDeps 注入；本模块不得反向 import web/server。
 */
import express, { type Request, type Response } from 'express';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { TaskQueue } from '../task-queue';
import { ModelRouter } from '../../models/model-router';
import { OpenAICompatibleProvider } from '../../models/providers/openai-compatible.provider';
import { createCompletionEngine, type CompletionEngine } from '../../agent/completion-engine';
import { lintSnippet } from '../../agent/lint';
import { buildCodeGraph } from '../../agent/symbol-index';
import { createDesignToCodeEngine, type DesignToCodeEngine } from '../../agent/design-to-code';
import { encryptText, decryptText, isEncrypted, getRsaKeys, rsaDecrypt } from '../../shared/secure-store';

type ExpressApp = ReturnType<typeof express>;

// 模块级共享 ModelRouter（由大模型配置接口重建；供 server.ts 注入 managers 域只读访问）
let sharedModelRouter: ModelRouter | null = null;
export function getSharedModelRouter(): ModelRouter | null {
  return sharedModelRouter;
}

export interface ModelDomainDeps {
  homeDir: string;
  masterKey: Buffer;
  rsaKeys: ReturnType<typeof getRsaKeys>;
  queue: TaskQueue;
  loadJsonFile: <T>(file: string, fallback: T) => T;
  saveJsonFile: (file: string, data: unknown) => boolean;
  getServerWorkspaceDir: () => string;
}

export function registerModelDomainRoutes(app: ExpressApp, deps: ModelDomainDeps): void {
  const { homeDir, masterKey, rsaKeys, queue, loadJsonFile, saveJsonFile } = deps;
  /* ========== P2: 代码补全 API（真实接入 CompletionEngine） ========== */
  app.post('/api/completion', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const filePath = typeof body?.filePath === 'string' ? body.filePath.trim() : '';
    const fileContent = typeof body?.fileContent === 'string' ? body.fileContent : '';
    const cursorOffset = typeof body?.cursorOffset === 'number' ? body.cursorOffset : fileContent.length;
    const mode = body?.mode === 'full' ? 'full' : 'quick';
    const language = typeof body?.language === 'string' ? body.language : undefined;
    const crossFileContext = typeof body?.crossFileContext === 'string' ? body.crossFileContext : undefined;
    if (!filePath || !fileContent) {
      res.status(400).json({ ok: false, error: '缺少 filePath 或 fileContent' });
      return;
    }
    if (!completionEngine) {
      res.json({ ok: true, suggestions: [], latencyMs: 0, model: '', cached: false, note: '未配置模型，补全不可用' });
      return;
    }
    try {
      const result = await completionEngine.complete({
        filePath,
        fileContent,
        cursorOffset,
        mode,
        language,
        crossFileContext,
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: '补全失败: ' + (e as Error).message, suggestions: [] });
    }
  });

  app.post('/api/lint', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const code = typeof body?.code === 'string' ? body.code : '';
    const language = typeof body?.language === 'string' ? body.language : undefined;
    if (!code) {
      res.status(400).json({ ok: false, error: '缺少 code' });
      return;
    }
    const errors = lintSnippet(code, language);
    res.json({ ok: true, errors, clean: errors.length === 0 });
  });

  /* ========== 阶段一-2：补全 Pro API ========== */
  // 记录用户接受的补全（用于连续推荐）
  app.post('/api/completion/accept', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const filePath = typeof body?.filePath === 'string' ? body.filePath.trim() : '';
    const cursorOffset = typeof body?.cursorOffset === 'number' ? body.cursorOffset : 0;
    const text = typeof body?.text === 'string' ? body.text : '';
    if (!filePath || !text) { res.status(400).json({ ok: false, error: '缺少 filePath 或 text' }); return; }
    if (!completionEngine) { res.json({ ok: false, error: '补全引擎未初始化' }); return; }
    try {
      completionEngine.recordAcceptance(filePath, cursorOffset, text);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  // 推荐下一个改动点（补全 Pro 连续推荐）
  app.post('/api/completion/suggest-next', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const filePath = typeof body?.filePath === 'string' ? body.filePath.trim() : '';
    const fileContent = typeof body?.fileContent === 'string' ? body.fileContent : '';
    const cursorOffset = typeof body?.cursorOffset === 'number' ? body.cursorOffset : fileContent.length;
    if (!filePath || !fileContent) { res.status(400).json({ ok: false, error: '缺少 filePath 或 fileContent' }); return; }
    if (!completionEngine) { res.json({ ok: true, suggested: false }); return; }
    try {
      const suggestion = completionEngine.suggestNext(filePath, fileContent, cursorOffset);
      res.json({ ok: true, ...suggestion });
    } catch (e) { res.status(500).json({ ok: false, error: (e as Error).message }); }
  });

  /* ========== P2-1: 设计稿转代码 API（多模态，图片→代码） ========== */
  // P1-3: 设计稿转代码引擎状态查询
  app.get('/api/design-to-code', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      configured: !!designToCodeEngine,
      framework: designToCodeEngine ? 'html' : null,
      note: designToCodeEngine ? '已配置多模态模型' : '未配置多模态模型（POST /api/design-to-code 需 vision 模型）',
    });
  });
  app.post('/api/design-to-code', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const image = typeof body?.image === 'string' ? body.image.trim() : '';
    const framework = body?.framework || 'html';
    const instructions = typeof body?.instructions === 'string' ? body.instructions : undefined;
    const previousCode = typeof body?.previousCode === 'string' ? body.previousCode : undefined;
    const feedback = typeof body?.feedback === 'string' ? body.feedback : undefined;

    if (!image) {
      res.status(400).json({ ok: false, error: '缺少 image 字段（base64 或 URL）' });
      return;
    }
    if (!designToCodeEngine) {
      res.status(503).json({ ok: false, error: '未配置多模态模型。请在模型设置中添加支持 vision 能力的模型（如 GPT-4V、Claude 3、通义千问 VL 等）。' });
      return;
    }

    try {
      const result = await designToCodeEngine.generate({
        image,
        framework,
        instructions,
        previousCode,
        feedback,
      });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  /* ========== 大模型配置（三重加密：apiKey AES-256-GCM 落盘加密 + RSA 加密传输） ========== */
  const modelsFile = join(homeDir, 'models.json');
  interface ModelConfig {
    id: string;
    name: string;
    apiBase: string;
    apiKey: string; // 存储层为 AES-256-GCM 密文（v1:...），对外永不明文返回
    reasoning?: string;
    default?: boolean;
  }
  function loadModels(): ModelConfig[] {
    const list = loadJsonFile<ModelConfig[]>(modelsFile, []);
    return Array.isArray(list) ? list : [];
  }
  /** 解析真实（解密）apiKey，供任务执行器使用 */
  function resolveApiKey(m: ModelConfig): string {
    if (!m.apiKey) return '';
    return isEncrypted(m.apiKey) ? decryptText(m.apiKey, masterKey) : m.apiKey;
  }
  /** 对外脱敏视图：任何接口都不返回密钥（明文或密文） */
  function publicModel(m: ModelConfig): ModelConfig {
    return { ...m, apiKey: '' };
  }
  function saveModels(list: ModelConfig[]): boolean {
    // 明文 key 加密后再落盘（已加密的跳过，避免二次加密）
    const encList = list.map((m) =>
      m.apiKey && !isEncrypted(m.apiKey) ? { ...m, apiKey: encryptText(m.apiKey, masterKey) } : m,
    );
    const ok = saveJsonFile(modelsFile, encList);
    // 同步更新任务队列的模型配置，使用解密后的真实 key（即使落盘失败也更新内存态）
    queue.setModelProviders(encList.map((m) => ({
      id: m.id,
      type: 'openai-compatible' as const,
      baseURL: m.apiBase,
      apiKey: resolveApiKey(m),
      model: m.name,
    })));
    // P2: 同步更新补全引擎
    rebuildCompletionEngine(encList);
    return ok;
  }
  // 初始化模型提供列表，并注册到任务队列
  const initialModels = loadModels();
  queue.setModelProviders(initialModels.map((m) => ({
    id: m.id,
    type: 'openai-compatible' as const,
    baseURL: m.apiBase,
    apiKey: resolveApiKey(m),
    model: m.name,
  })));

  /* ========== P2: CompletionEngine（供 /api/completion 使用；共享 ModelRouter 在模块级） ========== */
  let completionEngine: CompletionEngine | null = null;
  // P2-1: 设计稿转代码引擎（多模态）
  let designToCodeEngine: DesignToCodeEngine | null = null;

  function rebuildCompletionEngine(models: ModelConfig[]): void {
    try {
      const providers = models
        .filter((m) => m.apiBase && m.name)
        .map((m) => new OpenAICompatibleProvider({
          id: m.id,
          type: 'openai-compatible',
          baseURL: m.apiBase,
          apiKey: resolveApiKey(m),
          model: m.name,
          tags: ['code-gen', 'cheap'],
        }));
      if (!providers.length) {
        sharedModelRouter = null;
        completionEngine = null;
        designToCodeEngine = null;
        return;
      }
      sharedModelRouter = new ModelRouter(providers, 'capability', 1.0);
      // 阶段一-1：构建代码图谱，用于跨文件上下文注入
      const codeGraph = buildCodeGraph(deps.getServerWorkspaceDir(), { maxFiles: 500 });
      completionEngine = createCompletionEngine(sharedModelRouter, {
        maxPrefixChars: 1500,
        maxSuffixChars: 500,
        quickMaxTokens: 64,
        fullMaxTokens: 256,
        cacheTtlMs: 10000,
        enableSyntaxCheck: true,
      }, codeGraph);
      // P2-1: 更新设计稿转代码引擎的模型提供者
      designToCodeEngine = createDesignToCodeEngine(providers);
    } catch (e) {
      console.error('[completion] rebuild failed:', e);
      sharedModelRouter = null;
      completionEngine = null;
      designToCodeEngine = null;
    }
  }

  // 初始化时构建
  rebuildCompletionEngine(initialModels);
  // 第二重（通信层）：向客户端下发 RSA 公钥，用于加密敏感参数（如模型 API Key）传输
  app.get('/api/security/public-key', (_req: Request, res: Response) => {
    res.json({ ok: true, publicKey: rsaKeys.publicKey, algorithm: 'RSA-OAEP-2048-SHA256' });
  });
  app.get('/api/models', (_req: Request, res: Response) => {
    const list = loadModels().map(publicModel);
    res.json({ ok: true, models: list, defaultId: (list.find((m) => m.default) || {}).id || null });
  });
  // P1-3: 模型提供商聚合视图（按 apiBase 分组）
  app.get('/api/models/providers', (_req: Request, res: Response) => {
    const list = loadModels().map(publicModel);
    const byKey = new Map<string, { providerId: string; apiBase: string; models: ModelConfig[]; count: number }>();
    for (const m of list) {
      const key = m.apiBase || 'custom';
      let entry = byKey.get(key);
      if (!entry) {
        entry = { providerId: key, apiBase: key, models: [], count: 0 };
        byKey.set(key, entry);
      }
      entry.models.push(m);
      entry.count++;
    }
    res.json({ ok: true, providers: Array.from(byKey.values()), total: list.length });
  });
  app.post('/api/models', (req: Request, res: Response) => {
    const body = req.body as Record<string, any>;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const apiBase = typeof body?.apiBase === 'string' ? body.apiBase.trim() : '';
    let apiKey = typeof body?.apiKey === 'string' ? body.apiKey : '';
    // 支持 RSA 公钥加密传输的密钥（App 端使用，防窃听/防中间人截取明文 Key）
    if (typeof body?.apiKeyEnc === 'string' && body.apiKeyEnc) {
      const dec = rsaDecrypt(body.apiKeyEnc, rsaKeys.privateKey);
      if (dec) apiKey = dec;
    }
    const reasoning = typeof body?.reasoning === 'string' ? body.reasoning : '';
    if (!name) {
      res.status(400).json({ ok: false, error: '请填写模型名称' });
      return;
    }
    const list = loadModels();
    const id = typeof body?.id === 'string' && body.id.trim() ? body.id.trim() : randomUUID();
    const idx = list.findIndex((m) => m.id === id);
    let saved: ModelConfig;
    if (idx >= 0) {
      // 编辑场景：未提供新 key 则保留原密钥（前端不再回填明文）
      const cfg: ModelConfig = {
        id, name, apiBase,
        apiKey: apiKey || list[idx].apiKey,
        reasoning,
      };
      list[idx] = { ...list[idx], ...cfg };
      saved = list[idx];
    } else {
      saved = { id, name, apiBase, apiKey, reasoning };
      list.push(saved);
    }
    if (!saveModels(list)) {
      res.status(500).json({ ok: false, error: '模型配置保存失败（磁盘不可写，已保留内存态）' });
      return;
    }
    res.json({ ok: true, model: publicModel(saved) });
  });
  app.delete('/api/models/:id', (req: Request, res: Response) => {
    let list = loadModels();
    const target = list.find((m) => m.id === req.params.id);
    list = list.filter((m) => m.id !== req.params.id);
    // 若删除的是默认，且没有其它默认，则把第一个设为默认
    if (target?.default && !list.some((m) => m.default) && list.length) list[0].default = true;
    if (!saveModels(list)) {
      res.status(500).json({ ok: false, error: '模型配置保存失败（磁盘不可写，已保留内存态）' });
      return;
    }
    res.json({ ok: true });
  });
  app.post('/api/models/:id/default', (req: Request, res: Response) => {
    const list = loadModels();
    const target = list.find((m) => m.id === req.params.id);
    if (!target) {
      res.status(404).json({ ok: false, error: '模型不存在' });
      return;
    }
    list.forEach((m) => (m.default = m.id === req.params.id));
    if (!saveModels(list)) {
      res.status(500).json({ ok: false, error: '模型配置保存失败（磁盘不可写，已保留内存态）' });
      return;
    }
    res.json({ ok: true, defaultId: target.id });

  });

}
