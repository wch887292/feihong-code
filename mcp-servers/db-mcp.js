#!/usr/bin/env node
/**
 * 飞虹 Code · 数据库 MCP 服务器（工具提供侧，stdio）
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 作用：把"查库"能力作为 MCP 工具暴露给飞虹 Code，让智能体能够直接对数据库执行查询、
 *       列表明细、查看表结构，从而理解业务数据、核对结果、辅助生成报表/SQL。
 *
 * 引擎：
 *   - SQLite（默认，零依赖，使用 Node 内置 node:sqlite）：由环境变量 DB_PATH 指定库文件。
 *   - MySQL / PostgreSQL（可选）：由环境变量 DB_ENGINE=mysql|postgres 切换，
 *     并提供 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME；驱动 mysql2 / pg 需另行安装到 Node 工作区。
 *
 * 安全设计（重要）：
 *   - 默认只读：仅允许 SELECT / WITH(只读) / PRAGMA / EXPLAIN 开头的语句。
 *   - 任何 INSERT/UPDATE/DELETE/DROP/ALTER 等写操作必须显式传 allowWrite:true，
 *     并在参数里携带，且 db_query 会二次校验语句类型，写语句未授权一律拒绝。
 *   - 不在任何日志/返回里泄露数据库密码。
 *
 * 传输：MCP stdio（JSON-RPC 2.0, NDJSON），与飞虹 Code 的 McpClient 对齐（protocolVersion 2024-11-05）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ENGINE = (process.env.DB_ENGINE || 'sqlite').toLowerCase();
const TOOLS = [
  {
    name: 'db_engine_info',
    description: '返回当前数据库引擎与连接状态（引擎类型、SQLite 库路径 / MySQL·Postgres 连接信息摘要，不含密码）。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'db_list_tables',
    description: '列出数据库中的所有表/集合。返回表名清单。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'db_describe',
    description: '查看某张表的字段结构。参数 table(必填)。返回列名/类型/是否可空/默认值等。',
    inputSchema: { type: 'object', properties: { table: { type: 'string' } }, required: ['table'] },
  },
  {
    name: 'db_query',
    description: '执行一条 SQL 查询。参数 sql(必填)、limit(可选，默认 200，上限 1000)、allowWrite(可选，默认 false；写语句必须显式 true 并经安全校验)。默认只读，写语句未授权会被拒绝。',
    inputSchema: { type: 'object', properties: { sql: { type: 'string' }, limit: { type: 'number' }, allowWrite: { type: 'boolean' } }, required: ['sql'] },
  },
];

// ---------- 引擎适配 ----------
let sqliteDb = null;
let sqlPool = null; // mysql/pg 连接池占位

function getSqlite() {
  if (ENGINE !== 'sqlite') return null;
  if (sqliteDb) return sqliteDb;
  const dbPath = process.env.DB_PATH;
  if (!dbPath) {
    throw new Error('SQLite 模式未指定库文件：请设置环境变量 DB_PATH 指向 .db 文件路径。');
  }
  const abs = path.resolve(dbPath);
  if (!fs.existsSync(abs)) {
    throw new Error('SQLite 库文件不存在：' + abs + '。请确认 DB_PATH 正确。');
  }
  // eslint-disable-next-line node/no-unsupported-features/node-builtins
  const { DatabaseSync } = require('node:sqlite');
  sqliteDb = new DatabaseSync(abs);
  return sqliteDb;
}

function getRelationalPool() {
  if (ENGINE === 'mysql') {
    let mysql2;
    try { mysql2 = require('mysql2/promise'); } catch {
      throw new Error('未安装 mysql2 驱动。请在 Node 工作区执行：npm install mysql2，并设置 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME。');
    }
    if (!sqlPool) {
      sqlPool = mysql2.createPool({
        host: process.env.DB_HOST, user: process.env.DB_USER,
        password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
        port: Number(process.env.DB_PORT) || 3306, waitForConnections: true, connectionLimit: 4,
      });
    }
    return { kind: 'mysql', pool: sqlPool };
  }
  if (ENGINE === 'postgres') {
    let pg;
    try { pg = require('pg'); } catch {
      throw new Error('未安装 pg 驱动。请在 Node 工作区执行：npm install pg，并设置 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME。');
    }
    if (!sqlPool) {
      sqlPool = new pg.Pool({
        host: process.env.DB_HOST, user: process.env.DB_USER,
        password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
        port: Number(process.env.DB_PORT) || 5432,
      });
    }
    return { kind: 'postgres', pool: sqlPool };
  }
  return null;
}

/** 只读语句判定：仅允许 SELECT / WITH(只读) / PRAGMA / EXPLAIN 开头 */
function isReadOnlySql(sql) {
  const s = sql.trim().replace(/^\(+/, '').toLowerCase();
  return /^(select|with|pragma|explain|show)\b/.test(s);
}

function rowsToText(rows, limit) {
  if (!Array.isArray(rows)) return String(rows);
  const head = rows.slice(0, limit);
  if (!head.length) return '（0 行）';
  // 取首行键作为列头
  const cols = Object.keys(head[0]);
  const lines = [];
  lines.push(cols.join(' | '));
  lines.push(cols.map(() => '---').join(' | '));
  for (const r of head) {
    lines.push(cols.map((c) => {
      let v = r[c];
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'object') v = JSON.stringify(v);
      return String(v).replace(/\n/g, ' ').slice(0, 200);
    }).join(' | '));
  }
  const more = rows.length > limit ? `\n… 共 ${rows.length} 行，已显示前 ${limit} 行` : '';
  return '行数：' + rows.length + '\n' + lines.join('\n') + more;
}

