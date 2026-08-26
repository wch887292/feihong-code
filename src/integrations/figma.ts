/**
 * 飞虹 Code - Figma 设计稿集成 (阶段三-3)
 *
 * 增强设计稿转代码能力：
 * - Figma API 集成：直接从 Figma 文件获取设计数据
 * - 组件识别：自动识别按钮、输入框、卡片等常见组件
 * - 样式提取：颜色、字体、间距、阴影等设计令牌
 * - 布局分析：Flex/Grid 布局自动识别
 * - 代码生成：基于设计数据生成更高质量的前端代码
 */
import { logger } from '../shared/logger';

/** Figma 配置 */
export interface FigmaConfig {
  /** Figma Personal Access Token */
  accessToken: string;
  /** Figma API 基础 URL */
  apiBase?: string;
}

/** Figma 节点类型 */
export type FigmaNodeType =
  | 'DOCUMENT' | 'CANVAS' | 'FRAME' | 'GROUP' | 'SECTION'
  | 'RECTANGLE' | 'LINE' | 'ELLIPSE' | 'POLYGON' | 'STAR' | 'VECTOR'
  | 'TEXT' | 'SLICE' | 'COMPONENT' | 'COMPONENT_SET' | 'INSTANCE'
  | 'BOOLEAN_OPERATION' | 'STICKY' | 'CONNECTOR' | 'SHAPE_WITH_TEXT' | 'CODE_BLOCK';

/** Figma 颜色 */
export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Figma 矩形边界 */
export interface FigmaBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Figma 节点 */
export interface FigmaNode {
  id: string;
  name: string;
  type: FigmaNodeType;
  absoluteBoundingBox?: FigmaBoundingBox;
  children?: FigmaNode[];
  fills?: any[];
  strokes?: any[];
  strokeWeight?: number;
  cornerRadius?: number;
  effects?: any[];
  style?: any;
  characters?: string;
  componentId?: string;
}

/** Figma 文件数据 */
export interface FigmaFile {
  document: FigmaNode;
  name: string;
  lastModified: string;
  version: string;
  role: string;
  editorType: string;
  linkAccess: string;
}

/** 提取的设计令牌 */
export interface DesignTokens {
  colors: Array<{ name: string; value: string; usage: string }>;
  typography: Array<{ name: string; fontFamily: string; fontSize: number; fontWeight: number; lineHeight: number }>;
  spacing: Array<{ name: string; value: number }>;
  borderRadius: Array<{ name: string; value: number }>;
  shadows: Array<{ name: string; value: string }>;
}

/** 识别的 UI 组件 */
export interface UIComponent {
  type: 'button' | 'input' | 'card' | 'navbar' | 'sidebar' | 'modal' | 'list' | 'table' | 'icon' | 'text' | 'image' | 'container' | 'unknown';
  node: FigmaNode;
  name: string;
  props: Record<string, any>;
  children: UIComponent[];
}

/** 代码生成结果 */
export interface FigmaCodeResult {
  framework: 'html' | 'react' | 'vue' | 'tailwind';
  html: string;
  css: string;
  js?: string;
  components: UIComponent[];
  tokens: DesignTokens;
  assets: Array<{ name: string; url: string }>;
}

/**
 * Figma 集成
 */
export class FigmaIntegration {
  private config: FigmaConfig;
  private apiBase: string;

  constructor(config: FigmaConfig) {
    this.config = config;
    this.apiBase = config.apiBase || 'https://api.figma.com/v1';
  }

