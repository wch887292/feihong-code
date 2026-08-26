/**
 * 飞虹 Code - 专用补全模型训练数据准备脚本 (阶段一-3)
 *
 * 使用飞虹 Code 自身代码库生成 FIM 训练数据，用于专用补全模型 LoRA 微调。
 *
 * 用法：
 *   node scripts/prepare-fim-data.mjs
 *   node scripts/prepare-fim-data.mjs --source-dir ./src --output ./data/fim/dataset.jsonl
 */
import { prepareFimData } from '../dist/training/fim-data.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {
    sourceDir: resolve(projectRoot, 'src'),
    outputPath: resolve(projectRoot, 'data/fim/dataset.jsonl'),
    samplesPerFile: 10,
    maxFileSize: 100 * 1024,
    languages: ['typescript', 'javascript'],
    trainRatio: 0.9,
    seed: 42,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--source-dir':
        params.sourceDir = resolve(args[++i]);
        break;
      case '--output':
        params.outputPath = resolve(args[++i]);
        break;
      case '--samples-per-file':
        params.samplesPerFile = parseInt(args[++i], 10);
        break;
      case '--max-file-size':
        params.maxFileSize = parseInt(args[++i], 10);
        break;
      case '--languages':
        params.languages = args[++i].split(',').map((s) => s.trim());
        break;
      case '--train-ratio':
        params.trainRatio = parseFloat(args[++i]);
        break;
      case '--seed':
        params.seed = parseInt(args[++i], 10);
        break;
      case '--help':
      case '-h':
        console.log(`
飞虹 Code - FIM 训练数据准备

用法:
  node scripts/prepare-fim-data.mjs [选项]

选项:
  --source-dir <path>     源代码目录 (默认: ./src)
  --output <path>         输出文件路径 (默认: ./data/fim/dataset.jsonl)
  --samples-per-file <n>  每个文件生成的样本数 (默认: 10)
  --max-file-size <n>     最大文件大小字节 (默认: 102400)
  --languages <list>      语言列表，逗号分隔 (默认: typescript,javascript)
  --train-ratio <n>       训练集比例 (默认: 0.9)
  --seed <n>              随机种子 (默认: 42)
  -h, --help              显示帮助
`);
        process.exit(0);
    }
  }

  return params;
}

async function main() {
  const config = parseArgs();

  console.log('=== 飞虹 Code FIM 训练数据准备 ===');
  console.log(`源代码目录: ${config.sourceDir}`);
  console.log(`输出路径: ${config.outputPath}`);
  console.log(`每文件样本数: ${config.samplesPerFile}`);
  console.log(`语言: ${config.languages.join(', ')}`);
  console.log(`训练集比例: ${config.trainRatio}`);
  console.log('');

  // 确保输出目录存在
  const outputDir = dirname(config.outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  try {
    const result = prepareFimData({
      sourceDir: config.sourceDir,
      outputPath: config.outputPath,
      samplesPerFile: config.samplesPerFile,
      maxFileSize: config.maxFileSize,
      languages: config.languages,
      trainRatio: config.trainRatio,
      seed: config.seed,
    });

    console.log('=== 数据准备完成 ===');
    console.log(`扫描文件数: ${result.totalFiles}`);
    console.log(`训练集样本数: ${result.trainCount}`);
    console.log(`验证集样本数: ${result.valCount}`);
    console.log('');
    console.log('输出文件:');
    console.log(`  训练集: ${config.outputPath.replace('.jsonl', '.train.jsonl')}`);
    console.log(`  验证集: ${config.outputPath.replace('.jsonl', '.val.jsonl')}`);
    console.log(`  元数据: ${config.outputPath.replace('.jsonl', '.meta.json')}`);
    console.log('');
    console.log('下一步: 使用 training/train.py 进行 LoRA 微调');
    console.log('  python training/train.py --config training/lora-config.json');
  } catch (error) {
    console.error('数据准备失败:', error.message);
    process.exit(1);
  }
}

main();