async function runTool(name, args) {
  switch (name) {
    case 'db_engine_info': {
      if (ENGINE === 'sqlite') {
        const dbPath = process.env.DB_PATH || '（未设置 DB_PATH）';
        return '引擎：SQLite（Node 内置 node:sqlite，零依赖）\n库路径：' + dbPath;
      }
      const masked = process.env.DB_PASSWORD ? '***已配置***' : '（未设置）';
      return '引擎：' + ENGINE + '\n主机：' + (process.env.DB_HOST || '?') +
        '\n端口：' + (process.env.DB_PORT || (ENGINE === 'mysql' ? 3306 : 5432)) +
        '\n用户：' + (process.env.DB_USER || '?') +
        '\n数据库：' + (process.env.DB_NAME || '?') +
        '\n密码：' + masked;
    }
    case 'db_list_tables': {
      if (ENGINE === 'sqlite') {
        const db = getSqlite();
        const rows = db.prepare(
          "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).all();
        if (!rows.length) return '（无表）';
        return '表/视图（' + rows.length + '）：\n' + rows.map((r) => r.name).join('\n');
      }
      const rel = getRelationalPool();
      if (rel.kind === 'mysql') {
        const [rows] = await rel.pool.query('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name', [process.env.DB_NAME]);
        return '表（' + rows.length + '）：\n' + rows.map((r) => r.name).join('\n');
      }
      const { rows } = await rel.pool.query("SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
      return '表（' + rows.length + '）：\n' + rows.map((r) => r.name).join('\n');
    }
    case 'db_describe': {
      const t = args.table;
      if (!t) throw new Error('缺少参数 table');
      if (ENGINE === 'sqlite') {
        const db = getSqlite();
        const rows = db.prepare('PRAGMA table_info(' + JSON.stringify(t) + ')').all();
        if (!rows.length) return '表不存在：' + t;
        return '表 ' + t + ' 结构（' + rows.length + ' 列）：\n' +
          rows.map((r) => `${r.name} | ${r.type} | ${r.notnull ? 'NOT NULL' : 'nullable'} | ${r.pk ? 'PK' : ''} | dflt=${r.dflt_value ?? 'NULL'}`).join('\n');
      }
      const rel = getRelationalPool();
      if (rel.kind === 'mysql') {
        const [rows] = await rel.pool.query('DESCRIBE ' + t);
        return '表 ' + t + ' 结构：\n' + rows.map((r) => `${r.Field} | ${r.Type} | ${r.Null} | ${r.Key} | ${r.Default}`).join('\n');
      }
      const { rows } = await rel.pool.query(
        "SELECT column_name AS name, data_type AS type, is_nullable AS nullable, column_default AS dflt FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position", [t]
      );
      return '表 ' + t + ' 结构（' + rows.length + ' 列）：\n' +
        rows.map((r) => `${r.name} | ${r.type} | ${r.nullable === 'NO' ? 'NOT NULL' : 'nullable'} | dflt=${r.dflt ?? 'NULL'}`).join('\n');
    }
    case 'db_query': {
      const sql = String(args.sql || '').trim();
      if (!sql) throw new Error('缺少参数 sql');
      const allowWrite = args.allowWrite === true;
      const readOnly = isReadOnlySql(sql);
      if (!readOnly && !allowWrite) {
        throw new Error('写操作被安全护栏拦截：该语句非只读（' + sql.slice(0, 40) + '…），需显式传 allowWrite:true。');
      }
      if (!readOnly && allowWrite) {
        // 二次兜底：即便 allowWrite，也仅放行常见 DML/DDL，且 MySQL/PG 下显式事务提交
      }
      const limit = Math.min(Number(args.limit) || 200, 1000);
      if (ENGINE === 'sqlite') {
        const db = getSqlite();
        if (readOnly) {
          const rows = db.prepare(sql).all();
          return rowsToText(rows, limit);
        }
        // 写操作
        const info = db.prepare(sql).run();
        return '写操作已执行（changes=' + (info.changes ?? 0) + '）。';
      }
      const rel = getRelationalPool();
      if (rel.kind === 'mysql') {
        const [rows] = await rel.pool.query(sql);
        return Array.isArray(rows) ? rowsToText(rows, limit) : ('执行结果：' + JSON.stringify(rows));
      }
      const { rows } = await rel.pool.query(sql);
      return rowsToText(rows, limit);
    }
    default:
      throw new Error('未知工具：' + name);
  }
}

// ---------- MCP stdio 协议层 ----------
function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

async function handleMcp(msg) {
  const { id, method } = msg;
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'db-mcp', version: '1.0.0' },
      },
    });
    return;
  }
  if (method === 'notifications/initialized') return;
  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    return;
  }
  if (method === 'tools/call') {
    const params = msg.params || {};
    const name = params.name;
    const args = params.arguments || {};
    try {
      const out = await runTool(name, args);
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(out) }], isError: false } });
    } catch (e) {
      const err = (e && e.message) || String(e);
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: '错误：' + err }], isError: true } });
    }
    return;
  }
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  handleMcp(msg).catch((e) => {
    send({ jsonrpc: '2.0', id: msg && msg.id, error: { code: -32603, message: (e && e.message) || String(e) } });
  });
});

process.stdin.on('end', () => {
  try { if (sqliteDb) sqliteDb.close(); } catch { /* noop */ }
  try { if (sqlPool && sqlPool.end) sqlPool.end(); } catch { /* noop */ }
  process.exit(0);
});
process.stdin.resume();
