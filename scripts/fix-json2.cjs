const fs = require('fs');
const raw = fs.readFileSync('软著申请材料/manual-content.json', 'utf8');

// 字符级解析：识别字符串边界，转义内部双引号
let result = '';
let inString = false;
let i = 0;

while (i < raw.length) {
  const ch = raw[i];
  
  if (!inString) {
    result += ch;
    if (ch === '"') inString = true;
    i++;
    continue;
  }
  
  // 在字符串内
  if (ch === '\\') {
    // 转义字符，保留两个字符
    result += ch + (raw[i+1] || '');
    i += 2;
    continue;
  }
  
  if (ch === '"') {
    // 检查这个引号是否是字符串结束符
    // 向后看，跳过空白，下一个非空白字符应该是 : , } ] 之一
    let j = i + 1;
    while (j < raw.length && (raw[j] === ' ' || raw[j] === '\t' || raw[j] === '\n' || raw[j] === '\r')) j++;
    const next = raw[j];
    
    if (next === ':' || next === ',' || next === '}' || next === ']' || j >= raw.length) {
      // 这是字符串结束符
      result += '"';
      inString = false;
      i++;
    } else {
      // 这是字符串内部的双引号，需要转义
      result += '\\"';
      i++;
    }
  } else {
    result += ch;
    i++;
  }
}

fs.writeFileSync('软著申请材料/manual-content-fixed.json', result, 'utf8');

try {
  const d = JSON.parse(result);
  console.log('修复成功，共' + d.length + '项');
} catch(e) {
  console.log('仍有错误: ' + e.message);
  // 显示错误位置附近
  const pos = parseInt(e.message.match(/position (\d+)/)?.[1] || 0);
  console.log('位置' + (pos-50) + '-' + (pos+50) + ':');
  console.log(result.substring(Math.max(0,pos-50), pos+50));
}
