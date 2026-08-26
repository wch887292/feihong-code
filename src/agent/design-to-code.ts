/**
 * 飞虹 Code - 设计稿转代码引擎 (P2-1)
 * 多模态能力：将设计稿截图/图片转换为 HTML/CSS/React/Vue 代码
 *
 * 支持：
 * - 图片输入（base64 或 URL）
 * - 目标框架选择（HTML/CSS、React、Vue、Tailwind）
 * - 代码生成 + 实时预览
 * - 多轮迭代修正
 */
import { OpenAICompatibleProvider } from '../models/providers/openai-compatible.provider';
import { logger } from '../shared/logger';

/** 目标框架 */
export type DesignTargetFramework = 'html' | 'react' | 'vue' | 'tailwind' | 'html-css';

/** 设计稿转代码请求 */
export interface DesignToCodeRequest {
  /** 图片 base64（data:image/png;base64,... 格式）或图片 URL */
  image: string;
  /** 目标框架 */
  framework?: DesignTargetFramework;
  /** 附加说明（如"使用深色主题"、"响应式设计"） */
  instructions?: string;
  /** 上一轮生成的代码（用于迭代修正） */
  previousCode?: string;
  /** 修正反馈（如"按钮颜色不对"、"布局需要调整"） */
  feedback?: string;
  /** 最大 token 数 */
  maxTokens?: number;
}

/** 设计稿转代码结果 */
export interface DesignToCodeResult {
  /** 生成的代码 */
  code: string;
  /** 代码语言（html/javascript/typescript/css） */
  language: string;
  /** 使用的模型 */
  model: string;
  /** 生成耗时（毫秒） */
  latencyMs: number;
  /** 框架说明 */
  framework: DesignTargetFramework;
  /** 预览 HTML（可直接在 iframe 中渲染） */
  previewHtml?: string;
}

/**
 * 设计稿转代码引擎
 */
export class DesignToCodeEngine {
  private providers: OpenAICompatibleProvider[] = [];

  constructor(providers: OpenAICompatibleProvider[] = []) {
    this.providers = providers;
  }

  /** 更新可用模型提供者 */
  setProviders(providers: OpenAICompatibleProvider[]): void {
    this.providers = providers;
  }

  /** 获取支持 vision 能力的模型 */
  private getVisionProvider(): OpenAICompatibleProvider | null {
    // 优先选择带 vision 标签的模型
    const visionProvider = this.providers.find((p) => p.tags.includes('vision'));
    if (visionProvider) return visionProvider;
    // 退而求其次：选择第一个 provider（假设 OpenAI 兼容接口大多支持多模态）
    return this.providers[0] || null;
  }

  /**
   * 将设计稿转换为代码
   */
  async generate(req: DesignToCodeRequest): Promise<DesignToCodeResult> {
    const startTime = Date.now();
    const framework = req.framework || 'html';

    const provider = this.getVisionProvider();
    if (!provider) {
      throw new Error('未配置可用的多模态模型。请在模型设置中添加支持 vision 能力的模型（如 GPT-4V、Claude 3、通义千问 VL 等）。');
    }

    // 构造系统提示
    const systemPrompt = this.buildSystemPrompt(framework);

    // 构造用户消息（多模态：文本 + 图片）
    const userContent = this.buildUserContent(req);

    // 直接调用 OpenAI 兼容的多模态 API
    try {
      const baseURL = (provider as any).baseURL as string;
      const apiKey = (provider as any).apiKey as string | undefined;
      const model = provider.model;

      const body = {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.2,
        max_tokens: req.maxTokens ?? 4096,
      };

      const resp = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`模型 API 错误 ${resp.status}: ${text.slice(0, 200)}`);
      }

      const data = await resp.json() as any;
      const rawContent = data.choices?.[0]?.message?.content || '';

      // 解析代码（去除 Markdown 代码块标记）
      const code = this.extractCode(rawContent, framework);

      // 生成预览 HTML
      const previewHtml = this.buildPreviewHtml(code, framework);

      const result: DesignToCodeResult = {
        code,
        language: this.getLanguage(framework),
        model,
        latencyMs: Date.now() - startTime,
        framework,
        previewHtml,
      };

