const fs = require('fs');
let raw = fs.readFileSync('软著申请材料/manual-content.json', 'utf8');

// 匹配 "text":"..."} 后跟 , 或 ]（对象结束），非贪婪
// 这样可以正确识别 text 值的结束位置
raw = raw.replace(/"text":"([\s\S]*?)"}(?=\s*[,\]])/g, function(match, p1) {
  // 将 text 值内部的双引号转义
  const escaped = p1.replace(/"/g, '\\"');
  return '"text":"' + escaped + '"}';
});

fs.writeFileSync('软著申请材料/manual-content-fixed.json', raw, 'utf8');

try {
  const d = JSON.parse(raw);
  console.log('修复成功，共' + d.length + '项');
} catch(e) {
  console.log('仍有错误: ' + e.message);
  const pos = parseInt(e.message.match(/position (\d+)/)?.[1] || 0);
  console.log('位置' + (pos-30) + '-' + (pos+30) + ':');
  console.log(raw.substring(Math.max(0,pos-30), pos+30));
}
