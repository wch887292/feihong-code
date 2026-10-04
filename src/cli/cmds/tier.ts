/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 算力档位命令（对标纳米Work 轻量/省钱/满血）：
 *   fhcode tier                查看当前档位与三档对照
 *   fhcode tier set <light|save|full>   锁定全局默认档位（写 fhcode.config.json）
 *   fhcode <目标> --tier <...>          单次任务覆盖
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ComputeTier } from '../../shared/types';
import { loadConfigFile, resolveHomeDir } from '../../shared/config';
import { TIERS, normalizeTier } from '../../models/tier';

function tierTable(): string {
  return (Object.keys(TIERS) as ComputeTier[])
    .map((k) => `  - ${k.padEnd(5)} ${TIERS[k].label}：${TIERS[k].desc}`)
    .join('\n');
}

export async function runTierCmd(action: 'get' | 'set' = 'get', value?: ComputeTier): Promise<void> {
  if (action === 'set') {
    const tier = normalizeTier(value);
    if (!tier) {
      console.error(`非法档位：${value ?? '(空)'}（可选 light / save / full）`);
      console.error(`\n可用档位：\n${tierTable()}`);
      process.exitCode = 1;
      return;
    }
    const file = join(resolveHomeDir(), 'fhcode.config.json');
    let cfg: { models?: { defaultTier?: ComputeTier } } = {};
    if (existsSync(file)) {
      try {
        cfg = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        cfg = {};
      }
    }
    cfg.models = { ...(cfg.models || {}), defaultTier: tier };
    writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    console.log(`✓ 已锁定全局算力档位为：${tier}（${TIERS[tier].label}）`);
    console.log('  后续任务默认走该档；可用 fhcode <目标> --tier <light|save|full> 单次覆盖');
    return;
  }

  // get：展示当前锁定状态 + 三档对照
  const fileCfg = loadConfigFile();
  const locked = normalizeTier(process.env.FH_TIER) || normalizeTier(fileCfg?.models?.defaultTier);
  console.log('飞虹 Code 算力档位（对标纳米Work 轻量 / 省钱 / 满血）');
  console.log(`\n可用档位：\n${tierTable()}`);
  if (locked) {
    console.log(`\n当前全局锁定档位：${locked}（${TIERS[locked].label}）`);
    console.log('未指定 --tier 时所有任务走该档。');
  } else {
    console.log('\n当前：未锁定（按目标复杂度自动分类：简单→轻量，较长→省钱，含硬关键词→满血）');
  }
  console.log('\n用法：');
  console.log('  fhcode tier                  查看当前档位与对照表');
  console.log('  fhcode tier set <档位>       锁定全局默认档位（写 fhcode.config.json）');
  console.log('  fhcode <目标> --tier <档位>  单次任务覆盖');
}
