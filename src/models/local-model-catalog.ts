/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 本地模型目录：推荐开源模型元数据。
 * 本地模型自包含能力走宿主 Ollama，不捆绑任何二进制或模型文件进包，
 * 这里只提供元数据供配置与提示使用。
 */

export interface LocalModelMeta {
  /** 模型标识（Ollama 拉取名，如 qwen2.5:7b） */
  id: string;
  /** 模型体积（GB，近似量化后大小） */
  sizeGb: number;
  /** 推荐量化精度 */
  quantization: string;
  /** 适用场景（代码/推理/通用） */
  useCase: string;
  /** 能力标签，与 CapabilityTag 对齐 */
  tags: string[];
  /** 一句话说明 */
  description: string;
}

/** 推荐开源模型目录（2-3 个，覆盖代码/推理/通用三类场景） */
export const LOCAL_MODEL_CATALOG: LocalModelMeta[] = [
  {
    id: 'qwen2.5:7b',
    sizeGb: 4.7,
    quantization: 'Q4_K_M',
    useCase: '通用代码与文本生成',
    tags: ['code-gen', 'reasoning', 'local'],
    description: '阿里 Qwen2.5 7B，中文与代码能力均衡，适合本地开发辅助。',
  },
  {
    id: 'deepseek-r1:8b',
    sizeGb: 4.9,
    quantization: 'Q4_K_M',
    useCase: '深度推理与复杂分析',
    tags: ['reasoning', 'local'],
    description: 'DeepSeek R1 蒸馏 8B，擅长链式推理与数学逻辑。',
  },
  {
    id: 'llama3.1:8b',
    sizeGb: 4.7,
    quantization: 'Q4_K_M',
    useCase: '通用英文对话与指令跟随',
    tags: ['code-gen', 'local'],
    description: 'Meta Llama 3.1 8B，英文指令跟随与通用对话表现稳定。',
  },
];

/** 获取推荐模型目录（返回副本，避免外部修改常量） */
export function getLocalModelCatalog(): LocalModelMeta[] {
  return [...LOCAL_MODEL_CATALOG];
}

/** 按模型 id 查找元数据 */
export function findLocalModel(id: string): LocalModelMeta | undefined {
  return LOCAL_MODEL_CATALOG.find((m) => m.id === id);
}