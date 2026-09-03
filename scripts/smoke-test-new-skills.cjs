/**
 * 三个新技能综合冒烟测试
 * 验证：发现、加载、frontmatter格式、references完整性、触发词清晰度
 */
const fs = require('fs');
const path = require('path');
const { discoverSkills, loadSkillBody } = require('../dist/skills/skill-loader.js');

const SKILL_DIR = path.join(process.env.USERPROFILE || '~', '.feihong-code', 'skills');
const TARGETS = ['pua-ext', 'frontend-dev-guide', 'backend-dev-guide'];

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('=== 1. 技能发现 ===');
const skills = discoverSkills(process.cwd());
console.log('  本地总技能数: ' + skills.length);
for (const name of TARGETS) {
  const found = skills.find(s => s.name === name);
  check(name + ' 被发现', !!found, found ? found.file.split('\\').pop() : '');
}

console.log('\n=== 2. 正文加载 ===');
for (const name of TARGETS) {
  const body = loadSkillBody(skills, name);
  check(name + ' 正文可加载', !!body && body.length > 100, body ? body.length + ' 字符' : '');
}

console.log('\n=== 3. frontmatter 格式 ===');
for (const name of TARGETS) {
  const mdPath = path.join(SKILL_DIR, name, 'SKILL.md');
  const content = fs.readFileSync(mdPath, 'utf8');
  const hasName = /^name:\s*.+$/m.test(content);
  const hasDesc = /^description:\s*.+$/m.test(content);
  const hasFrontmatter = content.startsWith('---');
  check(name + ' frontmatter完整', hasName && hasDesc && hasFrontmatter,
    'name=' + hasName + ' desc=' + hasDesc + ' fence=' + hasFrontmatter);
}

console.log('\n=== 4. references 完整性 ===');
const refCounts = { 'pua-ext': 24, 'frontend-dev-guide': 2, 'backend-dev-guide': 2 };
for (const name of TARGETS) {
  const refDir = path.join(SKILL_DIR, name, 'references');
  const exists = fs.existsSync(refDir);
  const count = exists ? fs.readdirSync(refDir).filter(f => f.endsWith('.md')).length : 0;
  check(name + ' references存在', exists && count > 0, count + ' 个文件 (预期≥' + refCounts[name] + ')');
}

console.log('\n=== 5. 触发词/描述清晰度 ===');
for (const name of TARGETS) {
  const s = skills.find(x => x.name === name);
  const descLen = s ? s.description.length : 0;
  check(name + ' 描述清晰', descLen > 50, descLen + ' 字符');
}

console.log('\n=== 6. 无危险指令扫描 ===');
const dangerPatterns = [
  /rm\s+-rf\s+\/(?!tmp|temp)/i,
  /curl\s+.*\|\s*(bash|sh|zsh)/i,
  /eval\s*\(/i,
  /sudo\s+rm/i,
  />\s*\/dev\/(sda|hda|null)/i,
  /base64\s+-d.*\|/i,
];
for (const name of TARGETS) {
  const mdPath = path.join(SKILL_DIR, name, 'SKILL.md');
  const content = fs.readFileSync(mdPath, 'utf8');
  let foundDanger = false;
  for (const pat of dangerPatterns) {
    if (pat.test(content)) { foundDanger = true; console.log('    可疑模式: ' + pat); break; }
  }
  check(name + ' 无危险指令', !foundDanger);
}

console.log('\n=== 7. 无提示注入扫描 ===');
const injectionPatterns = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(all\s+)?(above|previous)/i,
  /you\s+are\s+now/i,
  /system\s*prompt/i,
  /override\s+(the\s+)?system/i,
];
for (const name of TARGETS) {
  const mdPath = path.join(SKILL_DIR, name, 'SKILL.md');
  const content = fs.readFileSync(mdPath, 'utf8');
  let foundInjection = false;
  for (const pat of injectionPatterns) {
    if (pat.test(content)) { foundInjection = true; console.log('    可疑模式: ' + pat); break; }
  }
  check(name + ' 无提示注入', !foundInjection);
}

console.log('\n========== 汇总 ==========');
console.log('PASS: ' + pass + '  FAIL: ' + fail);
console.log(fail === 0 ? '✅ 全部冒烟测试通过' : '❌ 存在失败项');
process.exit(fail === 0 ? 0 : 1);
