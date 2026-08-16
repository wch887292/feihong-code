// 圈复杂度 + 函数长度分析：扫描 src/**/*.ts，输出按复杂度降序的函数列表
const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', 'src');
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts')) files.push(p);
  }
})(root);

const DecisionKinds = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.BinaryExpression, // 仅计 && / || / ??
]);

function countDecisions(node) {
  let n = 1; // 函数本身算 1
  function visit(nd) {
    if (nd.kind === ts.SyntaxKind.BinaryExpression) {
      const op = nd.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
        n++;
      }
    } else if (DecisionKinds.has(nd.kind) && nd.kind !== ts.SyntaxKind.BinaryExpression) {
      n++;
    }
    ts.forEachChild(nd, visit);
  }
  ts.forEachChild(node, visit);
  return n;
}

function loc(node) {
  return node.getEnd ? (node.end - node.getStart()) : 0;
}

const results = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true);
  function visit(nd, parentName) {
    const isFn =
      nd.kind === ts.SyntaxKind.FunctionDeclaration ||
      nd.kind === ts.SyntaxKind.MethodDeclaration ||
      nd.kind === ts.SyntaxKind.ArrowFunction ||
      nd.kind === ts.SyntaxKind.FunctionExpression;
    if (isFn && nd.body) {
      let name = nd.name ? nd.name.getText(sf) : (parentName || '<anon>');
      if (nd.kind === ts.SyntaxKind.ArrowFunction || nd.kind === ts.SyntaxKind.FunctionExpression) {
        // 尝试从变量声明取名字
        const gp = nd.parent;
        if (gp && gp.kind === ts.SyntaxKind.VariableDeclaration && gp.name) name = gp.name.getText(sf);
      }
      const cc = countDecisions(nd);
      const lines = src.slice(nd.getStart(), nd.end).split('\n').length;
      results.push({ file: path.relative(root, f), name, cc, lines });
    }
    ts.forEachChild(nd, (c) => visit(c, nd.name ? nd.name.getText(sf) : parentName));
  }
  visit(sf, null);
}

results.sort((a, b) => b.cc - a.cc || b.lines - a.lines);
const top = results.filter((r) => r.cc >= 10 || r.lines >= 80);
console.log('Top complexity functions (cc>=10 or lines>=80):');
console.log('file | fn | cc | lines');
for (const r of top) {
  console.log(`${r.file} | ${r.name} | cc=${r.cc} | lines=${r.lines}`);
}
console.log('\nTotal functions scanned:', results.length);
console.log('Functions with cc>=10:', results.filter((r) => r.cc >= 10).length);
console.log('Functions with lines>=80:', results.filter((r) => r.lines >= 80).length);
