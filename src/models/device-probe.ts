/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 设备探测：探测宿主 Ollama 是否可达，并识别 GPU 后端。
 * 全部 fail-open：任何探测失败都降级为 CPU，不抛错，不影响主流程。
 */

export interface OllamaTag {
  name: string;
  model?: string;
  size?: number;
  digest?: string;
  details?: {
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
}

export interface OllamaTagsResponse {
  models?: OllamaTag[];
}

export interface DeviceProbeResult {
  /** Ollama 是否可达 */
  available: boolean;
  /** 探测到的 Ollama 版本（未知为空） */
  version: string;
  /** GPU 后端：nvidia / rocm / cpu（探测失败一律降级 cpu） */
  gpu: 'nvidia' | 'rocm' | 'cpu';
  /** 已安装的本地模型名列表 */
  models: string[];
  /** 探测耗时（ms） */
  latencyMs: number;
}

const DEFAULT_BASE_URL = 'http://localhost:11434';

/** 从 /api/tags 响应中提取模型名（兼容 name 与 model 字段） */
function extractModelNames(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const models = (payload as OllamaTagsResponse).models;
  if (!Array.isArray(models)) return [];
  const names: string[] = [];
  for (const m of models) {
    if (m && typeof m === 'object') {
      const name = typeof m.name === 'string' ? m.name : typeof m.model === 'string' ? m.model : '';
      if (name) names.push(name);
    }
  }
  return names;
}

/**
 * 探测宿主 Ollama：
 *  - GET {baseUrl}/api/tags 判断可达性并收集已安装模型
 *  - GET {baseUrl}/api/version 获取版本
 *  - 探测 GPU 后端：Windows 主抓 nvidia（NVIDIA_SMI / nvidia-smi 命令）与 rocm（HIP/ROCm 特征）
 *  - 任何失败均 fail-open 降级为 CPU，不抛错
 */
export async function probeOllama(baseUrl: string = DEFAULT_BASE_URL): Promise<DeviceProbeResult> {
  const started = Date.now();
  const normalized = baseUrl.replace(/\/$/, '');
  const result: DeviceProbeResult = {
    available: false,
    version: '',
    gpu: 'cpu',
    models: [],
    latencyMs: 0,
  };

  // 1. 探测可达性 + 已安装模型
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let res: Response;
    try {
      res = await fetch(`${normalized}/api/tags`, {
        method: 'GET',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) {
      const payload: unknown = await res.json().catch(() => undefined);
      result.models = extractModelNames(payload);
      result.available = true;
    }
  } catch {
    // 不可达：保持 available=false，gpu 降级 cpu
  }

  // 2. 获取版本（失败不影响 available）
  if (result.available) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      let res: Response;
      try {
        res = await fetch(`${normalized}/api/version`, {
          method: 'GET',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (res.ok) {
        const payload: unknown = await res.json().catch(() => undefined);
        if (payload && typeof payload === 'object') {
          const version = (payload as { version?: unknown }).version;
          if (typeof version === 'string') result.version = version;
        }
      }
    } catch {
      // 版本探测失败忽略
    }
  }

  // 3. 探测 GPU 后端（Windows 主抓 nvidia 与 rocm 特征，失败一律降级 cpu）
  result.gpu = await detectGpuBackend();

  result.latencyMs = Date.now() - started;
  return result;
}

/**
 * 探测 GPU 后端：
 *  - 优先 nvidia-smi（NVIDIA 显卡）
 *  - 其次检查 ROCm 特征（HIP_VISIBLE_DEVICES / rocm-smi / hipInfo）
 *  - 全部失败或未命中返回 cpu
 */
async function detectGpuBackend(): Promise<'nvidia' | 'rocm' | 'cpu'> {
  try {
    const nvidia = await detectNvidia();
    if (nvidia) return 'nvidia';
  } catch {
    // 忽略，继续探测 rocm
  }
  try {
    const rocm = await detectRocm();
    if (rocm) return 'rocm';
  } catch {
    // 忽略，降级 cpu
  }
  return 'cpu';
}

/** 检测 NVIDIA GPU：优先 nvidia-smi 命令，其次 NVIDIA_VISIBLE_DEVICES 环境变量 */
async function detectNvidia(): Promise<boolean> {
  // 环境变量特征（容器/CI 常见）
  if (process.env.NVIDIA_VISIBLE_DEVICES && process.env.NVIDIA_VISIBLE_DEVICES !== 'void') {
    return true;
  }
  // 命令探测：nvidia-smi 存在且能输出
  try {
    const { execFile } = await import('child_process');
    const out = await new Promise<string>((resolve, reject) => {
      execFile(
        process.platform === 'win32' ? 'nvidia-smi.exe' : 'nvidia-smi',
        ['--query-gpu=name', '--format=csv,noheader'],
        { timeout: 5000, windowsHide: true },
        (err, stdout) => (err ? reject(err) : resolve(stdout)),
      );
    });
    return typeof out === 'string' && out.trim().length > 0;
  } catch {
    return false;
  }
}

/** 检测 ROCm：优先 rocm-smi / hipInfo 命令，其次 HIP 环境变量 */
async function detectRocm(): Promise<boolean> {
  // 环境变量特征
  if (process.env.HIP_VISIBLE_DEVICES && process.env.HIP_VISIBLE_DEVICES !== 'void') {
    return true;
  }
  if (process.env.ROCM_HOME) return true;
  // 命令探测
  try {
    const { execFile } = await import('child_process');
    const candidates = process.platform === 'win32' ? ['rocm-smi.exe', 'hipInfo.exe'] : ['rocm-smi', 'hipInfo'];
    for (const cmd of candidates) {
      try {
        const out = await new Promise<string>((resolve, reject) => {
          execFile(cmd, [], { timeout: 5000, windowsHide: true }, (err, stdout) =>
            err ? reject(err) : resolve(stdout),
          );
        });
        if (typeof out === 'string' && out.trim().length > 0) return true;
      } catch {
        // 该命令不可用，尝试下一个
      }
    }
  } catch {
    return false;
  }
  return false;
}