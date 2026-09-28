/**
 * 飞虹 Code (对标 Muse Code · 自研内核)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 商业授权管理命令
 * 从 cli/run.ts 抽离（B3 架构治理延续，2026-09-28）。
 */

import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { licenseState, activateLicense, generateLicenseKey, licenseText, deviceFingerprint } from '../../license';

function printLicenseHelp(): void {
  console.log(`fhcode license — 商业授权管理
用法:
  fhcode license show                  查看当前授权状态
  fhcode license activate <激活码>      输入激活码激活
  fhcode license fingerprint           打印本机设备指纹
  （开发商专属，受双重密钥门禁）:
  fhcode license gen <类型> <客户名> [天数] [设备数]   生成激活码（需 FH_LICENSE_SECRET + FH_LICENSE_MASTER）
  fhcode license help                  显示帮助`);
}

/** fhcode license：激活码激活 / 状态查看 / 开发商发码 */
export async function runLicense(action: string, args: string[]): Promise<void> {
  switch (action) {
    case 'help':
    case '-h':
    case '--help':
      printLicenseHelp();
      return;

    case 'show': {
      const state = licenseState();
      console.log(licenseText(state));
      if (state.activated) {
        console.log(`设备指纹: ${state.deviceFingerprint ?? ''}`);
        console.log(`到期时间: ${state.expiresAt || '永久'}`);
      } else if (state.trial) {
        console.log('提示: 试用期内功能可用，试用结束后需激活码。');
      } else {
        console.error('提示: ' + (state.error || ''));
        console.error('购买授权后使用: fhcode license activate <激活码>');
        process.exitCode = 1;
      }
      return;
    }

    case 'activate': {
      const key = args.join(' ').trim();
      if (!key) { console.error('缺少激活码: fhcode license activate <激活码>'); process.exitCode = 1; return; }
      const result = activateLicense(key);
      if (!result.ok) {
        console.error('❌ 激活失败: ' + (result.error || '未知错误'));
        process.exitCode = 1;
        return;
      }
      console.log('✅ 激活成功:');
      console.log('  ' + licenseText(result.state!));
      return;
    }

    case 'gen': {
      const type = (args[0] || 'standard').toLowerCase();
      const issuedTo = args[1] || '';
      const days = args[2] ? parseInt(args[2], 10) : 0;
      const seats = args[3] ? parseInt(args[3], 10) : 1;
      if (!['standard', 'pro', 'enterprise'].includes(type)) {
        console.error('授权类型必须是 standard / pro / enterprise');
        process.exitCode = 1;
        return;
      }
      if (!issuedTo) { console.error('缺少客户名: fhcode license gen <类型> <客户名> [天数] [设备数]'); process.exitCode = 1; return; }
      // 双重密钥门禁：激活码只能在开发商源码端生成
      // 1) FH_LICENSE_SECRET（发码签名密钥）
      if (!process.env.FH_LICENSE_SECRET) {
        console.error('❌ 未配置 FH_LICENSE_SECRET（发码签名密钥），禁止生成激活码');
        process.exitCode = 1;
        return;
      }
      // 2) FH_LICENSE_MASTER（开发商主密钥，发布版/客户环境无此密钥）
      const masterOk =
        process.env.FH_LICENSE_MASTER?.trim() !== '' ||
        existsSync(join(homedir(), '.feihong-code', 'license-master'));
      if (!masterOk) {
        console.error('❌ 当前环境未配置开发商主密钥（FH_LICENSE_MASTER 或 ~/.feihong-code/license-master），激活码只能在开发商源码端生成');
        process.exitCode = 1;
        return;
      }
      const key = generateLicenseKey({ type: type as 'standard' | 'pro' | 'enterprise', issuedTo, days, seats });
      console.log('激活码: ' + key);
      console.log(`类型: ${type} | 客户: ${issuedTo} | 天数: ${days || '永久'} | 设备数: ${seats}`);
      console.log('交付话术: 请打开 fhcode，运行 fhcode license activate ' + key);
      return;
    }

    case 'fingerprint': {
      console.log(deviceFingerprint());
      return;
    }

    default:
      console.error('未知子命令: ' + action);
      printLicenseHelp();
      process.exitCode = 1;
  }
}