  /**
   * 获取 Figma 文件
   */
  async getFile(fileKey: string): Promise<FigmaFile> {
    const response = await fetch(`${this.apiBase}/files/${fileKey}`, {
      headers: { 'X-Figma-Token': this.config.accessToken },
    });
    if (!response.ok) {
      throw new Error(`获取 Figma 文件失败: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * 获取 Figma 节点
   */
  async getNode(fileKey: string, nodeId: string): Promise<FigmaNode> {
    const response = await fetch(`${this.apiBase}/files/${fileKey}/nodes?ids=${nodeId}`, {
      headers: { 'X-Figma-Token': this.config.accessToken },
    });
    if (!response.ok) {
      throw new Error(`获取 Figma 节点失败: ${response.statusText}`);
    }
    const data = await response.json() as any;
    return data.nodes[nodeId].document;
  }

  /**
   * 获取 Figma 图片
   */
  async getImage(fileKey: string, nodeId: string, format: 'png' | 'jpg' | 'svg' = 'png', scale = 2): Promise<string> {
    const response = await fetch(`${this.apiBase}/images/${fileKey}?ids=${nodeId}&format=${format}&scale=${scale}`, {
      headers: { 'X-Figma-Token': this.config.accessToken },
    });
    if (!response.ok) {
      throw new Error(`获取 Figma 图片失败: ${response.statusText}`);
    }
    const data = await response.json() as any;
    return data.images[nodeId];
  }

  /**
   * 颜色转换：Figma RGBA -> CSS hex/rgba
   */
  colorToCss(color: FigmaColor): string {
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    if (color.a >= 1) {
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }
    return `rgba(${r}, ${g}, ${b}, ${color.a.toFixed(2)})`;
  }

  /**
   * 提取设计令牌
   */
  extractDesignTokens(node: FigmaNode): DesignTokens {
    const tokens: DesignTokens = {
      colors: [],
      typography: [],
      spacing: [],
      borderRadius: [],
      shadows: [],
    };

    const colorMap = new Map<string, number>();
    const typeMap = new Map<string, number>();

    const traverse = (n: FigmaNode) => {
      // 提取颜色
      if (n.fills) {
        for (const fill of n.fills) {
          if (fill.type === 'SOLID' && fill.color) {
            const color = this.colorToCss(fill.color);
            colorMap.set(color, (colorMap.get(color) || 0) + 1);
          }
        }
      }

      // 提取字体
      if (n.style && n.type === 'TEXT') {
        const key = `${n.style.fontFamily}-${n.style.fontSize}-${n.style.fontWeight}`;
        typeMap.set(key, (typeMap.get(key) || 0) + 1);
        if (n.style.fontFamily && n.style.fontSize) {
          tokens.typography.push({
            name: n.name,
            fontFamily: n.style.fontFamily,
            fontSize: n.style.fontSize,
            fontWeight: n.style.fontWeight || 400,
            lineHeight: n.style.lineHeightPx || n.style.fontSize * 1.5,
          });
        }
      }

      // 提取圆角
      if (n.cornerRadius !== undefined) {
        tokens.borderRadius.push({ name: n.name, value: n.cornerRadius });
      }

      // 提取阴影
      if (n.effects) {
        for (const effect of n.effects) {
          if (effect.type === 'DROP_SHADOW' && effect.visible) {
            const shadow = `${effect.offset.x}px ${effect.offset.y}px ${effect.radius}px ${this.colorToCss(effect.color)}`;
            tokens.shadows.push({ name: n.name, value: shadow });
          }
        }
      }

      if (n.children) {
        for (const child of n.children) traverse(child);
      }
    };

    traverse(node);

    // 按使用频率排序颜色
    tokens.colors = Array.from(colorMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([value, count], i) => ({
        name: `color-${i + 1}`,
        value,
        usage: `使用 ${count} 次`,
      }));

    return tokens;
  }

  /**
   * 识别 UI 组件
   */
  identifyComponents(node: FigmaNode): UIComponent[] {
    const components: UIComponent[] = [];

    const identify = (n: FigmaNode): UIComponent => {
      let type: UIComponent['type'] = 'unknown';
      const props: Record<string, any> = {};

      const name = n.name.toLowerCase();

      // 基于名称识别
      if (name.includes('button') || name.includes('btn')) type = 'button';
      else if (name.includes('input') || name.includes('field') || name.includes('textfield')) type = 'input';
      else if (name.includes('card')) type = 'card';
      else if (name.includes('navbar') || name.includes('header') || name.includes('nav')) type = 'navbar';
      else if (name.includes('sidebar') || name.includes('sidenav')) type = 'sidebar';
      else if (name.includes('modal') || name.includes('dialog') || name.includes('popup')) type = 'modal';
      else if (name.includes('list') || name.includes('menu')) type = 'list';
      else if (name.includes('table')) type = 'table';
      else if (name.includes('icon')) type = 'icon';
      else if (n.type === 'TEXT') type = 'text';
      else if (n.type === 'RECTANGLE' || n.type === 'FRAME' || n.type === 'GROUP') type = 'container';

      // 基于特征识别
      if (n.type === 'TEXT' && n.characters) {
        type = 'text';
        props.text = n.characters;
      }

      // 提取尺寸
      if (n.absoluteBoundingBox) {
        props.width = n.absoluteBoundingBox.width;
        props.height = n.absoluteBoundingBox.height;
      }

      // 提取样式
      if (n.fills && n.fills[0]?.type === 'SOLID') {
        props.backgroundColor = this.colorToCss(n.fills[0].color);
      }
      if (n.cornerRadius !== undefined) props.borderRadius = n.cornerRadius;
      if (n.strokeWeight) props.borderWidth = n.strokeWeight;

      const children = n.children ? n.children.map(identify) : [];

      return { type, node: n, name: n.name, props, children };
    };

    const traverse = (n: FigmaNode) => {
      const component = identify(n);
      if (component.type !== 'unknown' && component.type !== 'container') {
        components.push(component);
      }
      if (n.children) {
        for (const child of n.children) traverse(child);
      }
    };

    traverse(node);
    return components;
  }

  /**
   * 生成 Tailwind CSS 代码
   */
  generateTailwindCode(node: FigmaNode, _tokens: DesignTokens): string {
    const components = this.identifyComponents(node);

    const generateComponent = (comp: UIComponent, indent = 0): string => {
      const pad = '  '.repeat(indent);
      const classes: string[] = [];

      // 尺寸
      if (comp.props.width) classes.push(`w-[${Math.round(comp.props.width)}px]`);
      if (comp.props.height) classes.push(`h-[${Math.round(comp.props.height)}px]`);

      // 背景色
      if (comp.props.backgroundColor) classes.push(`bg-[${comp.props.backgroundColor}]`);

      // 圆角
      if (comp.props.borderRadius) classes.push(`rounded-[${comp.props.borderRadius}px]`);

      // 边框
      if (comp.props.borderWidth) classes.push(`border-[${comp.props.borderWidth}px]`);

      // 布局
      if (comp.children.length > 0) classes.push('flex flex-col');

      const childrenHtml = comp.children.map((c) => generateComponent(c, indent + 1)).join('\n');

      if (comp.type === 'text') {
        return `${pad}<p class="${classes.join(' ')}">${comp.props.text || ''}</p>`;
      }

      if (comp.type === 'button') {
        return `${pad}<button class="${classes.join(' ')} px-4 py-2 font-medium cursor-pointer hover:opacity-90 transition">\n${childrenHtml || pad + '  Button'}\n${pad}</button>`;
      }

      if (comp.type === 'input') {
        return `${pad}<input type="text" class="${classes.join(' ')} px-3 py-2 border border-gray-300 rounded" placeholder="${comp.name}" />`;
      }

      if (comp.type === 'card') {
        return `${pad}<div class="${classes.join(' ')} p-4 shadow-md">\n${childrenHtml}\n${pad}</div>`;
      }

      return `${pad}<div class="${classes.join(' ')}">\n${childrenHtml}\n${pad}</div>`;
    };

    const rootComponents = components.filter((c) =>
      !components.some((other) => other.children.includes(c))
    );

    return rootComponents.map((c) => generateComponent(c)).join('\n');
  }

  /**
   * 从 Figma 文件生成代码
   */
  async generateCode(fileKey: string, nodeId?: string, framework: 'html' | 'react' | 'vue' | 'tailwind' = 'tailwind'): Promise<FigmaCodeResult> {
    logger.info('figma generate code', { fileKey, nodeId, framework });

    let rootNode: FigmaNode;
    if (nodeId) {
      rootNode = await this.getNode(fileKey, nodeId);
    } else {
      const file = await this.getFile(fileKey);
      rootNode = file.document;
    }

    const tokens = this.extractDesignTokens(rootNode);
    const components = this.identifyComponents(rootNode);

    let html = '';
    let css = '';

    if (framework === 'tailwind') {
      html = this.generateTailwindCode(rootNode, tokens);
    } else {
      // 简化的 HTML 生成
      html = `<!DOCTYPE html>\n<html>\n<head>\n<style>\n${this.generateCSS(tokens)}\n</style>\n</head>\n<body>\n<div class="container">\n${this.generateHTML(rootNode)}\n</div>\n</body>\n</html>`;
    }

    return {
      framework,
      html,
      css,
      components,
      tokens,
      assets: [],
    };
  }

  private generateCSS(tokens: DesignTokens): string {
    let css = ':root {\n';
    for (const color of tokens.colors.slice(0, 10)) {
      css += `  --${color.name}: ${color.value};\n`;
    }
    css += '}\n\n';
    css += '.container { max-width: 1200px; margin: 0 auto; padding: 20px; }\n';
    return css;
  }

  private generateHTML(node: FigmaNode, indent = 0): string {
    const pad = '  '.repeat(indent);
    const children = node.children ? node.children.map((c) => this.generateHTML(c, indent + 1)).join('\n') : '';
    const text = node.type === 'TEXT' && node.characters ? node.characters : '';
    return `${pad}<div class="${node.type.toLowerCase()}">${text}${children ? '\n' + children + '\n' + pad : ''}</div>`;
  }
}

/**
 * 便捷函数：创建 Figma 集成
 */
export function createFigmaIntegration(config: FigmaConfig): FigmaIntegration {
  return new FigmaIntegration(config);
}
