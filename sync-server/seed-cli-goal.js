/** 造一个排队任务供 sync-poll 认领（冒烟测试最深层） */
const URL_BASE = 'https://sync.klai.top';
const TOKEN = process.env.FHCODE_SYNC_TOKEN;
const RUN_ID = 'smoke-cli-' + Date.now().toString(36);

(async () => {
  await fetch(URL_BASE + '/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({
      runId: RUN_ID,
      goal: 'CLI 冒烟测试',
      status: 'done',
      messages: [{ role: 'user', content: 'CLI 冒烟测试会话' }],
    }),
  });
  await fetch(URL_BASE + `/api/sessions/${RUN_ID}/goals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ goal: '这是一次跨端同步冒烟测试，请直接回复「冒烟测试通过」五个字，不要调用任何工具，不要读写任何文件。' }),
  });
  console.log(RUN_ID);
})();