      logger.info('design-to-code generated', {
        framework,
        model,
        latencyMs: result.latencyMs,
        codeLength: code.length,
      });

      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('design-to-code failed', { error: msg, framework });
      throw new Error(`设计稿转代码失败: ${msg}`);
    }
  }

  /** 构造系统提示 */
  private buildSystemPrompt(framework: DesignTargetFramework): string {
    const base = `你是一个专业的前端开发工程师，擅长将设计稿转换为高质量的代码。

请根据用户提供的设计稿图片，生成精确还原设计的代码。

要求：
1. 精确还原设计稿的布局、颜色、字体、间距
2. 代码结构清晰，有适当的注释
3. 使用语义化的 HTML 标签
4. 响应式设计，适配不同屏幕尺寸
5. 只输出代码，不要有任何解释说明`;

    const frameworkPrompts: Record<DesignTargetFramework, string> = {
      html: '输出完整的 HTML 文件，包含内联 CSS 和 JavaScript。使用 <!DOCTYPE html> 开头。',
      'html-css': '输出 HTML 和 CSS 代码。HTML 用 <div class="..."> 结构，CSS 用类选择器。',
      react: '输出 React 函数组件代码（JSX），使用内联样式或 CSS Modules。组件名使用 PascalCase。',
      vue: '输出 Vue 3 单文件组件代码（<template>、<script setup>、<style>）。',
      tailwind: '输出 HTML 代码，使用 Tailwind CSS 工具类。在 <head> 中引入 Tailwind CDN。',
    };

    return base + '\n\n' + (frameworkPrompts[framework] || frameworkPrompts.html);
  }

  /** 构造用户消息内容（多模态数组） */
  private buildUserContent(req: DesignToCodeRequest): Array<{ type: string; text?: string; image_url?: { url: string } }> {
    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

    // 文本部分
    let text = '请将这张设计稿转换为代码。';
    if (req.instructions) {
      text += `\n\n附加要求：${req.instructions}`;
    }
    if (req.previousCode && req.feedback) {
      text += `\n\n这是上一轮生成的代码：\n\`\`\`\n${req.previousCode}\n\`\`\`\n\n请根据以下反馈修正：${req.feedback}`;
    }

    content.push({ type: 'text', text });

    // 图片部分
    const imageUrl = req.image.startsWith('data:') || req.image.startsWith('http')
      ? req.image
      : `data:image/png;base64,${req.image}`;

    content.push({
      type: 'image_url',
      image_url: { url: imageUrl },
    });

    return content;
  }

  /** 从模型输出中提取代码 */
  private extractCode(rawContent: string, framework: DesignTargetFramework): string {
    // 尝试匹配 Markdown 代码块
    const codeBlockRegex = /```(?:\w+)?\n([\s\S]*?)```/;
    const match = rawContent.match(codeBlockRegex);
    if (match) {
      return match[1].trim();
    }

    // 如果没有代码块，检查是否以 <!DOCTYPE 或 <html 开头（HTML 框架）
    if (framework === 'html' || framework === 'tailwind') {
      const doctypeMatch = rawContent.match(/<!DOCTYPE[\s\S]*<\/html>/i);
      if (doctypeMatch) {
        return doctypeMatch[0].trim();
      }
    }

    // 退而求其次：返回原始内容（去除首尾空白）
    return rawContent.trim();
  }

  /** 获取代码语言 */
  private getLanguage(framework: DesignTargetFramework): string {
    switch (framework) {
      case 'react': return 'jsx';
      case 'vue': return 'vue';
      case 'tailwind': return 'html';
      case 'html-css': return 'html';
      default: return 'html';
    }
  }

  /** 构建预览 HTML（用于 iframe 渲染） */
  private buildPreviewHtml(code: string, framework: DesignTargetFramework): string {
    // HTML 框架：直接使用代码
    if (framework === 'html' || framework === 'tailwind') {
      // 如果代码已经包含 <!DOCTYPE 或 <html，直接返回
      if (code.includes('<!DOCTYPE') || code.includes('<html')) {
        return code;
      }
      // 否则包裹在完整 HTML 中
      return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>设计稿预览</title>
  ${framework === 'tailwind' ? '<script src="https://cdn.tailwindcss.com"></script>' : ''}
</head>
<body>
${code}
</body>
</html>`;
    }

    // React/Vue 框架：返回提示信息（需要构建工具才能预览）
    return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <title>设计稿预览</title>
  <style>
    body { font-family: -apple-system, sans-serif; padding: 40px; background: #f5f5f5; }
    .container { max-width: 800px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h2 { color: #333; }
    p { color: #666; line-height: 1.6; }
    pre { background: #f0f0f0; padding: 15px; border-radius: 4px; overflow-x: auto; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <h2>📋 ${framework.toUpperCase()} 组件代码已生成</h2>
    <p>此框架需要构建环境才能实时预览。请将以下代码复制到你的项目中：</p>
    <pre>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
  </div>
</body>
</html>`;
  }
}

/** 便捷函数：创建设计稿转代码引擎 */
export function createDesignToCodeEngine(providers: OpenAICompatibleProvider[] = []): DesignToCodeEngine {
  return new DesignToCodeEngine(providers);
}
