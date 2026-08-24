const fs = require('fs');
let raw = fs.readFileSync('软著申请材料/manual-content.json', 'utf8');
// 修复 text 值中的未转义双引号
raw = raw.replace(/"text":"(.*?)(?=","type"|"})/g, function(match, p1) {
  const escaped = p1.replace(/"/g, '\\"');
  return '"text":"' + escaped;
});
fs.writeFileSync('软著申请材料/manual-content-fixed.json', raw, 'utf8');
try {
  const d = JSON.parse(raw);
  console.log('修复成功，共' + d.length + '项');
} catch(e) {
  console.log('仍有错误: ' + e.message);
}
