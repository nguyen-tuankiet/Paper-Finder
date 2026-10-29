#!/usr/bin/env node
// Giả lập SePay gọi webhook khi có tiền vào tài khoản, để thử thanh toán ở máy local mà không cần chuyển tiền thật.
//
//   npm run sepay:simulate -- <mã đơn> <số tiền> [tùy chọn]
//
// <mã đơn> là 9 chữ số hiện trong nội dung chuyển khoản (vd. PF482913057 -> 482913057).
// Tùy chọn:
//   --memo "<nội dung>"   Nội dung chuyển khoản tùy ý (mặc định: tiền tố + mã đơn)
//   --account <số TK>     Số tài khoản nhận (mặc định lấy SEPAY_BANK_ACCOUNT, đặt sai để thử trường hợp lệch tài khoản)
//   --key <khóa>          Khóa API gửi kèm (mặc định lấy SEPAY_API_KEY, đặt sai để thử trường hợp bị từ chối)
//   --id <số>             Mã giao dịch (mặc định ngẫu nhiên; gửi lại cùng id để thử trường hợp SePay gọi lặp)
//   --out                 Giả lập tiền ra thay vì tiền vào (phải bị bỏ qua)
//   --url <địa chỉ>       Địa chỉ máy chủ (mặc định http://localhost:<PORT>)
//
// Khóa và số tài khoản đọc từ file .env ở thư mục gốc, không in ra màn hình.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readEnv() {
  const file = join(root, '.env');
  const env = {};
  if (!existsSync(file)) return env;
  for (const raw of readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') flags.out = true;
    else if (arg.startsWith('--')) flags[arg.slice(2)] = argv[++i];
    else positional.push(arg);
  }
  return { positional, flags };
}

const env = { ...readEnv(), ...process.env };
const { positional, flags } = parseArgs(process.argv.slice(2));
const [orderCode, amountText] = positional;
const amount = Number(amountText);

if (!/^\d{6,12}$/.test(orderCode ?? '') || !Number.isFinite(amount) || amount <= 0) {
  console.error('Cách dùng: npm run sepay:simulate -- <mã đơn 9 chữ số> <số tiền> [--memo ...] [--account ...] [--key ...] [--id ...] [--out] [--url ...]');
  console.error('Ví dụ:     npm run sepay:simulate -- 482913057 29000');
  process.exit(2);
}

const apiKey = flags.key ?? env.SEPAY_API_KEY;
const account = flags.account ?? env.SEPAY_BANK_ACCOUNT;
if (!apiKey || !account) {
  console.error('Thiếu SEPAY_API_KEY hoặc SEPAY_BANK_ACCOUNT trong file .env (hoặc truyền --key / --account).');
  process.exit(2);
}

const prefix = (env.SEPAY_CODE_PREFIX || 'PF').toUpperCase();
const memo = flags.memo ?? `${prefix}${orderCode}`;
const base = (flags.url ?? `http://localhost:${env.PORT || 8787}`).replace(/\/$/, '');
const id = Number(flags.id ?? Math.floor(Date.now() / 10) % 1_000_000_000);

// Dạng payload theo tài liệu webhook của SePay.
const payload = {
  id,
  gateway: env.SEPAY_BANK_NAME || 'MBBank',
  transactionDate: new Date().toISOString().replace('T', ' ').slice(0, 19),
  accountNumber: account,
  code: null,
  content: memo,
  transferType: flags.out ? 'out' : 'in',
  transferAmount: amount,
  accumulated: 0,
  subAccount: null,
  referenceCode: `SIM${id}`,
  description: `${memo} (giả lập)`,
};

try {
  const response = await fetch(`${base}/api/billing/sepay-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Apikey ${apiKey}` },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  console.log(`HTTP ${response.status} ${text}`);
  console.log(`Đã gửi giao dịch giả lập id=${id}, ${amount}đ, nội dung "${memo}", tài khoản nhận ${account.slice(0, 2)}***${account.slice(-2)}.`);
  if (response.status === 401) console.log('=> Khóa API sai (bị từ chối).');
  if (response.status === 404) console.log('=> Máy chủ chưa bật SePay: kiểm tra SEPAY_API_KEY, SEPAY_BANK_ACCOUNT, SEPAY_BANK_NAME rồi khởi động lại.');
  process.exit(response.ok ? 0 : 1);
} catch (error) {
  console.error(`Không kết nối được ${base}: ${error instanceof Error ? error.message : error}. Máy chủ đã chạy (npm run dev) chưa?`);
  process.exit(1);
}
