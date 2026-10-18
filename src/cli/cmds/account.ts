/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 账号命令（v8.11 账号升级）：
 *   fhcode login <手机号> [<密码>]    登录/首次注册（默认密码=手机号后 4 位）
 *   fhcode logout                      登出（清除激活账号）
 *   fhcode accounts                    列出已注册账号
 *   fhcode account password [<手机号>] [<旧密码>] [<新密码>]   修改密码
 */
import { createInterface } from 'readline';
import { t } from '../../shared/i18n';
import {
  isValidPhone,
  loginAccount,
  listAccounts,
  changePassword,
  getActiveAccount,
  setActiveAccount,
  clearActiveAccount,
  defaultPassword,
} from '../../security/account';

/** 隐藏输入的密码读取（TTY）；非 TTY 直接返回缺省值 */
function readSecret(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

/** fhcode login <phone> [<password>]：登录 / 首次自动注册 */
export async function runLogin(phone: string, password?: string): Promise<void> {
  const valid = phone.trim();
  if (!isValidPhone(valid)) {
    console.error('手机号非法（需 6-20 位数字，可含 + 前缀）。用法：fhcode login <手机号> [<密码>]');
    process.exitCode = 1;
    return;
  }
  let pwd = password;
  if (pwd === undefined || pwd.length === 0) {
    if (!process.stdin.isTTY) {
      console.error('非交互环境请显式提供密码：fhcode login <手机号> <密码>');
      process.exitCode = 1;
      return;
    }
    pwd = await readSecret('密码（首次登录默认=手机号后 4 位，可直接回车）：');
    if (pwd.length === 0) pwd = defaultPassword(valid);
  }
  try {
    const { isFirstLogin } = loginAccount(valid, pwd);
    setActiveAccount(valid);
    console.log(`✓ 已登录账号 ${valid}${isFirstLogin ? '（首次登录，默认密码=手机号后 4 位，建议尽快修改：fhcode account password）' : ''}`);
    console.log('  该账号的数据（凭据/记忆/会话/审计）已全隔离，与其它手机号互不可见。');
  } catch (e) {
    console.error(`登录失败: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}

/** fhcode logout：登出 */
export function runLogout(): void {
  const active = getActiveAccount();
  if (!active) {
    console.log('当前未登录任何账号。');
    return;
  }
  clearActiveAccount();
  console.log(`✓ 已登出账号 ${active}（下次运行回到未隔离的 FH_HOME 数据区）`);
}

/** fhcode accounts：列出已注册账号 */
export function runAccounts(): void {
  const rows = listAccounts();
  const active = getActiveAccount();
  if (rows.length === 0) {
    console.log('（暂无注册账号。首次登录即自动注册：fhcode login <手机号>）');
    return;
  }
  console.log('已注册账号:');
  for (const r of rows) {
    const marker = r.phone === active ? '（当前激活）' : '';
    console.log(`  ${r.phone}  注册于 ${r.createdAt.slice(0, 19)}  ${marker}`);
  }
}

/** fhcode account password [<手机号>] [<旧密码>] [<新密码>]：修改密码 */
export async function runAccountPassword(phone?: string, oldPassword?: string, newPassword?: string): Promise<void> {
  const active = getActiveAccount();
  const target = (phone ?? active ?? '').trim();
  if (!target) {
    console.error('未指定手机号且当前未登录。用法：fhcode account password <手机号> <旧密码> <新密码>');
    process.exitCode = 1;
    return;
  }
  let oldPwd = oldPassword;
  let newPwd = newPassword;
  if ((oldPwd === undefined || newPwd === undefined) && process.stdin.isTTY) {
    oldPwd = oldPwd ?? await readSecret('旧密码（首次默认=手机号后 4 位）：');
    newPwd = newPwd ?? await readSecret('新密码（至少 4 位）：');
  }
  if (!oldPwd || !newPwd) {
    console.error('用法：fhcode account password <手机号> <旧密码> <新密码>（TTY 下可交互输入）');
    process.exitCode = 1;
    return;
  }
  try {
    changePassword(target, oldPwd, newPwd);
    console.log(`✓ 已修改账号 ${target} 的登录密码`);
  } catch (e) {
    console.error(`修改失败: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
  void t;
}
