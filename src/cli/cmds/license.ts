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
import {
  licenseState,
  activateLicense,
  generateLicenseKey,
  licenseText,
  deviceFingerprint,
  onlineEnabled,
  onlineState,
  onlineText,
  activateOnline,
  heartbeatOnline,
  licenseServerUrl,
} from '../../license';

function printLicenseHelp(): void {
  console.log(`fhcode license — 商业授权管理
用法:
  fhcode license show                  查看当前授权状态（自动区分离线/在线模式）
  fhcode license activate <激活码>      输入激活码激活（在线模式走授权服务）
  fhcode license fingerprint           打印本机设备指纹
  fhcode license heartbeat             手动发送一次心跳（在线模式，用于排查）
  fhcode license server                查看在线授权服务配置与连通性
  （开发商专属，受双重密钥门禁）:
  fhcode license gen <类型> <客户名> [天数] [设备数]   生成激活码（需 FH_LICENSE_SIGN_PRIVATE_KEY + FH_LICENSE_MASTER）
  fhcode license help                  显示帮助

授权模式:
  · 离线模式（默认）：激活后永不上网，凭本机签名校验
  · 在线模式：设置 FH_LICENSE_SERVER 后启用，支持远程吊销 / 席位管控 / 心跳在线状态
    环境变量：FH_LICENSE_SERVER / FH_LICENSE_PUBLIC_KEY / FH_LICENSE_GRACE_HOURS（默认72h）`);
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
      if (onlineEnabled()) {
        const st = onlineState();
        console.log(onlineText(st));
        console.log(`模式: 在线授权 | 服务地址: ${licenseServerUrl() || '(未配置)'}`);
        if (st.hasRecord) {
          console.log(`许可证密钥: ${st.licenseKey ?? '-'}`);
          console.log(`设备指纹: ${st.deviceFingerprint ?? '-'}`);
          console.log(`服务端状态: ${st.serverStatus ?? '-'}`);
          if (st.lastHeartbeatAt) {
            console.log(`上次心跳: ${new Date(st.lastHeartbeatAt).toLocaleString()}`);
          }
          console.log(`宽限剩余: ${st.graceHoursLeft} 小时`);
        }
        if (!st.valid) {
          console.error('提示: ' + (st.error || '授权无效'));
          process.exitCode = 1;
        }
        return;
      }
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
      if (onlineEnabled()) {
        console.log(`模式: 在线授权 | 服务: ${licenseServerUrl()}`);
        const r = await activateOnline(key);
        if (!r.ok) {
          console.error('❌ 在线激活失败: ' + (r.error || '未知错误'));
          process.exitCode = 1;
          return;
        }
        console.log('✅ 在线激活成功:');
        console.log('  ' + onlineText(r.state!));
        return;
      }
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

    case 'heartbeat': {
      if (!onlineEnabled()) {
        console.error('❌ 未启用在线授权模式（未设置 FH_LICENSE_SERVER），无需心跳。');
        console.error('提示: 离线模式下 fhcode 永不上网，这是设计预期。');
        return;
      }
      const r = await heartbeatOnline();
      if (r.ok) {
        console.log('✅ 心跳成功');
        console.log(`  服务端状态: ${r.status ?? '-'}`);
        if (r.configUpdated) console.log('  检测到配置更新，已完成验签并应用');
        console.log(`  宽限剩余: ${r.graceHoursLeft ?? '-'} 小时`);
        return;
      }
      console.error('❌ 心跳失败: ' + (r.error || '未知错误'));
      if (r.status && r.status !== 'active') {
        console.error('  服务端已明确标记为 ' + r.status + '，授权立即失效（远程吊销）。');
        process.exitCode = 1;
      } else {
        console.error(`  本地仍按宽限期运行，剩余 ${r.graceHoursLeft ?? '-'} 小时；请尽快恢复网络。`);
      }
      return;
    }

    case 'server': {
      const url = licenseServerUrl();
      if (!url) {
        console.log('当前为离线授权模式（未设置 FH_LICENSE_SERVER）。');
        console.log('启用方式：export FH_LICENSE_SERVER=https://lm.example.com');
        console.log('同时设置：export FH_LICENSE_PUBLIC_KEY=<服务端 rsa_public_key.pem 内容或 base64>');
        return;
      }
      console.log(`授权服务地址: ${url}`);
      console.log(`本机设备指纹: ${deviceFingerprint()}`);
      const st = onlineState();
      console.log(`本地授权记录: ${st.hasRecord ? '存在' : '不存在'}`);
      console.log(`许可证密钥: ${st.licenseKey ?? '-'}`);
      console.log(`服务端状态: ${st.serverStatus ?? '-'}`);
      console.log(`宽限剩余: ${st.graceHoursLeft} 小时`);
      console.log(`当前判定: ${st.valid ? '有效' : '无效 — ' + (st.error || '')}`);
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
      // 1) FH_LICENSE_SIGN_PRIVATE_KEY（Ed25519 私钥，生产发码签名；本地自测可用 FH_LICENSE_DEV=1）
      const signKey = process.env.FH_LICENSE_SIGN_PRIVATE_KEY?.trim();
      if (!signKey && process.env.FH_LICENSE_DEV !== '1') {
        console.error('❌ 未配置 FH_LICENSE_SIGN_PRIVATE_KEY（发码私钥），禁止生成生产激活码；本地自测请设置 FH_LICENSE_DEV=1');
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
      const key = generateLicenseKey({
        type: type as 'standard' | 'pro' | 'enterprise',
        issuedTo,
        days,
        seats,
        privateKey: signKey,
      });
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
