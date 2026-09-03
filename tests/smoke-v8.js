// 飞虹 Code v8.0 三项改进冒烟测试
// 用法: node tests/smoke-v8.js [--only=sqlite|docker|honcho]
const { getStore } = require('../dist/shared/sqlite-store.js');
const { DockerSandbox } = require('../dist/tools/docker-sandbox.js');
const { HonchoStore } = require('../dist/memory/honcho-store.js');

const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
let pass = 0, fail = 0;

function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${detail || ''}`); }
}

async function testSqlite() {
  console.log('\n【1. SQLite 数据存储】');
  const store = getStore();
  check('健康检查 ok', store.health().ok, JSON.stringify(store.health()));

  store.kvSet('config', 'smoke-key', { hello: 'world' });
  const kv = store.kvGet('config', 'smoke-key');
  check('KV 写入/读取', kv && kv.hello === 'world', JSON.stringify(kv));

  store.taskUpsert({ id: 'smoke-t1', type: 'chat', status: 'completed', input: '你好' });
  const task = store.taskGet('smoke-t1');
  check('任务写入/读取', task && task.status === 'completed', JSON.stringify(task));
  const cnt = store.taskCount();
  check('任务统计', cnt.total >= 1, JSON.stringify(cnt));

  store.modelUpsert({ id: 'smoke-m1', name: '冒烟模型', apiKey: 'sk-secret' });
  const m = store.modelGet('smoke-m1');
  check('模型 API Key 往返解密', m.apiKey === 'sk-secret', m.apiKey);
  const mRaw = store.modelGetRaw('smoke-m1');
  check('模型 API Key 落盘加密', String(mRaw.api_key).startsWith('v1:'), String(mRaw.api_key).slice(0, 20));

  store.skillUpsert({ id: 'smoke-s1', name: '冒烟技能', trigger: 'smoke' });
  check('技能搜索', store.skillSearch('冒烟').length >= 1);

  store.memorySet('SMOKE.md', '# 冒烟记忆');
  check('记忆写入', store.memoryGet('SMOKE.md') === '# 冒烟记忆');
  store.memoryAddHistory('smoke-sess', '冒烟会话摘要');
  check('记忆检索', store.memoryRecall('冒烟').length >= 1);

  store.userUpsert({ id: 'smoke-u1', name: '冒烟用户', preferences: { lang: 'zh' } });
  store.userAddMemory('smoke-u1', '用户喜欢TypeScript', 'fact', 0.8);
  const um = store.userListMemory('smoke-u1');
  check('用户建模', um.length >= 1 && um[0].importance === 0.8, JSON.stringify(um));

  const stats = store.stats();
  check('数据库统计', stats.tasks >= 1 && stats.schemaVersion >= 1, JSON.stringify(stats));
}

async function testDocker() {
  console.log('\n【2. Docker 沙盒执行】');
  const available = await DockerSandbox.isDockerAvailable();
  check('Docker 可用', available);
  if (!available) { console.log('  ⚠️ Docker 不可用，跳过执行测试'); return; }

  const sb = new DockerSandbox({ workspaceDir: process.cwd(), debug: false });
  check('沙盒配置', sb.getConfig().image.length > 0, sb.getConfig().image);

  try {
    const r1 = await sb.execute('echo "hello from docker" && node -v');
    check('容器执行成功', r1.success, `exit=${r1.exitCode} stderr=${r1.stderr.slice(0, 80)}`);
    check('容器输出', r1.stdout.includes('hello from docker'), r1.stdout.slice(0, 100));
    check('Node 版本', /v\d+\.\d+\.\d+/.test(r1.stdout), r1.stdout);
  } catch (e) {
    check('容器执行', false, String(e));
  }

  // 危险命令拦截测试
  const r2 = await sb.execute('rm -rf /etc');
  check('危险命令拦截', !r2.success && r2.stderr.includes('拦截'), r2.stderr.slice(0, 80));
}

async function testHoncho() {
  console.log('\n【3. Honcho 云端记忆（本地部署）】');
  const honcho = new HonchoStore({ userId: 'smoke-user' });
  const health = honcho.health();
  check('Honcho 健康', health.ok, JSON.stringify(health));
  check('后端模式', health.backend.includes('sqlite'), health.backend);

  honcho.setUserProfile({ name: '吴先生', preferences: { language: 'zh', style: '结构化' }, traits: { role: 'CTO' } });
  const profile = honcho.getUserProfile();
  check('用户画像', profile.name === '吴先生' && profile.preferences?.style === '结构化', JSON.stringify(profile));

  honcho.rememberFact('我偏好结构化输出和数字列表');
  honcho.rememberFact('我常使用飞虹 Code 开发');
  const mems = honcho.listMemories();
  check('事实记忆（重要度排序）', mems.length >= 2 && mems[0].importance >= 0.5, JSON.stringify(mems.map((m) => m.importance)));

  honcho.addSessionSummary('用户讨论 v8.0 三项改进');
  const recall = honcho.recall('改进');
  check('跨会话检索', recall.memory.length >= 1 || recall.history.length >= 1, JSON.stringify({ mem: recall.memory.length, hist: recall.history.length }));

  const prompt = honcho.buildContextPrompt();
  check('记忆注入提示词', prompt.includes('用户画像') && prompt.includes('吴先生'), prompt.slice(0, 80));
  check('提示词含偏好', prompt.includes('结构化'));

  honcho.digestConversation([
    { role: 'user', content: '我喜欢用 TypeScript 编写后端服务' },
    { role: 'assistant', content: '好的，已记住' },
  ]);
  const digested = honcho.listMemories();
  check('对话自动沉淀', digested.length >= 3, `memories=${digested.length}`);
}

(async () => {
  try {
    if (!only || only === 'sqlite') await testSqlite();
    if (!only || only === 'docker') await testDocker();
    if (!only || only === 'honcho') await testHoncho();
    console.log(`\n===== 结果: ${pass} 通过, ${fail} 失败 =====`);
    process.exit(fail > 0 ? 1 : 0);
  } catch (e) {
    console.error('测试异常:', e);
    process.exit(2);
  }
})();
