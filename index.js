// ============================================================
// SIPAL DELTAHASH MINING BOT V1.0
// Author: Sipal Airdrop
// Description: Automated DeltaHash Mining Bot
// ============================================================

const axios = require('axios');
const chalk = require('chalk');
const Table = require('cli-table3');
const fs = require('fs');
const crypto = require('crypto');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

// ============================================================
// CONFIGURATION CONSTANTS (NO config.json — ALL HERE)
// ============================================================
const BASE_URL = 'https://portal.deltahash.ai';
const API = {
  AUTH_ME: `${BASE_URL}/api/auth/me`,
  DEVICES_CONNECT: `${BASE_URL}/api/devices/connect`,
  DEVICES_REGISTER: `${BASE_URL}/api/devices/register`,
  MINING_CONNECT: `${BASE_URL}/api/mining/connect`,
  MINING_DISCONNECT: `${BASE_URL}/api/mining/disconnect`,
  MINING_STATUS: `${BASE_URL}/api/mining/status`,
  MINING_HEARTBEAT: `${BASE_URL}/api/mining/heartbeat`,
  LAUNCH_STATUS: `${BASE_URL}/api/launch/status`,
  SUPPORT_TICKETS: `${BASE_URL}/api/support/tickets`,
};

const EPOCH_INTERVAL_MS = 5 * 60 * 1000;           // 5 minutes per epoch
const MINING_HEARTBEAT_MS = 30 * 1000;            // POST /api/mining/heartbeat every 30s (EARNS TOKENS)
const STATUS_POLL_MS = 15 * 1000;                 // GET /api/mining/status every 15s (read-only check)
const LAUNCH_POLL_MS = 30 * 1000;                 // GET /api/launch/status every 30s (keep-alive)
const TICKETS_POLL_MS = 60 * 1000;                // GET /api/support/tickets every 60s (keep-alive)
const DEVICE_RECONNECT_BUFFER_MS = 10 * 1000;     // Reconnect device 10s before epoch ends
const MAX_RETRY = 5;
const BASE_DELAY_MS = 2000;
const MAX_CONCURRENT_ACCOUNTS = 0;                 // 0 = run ALL accounts, or set limit (e.g., 5)
const MAX_LOGS = 5;
const PROXY_HEALTH_WINDOW_MS = 5 * 60 * 1000;     // Track proxy health over 5 minutes
const PROXY_ROTATE_ON_FAILS = 3;                   // Rotate to next proxy after 3 consecutive failures
const PROXY_ROTATE_INTERVAL_MS = 30 * 60 * 1000;  // Optional: rotate proxy every 30 min (0 = disabled)
const FINGERPRINT_FILE = 'device_fingerprints.json';
const TOKENS_FILE = 'tokens.json';
const ACCOUNTS_FILE = 'accounts.json';

// ============================================================
// REALISTIC DEVICE BLUEPRINTS (Multi-Device Anti-Detect)
// ============================================================
// Each blueprint is a COMPLETE real-world machine profile.
// Every field is internally consistent: GPU matches OS,
// V8 engine matches Chrome version, viewport fits screen,
// fonts match OS, cores/memory are realistic combos, etc.
// ============================================================
const DEVICE_BLUEPRINTS = [
  // ── WINDOWS MACHINES ──────────────────────────────────────
  { // Win Desktop — Intel Iris Xe, i7-1165G7
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
    secChUa: '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
    platform: 'Windows', os: 'Win32', engine: 'V8 14.4.83',
    gpu: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    screens: ['1920x1080', '2560x1440'], viewports: ['1920x937', '1903x937', '2560x1317'],
    cores: 8, memory: '8GB', pixelRatio: 1, colorDepth: '24-bit',
    fonts: 'Inter, Arial, Helvetica, Times New Roman, Courier New, Segoe UI, Tahoma, Verdana, Calibri',
    webglExt: 'ANGLE, EXT_texture_filter_anisotropic, OES_standard_derivatives, WEBGL_lose_context',
  },
  { // Win Desktop — NVIDIA GTX 1650, Ryzen 5
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    secChUa: '"Not(A:Brand";v="8", "Chromium";v="143", "Google Chrome";v="143"',
    platform: 'Windows', os: 'Win32', engine: 'V8 14.3.56',
    gpu: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    screens: ['1920x1080', '1366x768'], viewports: ['1920x937', '1903x969', '1366x625'],
    cores: 6, memory: '16GB', pixelRatio: 1, colorDepth: '24-bit',
    fonts: 'Inter, Arial, Helvetica, Times New Roman, Courier New, Segoe UI, Tahoma, Georgia, Impact',
    webglExt: 'ANGLE, EXT_texture_filter_anisotropic, OES_standard_derivatives, WEBGL_lose_context, EXT_blend_minmax',
  },
  { // Win Desktop — NVIDIA RTX 3060, i7-12700K
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
    secChUa: '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
    platform: 'Windows', os: 'Win32', engine: 'V8 14.4.83',
    gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    screens: ['2560x1440', '1920x1080', '3840x2160'], viewports: ['2560x1317', '1920x969', '3840x2057'],
    cores: 12, memory: '32GB', pixelRatio: 1, colorDepth: '24-bit',
    fonts: 'Inter, Arial, Helvetica, Times New Roman, Courier New, Segoe UI, Tahoma, Verdana, Calibri, Consolas',
    webglExt: 'ANGLE, EXT_texture_filter_anisotropic, OES_standard_derivatives, WEBGL_lose_context, EXT_blend_minmax, OES_element_index_uint',
  },
  { // Win Desktop — Intel UHD 630, i5-9600K
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    secChUa: '"Not(A:Brand";v="8", "Chromium";v="142", "Google Chrome";v="142"',
    platform: 'Windows', os: 'Win32', engine: 'V8 14.2.120',
    gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E92) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    screens: ['1920x1080', '1680x1050'], viewports: ['1920x937', '1680x917'],
    cores: 6, memory: '16GB', pixelRatio: 1, colorDepth: '24-bit',
    fonts: 'Inter, Arial, Helvetica, Times New Roman, Courier New, Segoe UI, Tahoma, Verdana, Trebuchet MS',
    webglExt: 'ANGLE, EXT_texture_filter_anisotropic, OES_standard_derivatives, WEBGL_lose_context',
  },
  { // Win Laptop — Intel HD 620, i5-7200U
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    secChUa: '"Not(A:Brand";v="8", "Chromium";v="143", "Google Chrome";v="143"',
    platform: 'Windows', os: 'Win32', engine: 'V8 14.3.56',
    gpu: 'ANGLE (Intel, Intel(R) HD Graphics 620 (0x00005916) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    screens: ['1366x768', '1536x864'], viewports: ['1366x625', '1536x722'],
    cores: 4, memory: '8GB', pixelRatio: 1, colorDepth: '24-bit',
    fonts: 'Inter, Arial, Helvetica, Times New Roman, Courier New, Segoe UI, Tahoma, Verdana',
    webglExt: 'ANGLE, EXT_texture_filter_anisotropic, OES_standard_derivatives, WEBGL_lose_context',
  },
  { // Win Desktop — AMD Radeon RX 580, Ryzen 7
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
    secChUa: '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
    platform: 'Windows', os: 'Win32', engine: 'V8 14.4.83',
    gpu: 'ANGLE (AMD, AMD Radeon RX 580 (0x000067DF) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    screens: ['1920x1080', '2560x1080'], viewports: ['1920x937', '2560x937'],
    cores: 8, memory: '16GB', pixelRatio: 1, colorDepth: '24-bit',
    fonts: 'Inter, Arial, Helvetica, Times New Roman, Courier New, Segoe UI, Tahoma, Verdana, Calibri',
    webglExt: 'ANGLE, EXT_texture_filter_anisotropic, OES_standard_derivatives, WEBGL_lose_context, EXT_blend_minmax',
  },
  { // Win Desktop — NVIDIA RTX 4070, i9-13900K
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
    secChUa: '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
    platform: 'Windows', os: 'Win32', engine: 'V8 14.4.83',
    gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    screens: ['2560x1440', '3840x2160'], viewports: ['2560x1317', '3840x2057'],
    cores: 16, memory: '32GB', pixelRatio: 1, colorDepth: '24-bit',
    fonts: 'Inter, Arial, Helvetica, Times New Roman, Courier New, Segoe UI, Tahoma, Verdana, Calibri, Consolas, Cascadia Code',
    webglExt: 'ANGLE, EXT_texture_filter_anisotropic, OES_standard_derivatives, WEBGL_lose_context, EXT_blend_minmax, OES_element_index_uint, WEBGL_compressed_texture_s3tc',
  },
  { // Win Laptop — NVIDIA GTX 1050, i7-7700HQ
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    secChUa: '"Not(A:Brand";v="8", "Chromium";v="142", "Google Chrome";v="142"',
    platform: 'Windows', os: 'Win32', engine: 'V8 14.2.120',
    gpu: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)',
    screens: ['1920x1080', '1536x864'], viewports: ['1920x937', '1536x722'],
    cores: 4, memory: '8GB', pixelRatio: 1, colorDepth: '24-bit',
    fonts: 'Inter, Arial, Helvetica, Times New Roman, Courier New, Segoe UI, Tahoma, Verdana',
    webglExt: 'ANGLE, EXT_texture_filter_anisotropic, OES_standard_derivatives, WEBGL_lose_context, EXT_blend_minmax',
  },
  { // Win Desktop — AMD RX 6600 XT, Ryzen 5 5600X
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    secChUa: '"Not(A:Brand";v="8", "Chromium";v="143", "Google Chrome";v="143"',
    platform: 'Windows', os: 'Win32', engine: 'V8 14.3.56',
    gpu: 'ANGLE (AMD, AMD Radeon RX 6600 XT (0x000073FF) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    screens: ['1920x1080', '2560x1440'], viewports: ['1920x937', '2560x1317'],
    cores: 6, memory: '16GB', pixelRatio: 1, colorDepth: '24-bit',
    fonts: 'Inter, Arial, Helvetica, Times New Roman, Courier New, Segoe UI, Tahoma, Verdana, Calibri',
    webglExt: 'ANGLE, EXT_texture_filter_anisotropic, OES_standard_derivatives, WEBGL_lose_context, EXT_blend_minmax, OES_element_index_uint',
  },
  { // Win Desktop — NVIDIA RTX 2060, i5-10400F
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
    secChUa: '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
    platform: 'Windows', os: 'Win32', engine: 'V8 14.4.83',
    gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    screens: ['1920x1080'], viewports: ['1920x937', '1903x969'],
    cores: 6, memory: '16GB', pixelRatio: 1, colorDepth: '24-bit',
    fonts: 'Inter, Arial, Helvetica, Times New Roman, Courier New, Segoe UI, Tahoma, Verdana, Georgia',
    webglExt: 'ANGLE, EXT_texture_filter_anisotropic, OES_standard_derivatives, WEBGL_lose_context, EXT_blend_minmax',
  },
  // ── MACOS MACHINES ────────────────────────────────────────
  { // MacBook Pro — Apple M1
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
    secChUa: '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
    platform: 'macOS', os: 'MacIntel', engine: 'V8 14.4.83',
    gpu: 'ANGLE (Apple, Apple M1, OpenGL 4.1)',
    screens: ['2560x1600', '1440x900'], viewports: ['1440x789', '2560x1419'],
    cores: 8, memory: '8GB', pixelRatio: 2, colorDepth: '30-bit',
    fonts: 'Inter, Arial, Helvetica, Times New Roman, Courier New, San Francisco, Helvetica Neue, Menlo, Monaco',
    webglExt: 'ANGLE, EXT_texture_filter_anisotropic, OES_standard_derivatives, WEBGL_lose_context, EXT_blend_minmax',
  },
  { // MacBook Air — Apple M2
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    secChUa: '"Not(A:Brand";v="8", "Chromium";v="143", "Google Chrome";v="143"',
    platform: 'macOS', os: 'MacIntel', engine: 'V8 14.3.56',
    gpu: 'ANGLE (Apple, Apple M2, OpenGL 4.1)',
    screens: ['2560x1664', '1470x956'], viewports: ['1470x823', '2560x1500'],
    cores: 8, memory: '16GB', pixelRatio: 2, colorDepth: '30-bit',
    fonts: 'Inter, Arial, Helvetica, Times New Roman, Courier New, San Francisco, Helvetica Neue, Menlo, Monaco, Avenir',
    webglExt: 'ANGLE, EXT_texture_filter_anisotropic, OES_standard_derivatives, WEBGL_lose_context, EXT_blend_minmax, OES_element_index_uint',
  },
  { // iMac — Intel i5, AMD Radeon Pro 5300
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    secChUa: '"Not(A:Brand";v="8", "Chromium";v="142", "Google Chrome";v="142"',
    platform: 'macOS', os: 'MacIntel', engine: 'V8 14.2.120',
    gpu: 'ANGLE (AMD, AMD Radeon Pro 5300 OpenGL Engine, OpenGL 4.1)',
    screens: ['5120x2880', '2560x1440'], viewports: ['2560x1317', '1280x657'],
    cores: 6, memory: '8GB', pixelRatio: 2, colorDepth: '30-bit',
    fonts: 'Inter, Arial, Helvetica, Times New Roman, Courier New, San Francisco, Helvetica Neue, Menlo, Monaco',
    webglExt: 'ANGLE, EXT_texture_filter_anisotropic, OES_standard_derivatives, WEBGL_lose_context',
  },
  { // MacBook Pro 16" — Apple M1 Pro
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
    secChUa: '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
    platform: 'macOS', os: 'MacIntel', engine: 'V8 14.4.83',
    gpu: 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)',
    screens: ['3456x2234', '1728x1117'], viewports: ['1728x968', '3456x2085'],
    cores: 10, memory: '16GB', pixelRatio: 2, colorDepth: '30-bit',
    fonts: 'Inter, Arial, Helvetica, Times New Roman, Courier New, San Francisco, Helvetica Neue, Menlo, Monaco, Avenir, Futura',
    webglExt: 'ANGLE, EXT_texture_filter_anisotropic, OES_standard_derivatives, WEBGL_lose_context, EXT_blend_minmax, OES_element_index_uint',
  },
  // ── LINUX MACHINES ────────────────────────────────────────
  { // Ubuntu — NVIDIA GTX 1660 (Mesa)
    ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
    secChUa: '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
    platform: 'Linux', os: 'Linux x86_64', engine: 'V8 14.4.83',
    gpu: 'ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1660/PCIe/SSE2, OpenGL 4.6.0)',
    screens: ['1920x1080', '2560x1440'], viewports: ['1920x955', '2560x1335'],
    cores: 8, memory: '16GB', pixelRatio: 1, colorDepth: '24-bit',
    fonts: 'Inter, Arial, Helvetica, Times New Roman, Courier New, DejaVu Sans, Liberation Sans, Noto Sans, Ubuntu',
    webglExt: 'ANGLE, EXT_texture_filter_anisotropic, OES_standard_derivatives, WEBGL_lose_context, EXT_blend_minmax',
  },
  { // Fedora — Intel Mesa UHD 770
    ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    secChUa: '"Not(A:Brand";v="8", "Chromium";v="143", "Google Chrome";v="143"',
    platform: 'Linux', os: 'Linux x86_64', engine: 'V8 14.3.56',
    gpu: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 770 (ADL-S GT1), OpenGL 4.6)',
    screens: ['1920x1080', '1366x768'], viewports: ['1920x955', '1366x643'],
    cores: 8, memory: '32GB', pixelRatio: 1, colorDepth: '24-bit',
    fonts: 'Inter, Arial, Helvetica, Times New Roman, Courier New, DejaVu Sans, Liberation Sans, Noto Sans, Cantarell',
    webglExt: 'ANGLE, EXT_texture_filter_anisotropic, OES_standard_derivatives, WEBGL_lose_context',
  },
  { // Ubuntu — AMD RX 570 (Mesa RADV)
    ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    secChUa: '"Not(A:Brand";v="8", "Chromium";v="142", "Google Chrome";v="142"',
    platform: 'Linux', os: 'Linux x86_64', engine: 'V8 14.2.120',
    gpu: 'ANGLE (AMD, Mesa AMD Radeon RX 570 (RADV POLARIS10), OpenGL 4.6)',
    screens: ['1920x1080'], viewports: ['1920x955', '1903x955'],
    cores: 6, memory: '8GB', pixelRatio: 1, colorDepth: '24-bit',
    fonts: 'Inter, Arial, Helvetica, Times New Roman, Courier New, DejaVu Sans, Liberation Sans, Noto Sans, Ubuntu',
    webglExt: 'ANGLE, EXT_texture_filter_anisotropic, OES_standard_derivatives, WEBGL_lose_context, EXT_blend_minmax',
  },
  { // Pop!_OS — NVIDIA RTX 3070 (proprietary)
    ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
    secChUa: '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
    platform: 'Linux', os: 'Linux x86_64', engine: 'V8 14.4.83',
    gpu: 'ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3070/PCIe/SSE2, OpenGL 4.6.0)',
    screens: ['2560x1440', '3440x1440'], viewports: ['2560x1335', '3440x1335'],
    cores: 12, memory: '32GB', pixelRatio: 1, colorDepth: '24-bit',
    fonts: 'Inter, Arial, Helvetica, Times New Roman, Courier New, DejaVu Sans, Liberation Sans, Noto Sans, Fira Sans',
    webglExt: 'ANGLE, EXT_texture_filter_anisotropic, OES_standard_derivatives, WEBGL_lose_context, EXT_blend_minmax, OES_element_index_uint, WEBGL_compressed_texture_s3tc',
  },
];

// Timezone & Locale pools (per-account variation)
const TIMEZONE_POOL = ['Asia/Jakarta', 'Asia/Jakarta', 'Asia/Jakarta', 'Asia/Makassar', 'Asia/Singapore', 'America/New_York', 'Europe/London', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney'];
const LOCALE_POOL = [
  { locale: 'en-US', prefLangs: 'en-US, en, id', acceptLang: 'en-US,en;q=0.9,id;q=0.8' },
  { locale: 'en-US', prefLangs: 'en-US, en', acceptLang: 'en-US,en;q=0.9' },
  { locale: 'en-GB', prefLangs: 'en-GB, en', acceptLang: 'en-GB,en;q=0.9,en-US;q=0.8' },
  { locale: 'id-ID', prefLangs: 'id-ID, id, en', acceptLang: 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7' },
  { locale: 'en-US', prefLangs: 'en-US, en, id', acceptLang: 'en-US,en;q=0.9,id;q=0.8' },
];

// ============================================================
// GLOBAL STATE (Dashboard)
// ============================================================
const state = {
  accounts: [],
  logs: [],
  startTime: Date.now(),
};

// ============================================================
// LOGGER (Centralized — NO console.log in logic)
// ============================================================
function logger(accountLabel, message, type = 'info') {
  const now = new Date();
  const time = now.toLocaleTimeString('en-GB', { hour12: false });
  const icons = { info: '🔄', success: '✅', error: '❌', warn: '⚠️', data: '📊', list: '📋' };
  const icon = icons[type] || '•';
  const colors = { info: chalk.blue, success: chalk.green, error: chalk.red, warn: chalk.yellow, data: chalk.magenta, list: chalk.cyan };
  const colorFn = colors[type] || chalk.white;
  const logLine = `[${time}] [${accountLabel}] ${icon} ${message}`;
  state.logs.push(colorFn(logLine));
  if (state.logs.length > MAX_LOGS) state.logs = state.logs.slice(-MAX_LOGS);
  renderDashboard();
}

// ============================================================
// BANNER
// ============================================================
function printBanner() {
  return chalk.blue(`
               / \\
              /   \\
             |  |  |
             |  |  |
              \\  \\
             |  |  |
             |  |  |
              \\   /
               \\ /
`) + '\n' +
    chalk.bold.cyan('    ======SIPAL AIRDROP======\n') +
    chalk.bold.cyan('  =====SIPAL DELTAHASH V1.0=====\n');
}

// ============================================================
// DASHBOARD RENDERER
// ============================================================
function renderDashboard() {
  const output = [];
  output.push('\x1B[2J\x1B[H'); // clear screen
  output.push(printBanner());

  const table = new Table({
    head: ['Account', 'Status', 'Balance', 'Speed', 'Epoch', 'Earned', 'Proxy', 'Last HB', 'Next Epoch'],
    style: { head: ['cyan'], border: ['grey'] },
    colWidths: [12, 14, 12, 10, 8, 10, 16, 18, 18],
  });

  for (const acc of state.accounts) {
    const statusColor = {
      'WAITING': chalk.gray,
      'PROCESSING': chalk.yellow,
      'CONNECTED': chalk.green,
      'MINING': chalk.greenBright,
      'RECONNECTING': chalk.yellow,
      'AUTH_EXPIRED': chalk.magenta,
      'FAILED': chalk.red,
    }[acc.status] || chalk.white;

    table.push([
      chalk.white(acc.label),
      statusColor(acc.status),
      chalk.green(acc.balance !== null ? `${acc.balance} $DTH` : '-'),
      chalk.cyan(acc.speed !== null ? `${acc.speed}/min` : '-'),
      chalk.yellow(acc.epoch !== null ? `#${acc.epoch}` : '-'),
      chalk.greenBright(acc.totalEarned !== null ? `+${acc.totalEarned}` : '-'),
      chalk.gray(acc.proxyLabel || 'Direct'),
      chalk.gray(acc.lastRun || '-'),
      chalk.cyan(acc.nextRun || '-'),
    ]);
  }

  output.push(table.toString());
  output.push('');
  output.push(chalk.bold.cyan('═══════════════════ EXECUTION LOGS ═══════════════════'));
  output.push('');

  const recentLogs = state.logs.slice(-30);
  for (const log of recentLogs) {
    output.push(log);
  }

  process.stdout.write(output.join('\n') + '\n');
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function sleep(ms) {
  const jitter = ms * 0.3;
  const actual = ms + (Math.random() * jitter * 2 - jitter);
  return new Promise(resolve => setTimeout(resolve, Math.max(100, actual)));
}

function microPause() {
  return sleep(200 + Math.random() * 1800);
}

function deterministicHash(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function formatDateTime(date) {
  if (!date) return '-';
  const d = new Date(date);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  return `${h}:${m} ${day}/${mon}`;
}

function loadJson(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return fallback;
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ============================================================
// PERSISTENT DEVICE FINGERPRINT (Blueprint-based)
// ============================================================

function getOrCreateFingerprint(accountId) {
  const fingerprints = loadJson(FINGERPRINT_FILE, {});
  if (fingerprints[accountId]) return fingerprints[accountId];

  // Deterministic selection: hash the accountId to pick a consistent blueprint
  const hash = deterministicHash(accountId);
  const bpIdx = parseInt(hash.slice(0, 8), 16) % DEVICE_BLUEPRINTS.length;
  const bp = DEVICE_BLUEPRINTS[bpIdx];

  // Pick screen/viewport from the blueprint's compatible list
  const screenIdx = parseInt(hash.slice(8, 10), 16) % bp.screens.length;
  const viewportIdx = parseInt(hash.slice(10, 12), 16) % bp.viewports.length;

  // Pick timezone & locale
  const tzIdx = parseInt(hash.slice(12, 14), 16) % TIMEZONE_POOL.length;
  const lcIdx = parseInt(hash.slice(14, 16), 16) % LOCALE_POOL.length;
  const localeEntry = LOCALE_POOL[lcIdx];

  // Generate unique but realistic-looking hashes for this "device"
  const canvasHash = deterministicHash(hash + 'canvas').slice(0, 32);
  const webglHash = deterministicHash(hash + 'webgl').slice(0, 32);
  const audioHash = deterministicHash(hash + 'audio').slice(0, 32);

  // Slight variation in DOM Complete timing (per device — stays constant)
  const domComplete = 80 + (parseInt(hash.slice(16, 18), 16) % 200);

  const fp = {
    // Browser identity (all from same blueprint = consistent)
    userAgent: bp.ua,
    platform: bp.platform,
    secChUa: bp.secChUa,
    os: bp.os,
    engine: bp.engine,
    browser: 'Chrome / Blink',
    deviceType: 'Desktop Workstation',
    // Hardware (matched to blueprint)
    gpu: bp.gpu,
    cores: bp.cores,
    memory: bp.memory,
    screenRes: bp.screens[screenIdx],
    viewport: bp.viewports[viewportIdx],
    pixelRatio: bp.pixelRatio,
    colorDepth: bp.colorDepth,
    // Hashes (unique per account, realistic format)
    canvasHash,
    webglHash,
    audioHash,
    // Locale & TZ
    locale: localeEntry.locale,
    timezone: TIMEZONE_POOL[tzIdx],
    prefLangs: localeEntry.prefLangs,
    acceptLang: localeEntry.acceptLang,
    // Capabilities (from blueprint)
    fonts: bp.fonts,
    webglExt: bp.webglExt,
    // Performance baseline for this device
    domComplete,
  };

  fingerprints[accountId] = fp;
  saveJson(FINGERPRINT_FILE, fingerprints);
  return fp;
}

function buildDeviceData(fp) {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const mon = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  // Slight timing variation per request, but anchored to the device's baseline
  const jitter = Math.floor(Math.random() * 40) - 20;
  const perfTiming = `Navigation Start: 0ms, DOM Complete: ${fp.domComplete + jitter}ms`;

  return {
    browser: fp.browser,
    os: fp.os,
    userAgent: fp.userAgent,
    platform: 'Desktop',
    engine: fp.engine,
    deviceType: fp.deviceType,
    screenRes: fp.screenRes,
    viewport: fp.viewport,
    pixelRatio: fp.pixelRatio,
    colorDepth: fp.colorDepth,
    locale: fp.locale,
    timezone: fp.timezone,
    canvasHash: fp.canvasHash,
    webglHash: fp.webglHash,
    gpu: fp.gpu,
    audioHash: fp.audioHash,
    cores: fp.cores,
    memory: fp.memory,
    fonts: fp.fonts,
    codecs: 'H.264, VP9, AV1, AAC, MP3, Opus',
    quirks: 'Gecko-like, WebKit-prefixed',
    extensions: fp.webglExt,
    perfTiming,
    language: fp.locale,
    prefLangs: fp.prefLangs,
    dateFormat: `${day}/${mon}/${year}`,
    cookies: 'Enabled',
    localStorage: 'Available',
    sessionStorage: 'Available',
    indexedDb: 'Available',
    doNotTrack: 'Unspecified',
    touch: 'None',
    pointer: 'Mouse/Trackpad',
    webgl: 'WebGL 2.0 Supported',
  };
}

// ============================================================
// PROXY MANAGER — Multi-Proxy Rotation & Health Tracking
// ============================================================
// Supports:
//   - Single proxy (string): "http://user:pass@host:port"
//   - Multi-proxy (array):   ["http://...", "socks5://...", ...]
//   - No proxy (empty):      "" or []
//   - Auto-failover on consecutive errors
//   - Round-robin rotation
//   - Health stats per proxy
// ============================================================

class ProxyManager {
  constructor(proxyConfig, label = '') {
    this.label = label;
    this.proxies = this._normalize(proxyConfig);
    this.currentIndex = 0;
    this.health = new Map(); // proxyStr -> { successes, failures, consecutiveFails, lastUsed, lastError }
    this.rotateCount = 0;
    this.lastRotateTime = Date.now();

    // Initialize health tracking for each proxy
    for (const p of this.proxies) {
      this.health.set(p, {
        successes: 0,
        failures: 0,
        consecutiveFails: 0,
        lastUsed: null,
        lastError: null,
        totalRequests: 0,
      });
    }
  }

  /** Normalize proxy config to array */
  _normalize(proxyConfig) {
    if (!proxyConfig) return [''];
    if (Array.isArray(proxyConfig)) {
      const filtered = proxyConfig.filter(p => typeof p === 'string');
      return filtered.length > 0 ? filtered : [''];
    }
    if (typeof proxyConfig === 'string') return [proxyConfig];
    return [''];
  }

  /** Check if this manager has multiple proxies */
  hasMultiple() {
    // Count actual proxies (non-empty strings)
    const real = this.proxies.filter(p => p.length > 0);
    return real.length > 1;
  }

  /** Total proxy count */
  count() {
    return this.proxies.filter(p => p.length > 0).length;
  }

  /** Get current proxy string */
  current() {
    return this.proxies[this.currentIndex] || '';
  }

  /** Get masked proxy string for display */
  currentMasked() {
    const p = this.current();
    if (!p) return 'Direct (no proxy)';
    return p.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
  }

  /** Get short label like "Proxy 1/3" */
  currentLabel() {
    if (!this.hasMultiple() && !this.current()) return 'Direct';
    if (!this.hasMultiple()) return 'Proxy';
    return `Proxy ${this.currentIndex + 1}/${this.proxies.length}`;
  }

  /** Create agent for current proxy */
  createAgent() {
    const proxyStr = this.current();
    if (!proxyStr) return { httpsAgent: undefined, httpAgent: undefined };
    if (proxyStr.startsWith('socks')) {
      return {
        httpsAgent: new SocksProxyAgent(proxyStr),
        httpAgent: new SocksProxyAgent(proxyStr),
      };
    }
    return {
      httpsAgent: new HttpsProxyAgent(proxyStr),
      httpAgent: new HttpsProxyAgent(proxyStr),
    };
  }

  /** Record a successful request */
  recordSuccess() {
    const h = this.health.get(this.current());
    if (h) {
      h.successes++;
      h.totalRequests++;
      h.consecutiveFails = 0;
      h.lastUsed = Date.now();
    }
  }

  /** Record a failed request. Returns true if proxy was rotated. */
  recordFailure(errorMsg) {
    const h = this.health.get(this.current());
    if (h) {
      h.failures++;
      h.totalRequests++;
      h.consecutiveFails++;
      h.lastUsed = Date.now();
      h.lastError = errorMsg;
    }

    // Auto-rotate on consecutive failures (only if multi-proxy)
    if (this.hasMultiple() && h && h.consecutiveFails >= PROXY_ROTATE_ON_FAILS) {
      this.rotate('consecutive_failures');
      return true;
    }
    return false;
  }

  /** Rotate to next proxy (round-robin) */
  rotate(reason = 'manual') {
    if (this.proxies.length <= 1) return false;
    const prevIndex = this.currentIndex;
    this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
    this.rotateCount++;
    this.lastRotateTime = Date.now();

    // Reset consecutive fails for new proxy
    const h = this.health.get(this.current());
    if (h) h.consecutiveFails = 0;

    logger(this.label, `Proxy rotated: ${prevIndex + 1}→${this.currentIndex + 1}/${this.proxies.length} (reason: ${reason}) | Now: ${this.currentMasked()}`, 'warn');
    return true;
  }

  /** Check if should do timed rotation */
  shouldTimeRotate() {
    if (PROXY_ROTATE_INTERVAL_MS <= 0) return false;
    if (this.proxies.length <= 1) return false;
    return (Date.now() - this.lastRotateTime) >= PROXY_ROTATE_INTERVAL_MS;
  }

  /** Get health stats for all proxies */
  getStats() {
    return this.proxies.map((p, i) => {
      const h = this.health.get(p) || {};
      const total = h.totalRequests || 0;
      const successRate = total > 0 ? ((h.successes / total) * 100).toFixed(1) : 'N/A';
      return {
        index: i + 1,
        proxy: p ? p.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@') : 'Direct',
        active: i === this.currentIndex,
        successes: h.successes || 0,
        failures: h.failures || 0,
        successRate: successRate + '%',
        consecutiveFails: h.consecutiveFails || 0,
        lastError: h.lastError || null,
      };
    });
  }
}

// Store ProxyManagers per account
const proxyManagers = new Map();

// ============================================================
// HTTP CLIENT WITH PROXY & HEADERS
// ============================================================

function createAxiosClient(account, fp, proxyManager) {
  const headers = {
    'accept': '*/*',
    'accept-encoding': 'gzip, deflate, br, zstd',
    'accept-language': fp.acceptLang || 'en-US,en;q=0.9,id;q=0.8',
    'cache-control': 'no-cache',
    'content-type': 'application/json',
    'origin': BASE_URL,
    'pragma': 'no-cache',
    'referer': `${BASE_URL}/mining`,
    'sec-ch-ua': fp.secChUa,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': `"${fp.platform}"`,
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': fp.userAgent,
  };

  if (account.cookie) {
    headers['cookie'] = account.cookie.startsWith('connect.sid=') ? account.cookie : `connect.sid=${account.cookie}`;
  }

  const config = {
    baseURL: BASE_URL,
    headers,
    timeout: 30000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  };

  // Apply proxy from ProxyManager
  if (proxyManager) {
    const agents = proxyManager.createAgent();
    if (agents.httpsAgent) {
      config.httpsAgent = agents.httpsAgent;
      config.httpAgent = agents.httpAgent;
    }
  }

  const client = axios.create(config);

  // Interceptor: remove any "Expect" header before sending request
  // Prevents 417 errors — server rejects "Expect: 100-continue" and also empty "Expect: "
  client.interceptors.request.use((reqConfig) => {
    // axios uses AxiosHeaders which has case-insensitive delete
    if (reqConfig.headers) {
      if (typeof reqConfig.headers.delete === 'function') {
        reqConfig.headers.delete('Expect');
      } else {
        delete reqConfig.headers['Expect'];
        delete reqConfig.headers['expect'];
      }
    }
    return reqConfig;
  });

  return client;
}

// ============================================================
// SMART RETRY WITH EXPONENTIAL BACKOFF
// ============================================================

async function smartRequest(client, method, url, data, label, retries = MAX_RETRY, proxyManager = null) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      let response;
      if (method === 'get') {
        response = await client.get(url);
      } else if (data != null) {
        response = await client.post(url, data);
      } else {
        // Empty POST (no body, no content-type) — used by /mining/heartbeat
        response = await client.post(url, undefined, {
          headers: { 'content-type': undefined }
        });
      }
      // Record success for proxy health
      if (proxyManager) proxyManager.recordSuccess();
      return response.data;
    } catch (err) {
      const status = err.response?.status;
      const respData = err.response?.data;
      const msg = respData?.message || err.message;

      // Record failure for proxy health (only network/proxy errors, not auth)
      const isNetworkError = !status || status >= 500 || err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND';
      if (proxyManager && isNetworkError) {
        const rotated = proxyManager.recordFailure(msg);
        if (rotated) {
          // Proxy was rotated — signal caller to rebuild client
          const rotateErr = new Error('PROXY_ROTATED');
          rotateErr.proxyRotated = true;
          throw rotateErr;
        }
      }

      // "Device already connected" with status 400 is actually OK
      if (status === 400 && msg && msg.toLowerCase().includes('already connected')) {
        if (proxyManager) proxyManager.recordSuccess();
        return { success: true, alreadyConnected: true, ...(respData || {}) };
      }

      if (status === 401 || status === 403) {
        logger(label, `Auth error (${status}): ${msg} — Session may have expired`, 'error');
        throw new Error(`AUTH_EXPIRED:${status}`);
      }

      // 429 = Rate limited — use longer backoff
      if (status === 429) {
        const retryAfter = parseInt(err.response?.headers?.['retry-after'] || '30', 10);
        const backoff = Math.max(retryAfter * 1000, BASE_DELAY_MS * Math.pow(2, attempt)) + Math.random() * 5000;
        logger(label, `Rate limited (429) — Waiting ${(backoff / 1000).toFixed(1)}s before retry ${attempt}/${retries}`, 'warn');
        await sleep(backoff);
        continue;
      }

      if (attempt < retries) {
        const backoff = BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 1000;
        logger(label, `Request failed (attempt ${attempt}/${retries}): ${msg} — Retrying in ${(backoff / 1000).toFixed(1)}s`, 'warn');
        await sleep(backoff);
      } else {
        logger(label, `Request failed after ${retries} attempts: ${msg}`, 'error');
        throw err;
      }
    }
  }
}

// ============================================================
// API FUNCTIONS
// ============================================================

async function getAuthMe(client, label) {
  logger(label, 'Fetching user profile...', 'info');
  await microPause();
  const data = await smartRequest(client, 'get', API.AUTH_ME, null, label);
  if (data?.user) {
    logger(label, `Profile loaded — User: ${data.user.username} | Balance: ${data.user.balance} $DTH | Referral: ${data.user.referralCode}`, 'success');
    return data.user;
  }
  throw new Error('Invalid auth/me response');
}

async function getMiningStatus(client, label) {
  logger(label, 'Fetching mining status...', 'info');
  await microPause();
  const data = await smartRequest(client, 'get', API.MINING_STATUS, null, label);
  if (data) {
    const epochInfo = data.epoch ? `Epoch #${data.epoch.number}` : 'N/A';
    logger(label, `Mining Status — ${epochInfo} | Balance: ${data.balance} $DTH | Speed: ${data.miningSpeed}/min | Mining: ${data.isMining ? 'YES' : 'NO'}`, 'data');
    return data;
  }
  throw new Error('Invalid mining/status response');
}

// ── Generate realistic UUID v4 (like browser crypto.randomUUID()) ──
function generateDeviceId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (crypto.randomBytes(1)[0] / 255) * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ============================================================
// QUICK DEVICE CONNECT (1 attempt only — no pointless retries on 500)
// ============================================================
async function quickDeviceConnect(client, fp, label) {
  logger(label, 'Connecting device to mining network...', 'info');
  await microPause();
  const deviceData = buildDeviceData(fp);
  // Only 1 retry — if server 500s, we know it's unregistered and move on fast
  const data = await smartRequest(client, 'post', API.DEVICES_CONNECT, { deviceData }, label, 1);
  if (data?.alreadyConnected) {
    logger(label, 'Device already registered on server — Acknowledged', 'success');
    return data;
  }
  if (data?.success && data?.user) {
    logger(label, `Device connected — ID: ${data.user.deviceId} | Balance: ${data.user.balance} $DTH`, 'success');
    return data;
  }
  logger(label, `Device connect response: ${JSON.stringify(data).slice(0, 200)}`, 'warn');
  return data;
}

// ============================================================
// AUTO-REGISTER DEVICE (for accounts that never mined on web)
// ============================================================
// The error "invalid input syntax for type json" (HTTP 500) is a PostgreSQL
// error: the server's devices table has no record for this user, and the
// server-side code doesn't handle null gracefully.
//
// Strategy: Try EVERY possible registration method (1 attempt each, no
// retries) and then ALWAYS proceed to mining regardless of result.
// The mining/connect + heartbeat endpoints may auto-create the device record.
// ============================================================

async function tryRegisterDevice(client, fp, label) {
  const deviceId = generateDeviceId();
  const deviceData = buildDeviceData(fp);

  logger(label, `⚙️ Device not registered — Auto-registering (ID: ${deviceId.slice(0, 8)}...)`, 'warn');

  // ── Attempt 1: POST /api/devices/connect with deviceId included ──
  // Some servers accept this as "create new device" when deviceId is in payload
  await sleep(1000 + Math.random() * 1500);
  try {
    const res = await client.post(API.DEVICES_CONNECT, { deviceId, deviceData });
    const d = res.data;
    if (d?.success || d?.user || d?.alreadyConnected) {
      logger(label, `✅ Device registered via /devices/connect + deviceId`, 'success');
      return { success: true, deviceId, user: d.user };
    }
    logger(label, `Connect+ID response: ${JSON.stringify(d).slice(0, 120)}`, 'info');
  } catch (e) {
    if (e.response?.status === 401 || e.response?.status === 403) throw new Error('AUTH_EXPIRED:' + e.response.status);
    const msg = e.response?.data?.message || e.message;
    logger(label, `Connect+ID: ${e.response?.status || 'err'} ${msg?.slice(0, 80)}`, 'info');
  }

  // ── Attempt 2: POST /api/devices/connect with flat deviceData (no wrapper) ──
  // Maybe the server expects deviceData at root level, not nested
  await sleep(800 + Math.random() * 1200);
  try {
    const res = await client.post(API.DEVICES_CONNECT, deviceData);
    const d = res.data;
    if (d?.success || d?.user || d?.alreadyConnected) {
      logger(label, `✅ Device registered via /devices/connect (flat payload)`, 'success');
      return { success: true, deviceId, user: d.user };
    }
    logger(label, `Connect-flat response: ${JSON.stringify(d).slice(0, 120)}`, 'info');
  } catch (e) {
    if (e.response?.status === 401 || e.response?.status === 403) throw new Error('AUTH_EXPIRED:' + e.response.status);
    const msg = e.response?.data?.message || e.message;
    logger(label, `Connect-flat: ${e.response?.status || 'err'} ${msg?.slice(0, 80)}`, 'info');
  }

  // ── Attempt 3: POST /api/devices/register (dedicated endpoint, if exists) ──
  await sleep(800 + Math.random() * 1200);
  try {
    const regPayload = {
      deviceId,
      deviceData,
      deviceName: `${fp.platform} Desktop`,
      deviceType: fp.deviceType,
    };
    const res = await client.post(API.DEVICES_REGISTER, regPayload);
    const d = res.data;
    if (d?.success || d?.user || d?.device) {
      logger(label, `✅ Device registered via /devices/register`, 'success');
      return { success: true, deviceId, user: d.user };
    }
    logger(label, `Register response: ${JSON.stringify(d).slice(0, 120)}`, 'info');
  } catch (e) {
    if (e.response?.status === 401 || e.response?.status === 403) throw new Error('AUTH_EXPIRED:' + e.response.status);
    // 404/405 = endpoint doesn't exist — expected
    if (e.response?.status !== 404 && e.response?.status !== 405) {
      const msg = e.response?.data?.message || e.message;
      logger(label, `Register: ${e.response?.status || 'err'} ${msg?.slice(0, 80)}`, 'info');
    }
  }

  // ── Attempt 4: POST /api/mining/connect FIRST (this may auto-create device) ──
  // Key insight: the browser's "Start Mining" button likely calls mining/connect
  // which may internally create the device record on the server side
  await sleep(800 + Math.random() * 1200);
  try {
    const res = await client.post(API.MINING_CONNECT, {});
    const d = res.data;
    if (d) {
      logger(label, `✅ Mining session started (may have auto-registered device)`, 'success');
      // Now try connecting device again — server might have created the record
      await sleep(1500 + Math.random() * 1000);
      try {
        const retry = await client.post(API.DEVICES_CONNECT, { deviceData });
        if (retry.data?.success || retry.data?.user || retry.data?.alreadyConnected) {
          logger(label, `✅ Device connect succeeded after mining/connect`, 'success');
          return { success: true, deviceId, user: retry.data.user, miningStarted: true };
        }
      } catch (retryErr) {
        // Still fails — that's OK, mining is already started
        logger(label, `Device connect still fails after mining/connect — Mining may still work`, 'info');
      }
      return { success: true, deviceId, miningStarted: true };
    }
  } catch (e) {
    if (e.response?.status === 401 || e.response?.status === 403) throw new Error('AUTH_EXPIRED:' + e.response.status);
    const msg = e.response?.data?.message || e.message;
    logger(label, `Mining connect attempt: ${e.response?.status || 'err'} ${msg?.slice(0, 80)}`, 'info');
  }

  // ── Attempt 5: POST /api/mining/heartbeat directly (ultimate fallback) ──
  // Some servers auto-register the device on the first heartbeat
  await sleep(800 + Math.random() * 1200);
  try {
    const res = await client.post(API.MINING_HEARTBEAT, undefined, {
      headers: { 'content-type': undefined }
    });
    const d = res.data;
    if (d?.success) {
      logger(label, `✅ First heartbeat accepted — Device auto-registered by server`, 'success');
      return { success: true, deviceId, miningStarted: true, heartbeatOk: true, heartbeatData: d };
    }
    if (d?.disconnected) {
      logger(label, `Heartbeat says disconnected — Will keep trying via mining loop`, 'info');
    }
  } catch (e) {
    if (e.response?.status === 401 || e.response?.status === 403) throw new Error('AUTH_EXPIRED:' + e.response.status);
    const msg = e.response?.data?.message || e.message;
    logger(label, `Direct heartbeat: ${e.response?.status || 'err'} ${msg?.slice(0, 80)}`, 'info');
  }

  // All attempts exhausted — proceed to mining loop anyway
  logger(label, `⚠️ All registration attempts exhausted — Proceeding to mining loop (will retry periodically)`, 'warn');
  return { success: false, deviceId };
}

async function startMining(client, label) {
  logger(label, 'Starting mining session (POST /api/mining/connect)...', 'info');
  await microPause();
  try {
    const data = await smartRequest(client, 'post', API.MINING_CONNECT, {}, label, 3);
    logger(label, `Mining session started successfully`, 'success');
    return data;
  } catch (e) {
    logger(label, `Mining connect failed: ${e.message}`, 'warn');
    throw e;
  }
}

async function stopMining(client, label) {
  try {
    await client.post(API.MINING_DISCONNECT);
    logger(label, 'Mining session disconnected', 'info');
  } catch (e) {
    // Silent — best effort disconnect
  }
}

async function sendMiningHeartbeat(client, label) {
  const data = await smartRequest(client, 'post', API.MINING_HEARTBEAT, null, label, 3);
  return data;
}

async function dummyTraffic(client, label) {
  logger(label, 'Warming up session (dummy traffic)...', 'info');
  try {
    await smartRequest(client, 'get', API.LAUNCH_STATUS, null, label, 2);
    logger(label, 'Launch status fetched (warm-up)', 'info');
    await sleep(500 + Math.random() * 1000);
    await smartRequest(client, 'get', API.SUPPORT_TICKETS, null, label, 2);
    logger(label, 'Support tickets fetched (warm-up)', 'info');
  } catch (e) {
    logger(label, `Warm-up traffic failed (non-critical): ${e.message}`, 'warn');
  }
}

// ============================================================
// SAVED TOKENS / SESSION MANAGEMENT
// ============================================================

function loadTokens() {
  return loadJson(TOKENS_FILE, {});
}

function saveTokenData(accountId, tokenData) {
  const tokens = loadTokens();
  tokens[accountId] = { ...tokenData, updatedAt: new Date().toISOString() };
  saveJson(TOKENS_FILE, tokens);
}

// ============================================================
// INITIAL SETUP (One-time per connection: warmup → auth → connect)
// ============================================================

async function initialSetup(client, fp, account, index) {
  const label = `Account ${index + 1}`;
  const accState = state.accounts[index];

  accState.status = 'PROCESSING';
  accState.lastRun = formatDateTime(new Date());
  renderDashboard();

  // 1. Warm up with dummy traffic (mimics real browser page load)
  await dummyTraffic(client, label);
  await sleep(1000 + Math.random() * 2000);

  // 2. Auth check
  const user = await getAuthMe(client, label);
  accState.balance = user.balance;
  if (user.deviceConnected) {
    logger(label, `Device status: Connected | Streak: ${user.miningStreakDays} days`, 'info');
  } else {
    logger(label, 'Device status: Not connected — Will register now', 'info');
  }
  renderDashboard();

  await sleep(800 + Math.random() * 1500);

  // 3. Connect device — FAST (1 attempt, no useless retries on 500)
  let deviceConnected = false;
  let miningAlreadyStarted = false;

  try {
    const connectResult = await quickDeviceConnect(client, fp, label);
    if (connectResult?.user) {
      accState.deviceId = connectResult.user.deviceId;
      accState.balance = connectResult.user.balance;
      deviceConnected = true;
    } else if (connectResult?.alreadyConnected) {
      accState.deviceId = accState.deviceId || 'Connected';
      deviceConnected = true;
    }
  } catch (connectErr) {
    if (connectErr.message?.startsWith('AUTH_EXPIRED')) throw connectErr;

    // ── UNREGISTERED DEVICE → AUTO-REGISTER ──
    const errStatus = connectErr.response?.status;
    const errMsg = connectErr.response?.data?.message || connectErr.message || '';

    logger(label, `Device connect failed (${errStatus || 'err'}): ${errMsg.slice(0, 80)} — Auto-registering...`, 'warn');

    const regResult = await tryRegisterDevice(client, fp, label);

    if (regResult.success) {
      accState.deviceId = regResult.deviceId || 'Registered';
      if (regResult.user) accState.balance = regResult.user.balance || accState.balance;
      deviceConnected = true;
      miningAlreadyStarted = !!regResult.miningStarted;

      // If registration included heartbeat data, update stats
      if (regResult.heartbeatOk && regResult.heartbeatData) {
        const hbd = regResult.heartbeatData;
        accState.balance = hbd.newBalance || accState.balance;
        accState.totalEarned = (accState.totalEarned || 0) + (hbd.tokensEarned || 0);
        accState.epoch = hbd.epochNumber;
      }
    } else {
      accState.deviceId = regResult.deviceId || 'Pending';
      logger(label, '⚠️ Device registration incomplete — Mining may still work', 'warn');
    }
  }
  renderDashboard();

  await sleep(1000 + Math.random() * 2000);

  // 4. Initial mining status check
  let miningData;
  try {
    miningData = await getMiningStatus(client, label);
    accState.balance = miningData.balance || miningData.userBalance || accState.balance;
    accState.speed = miningData.miningSpeed;
    accState.epoch = miningData.epoch?.number;
    accState.baseRate = miningData.baseRate;
  } catch (statusErr) {
    if (statusErr.message?.startsWith('AUTH_EXPIRED')) throw statusErr;
    logger(label, `Mining status check failed: ${statusErr.message} — Continuing...`, 'warn');
    miningData = { epoch: {}, balance: accState.balance, miningSpeed: null, baseRate: null };
  }

  // 5. Start mining session (skip if already started during registration)
  if (!miningAlreadyStarted) {
    await sleep(500 + Math.random() * 1000);
    try {
      await startMining(client, label);
    } catch (mineErr) {
      if (mineErr.message?.startsWith('AUTH_EXPIRED')) throw mineErr;
      logger(label, `Mining connect failed: ${mineErr.message} — Will retry on first heartbeat`, 'warn');
    }
  } else {
    logger(label, 'Mining session already started during registration — Skipping', 'info');
  }

  // 6. Send first mining heartbeat to verify mining is active
  await sleep(1000 + Math.random() * 1000);
  try {
    const hbResult = await sendMiningHeartbeat(client, label);
    if (hbResult?.disconnected) {
      logger(label, 'First heartbeat says disconnected — retrying mining/connect...', 'warn');
      try {
        await startMining(client, label);
        await sleep(2000);
        const hb2 = await sendMiningHeartbeat(client, label);
        if (hb2?.success) {
          accState.balance = hb2.newBalance;
          accState.totalEarned = (accState.totalEarned || 0) + (hb2.tokensEarned || 0);
          logger(label, `Heartbeat OK after reconnect — Balance: ${hb2.newBalance} $DTH`, 'success');
        }
      } catch (reconnErr) {
        if (reconnErr.message?.startsWith('AUTH_EXPIRED')) throw reconnErr;
        logger(label, `Reconnect attempt failed: ${reconnErr.message}`, 'warn');
      }
    } else if (hbResult?.success) {
      accState.balance = hbResult.newBalance;
      accState.totalEarned = (accState.totalEarned || 0) + (hbResult.tokensEarned || 0);
      logger(label, `First heartbeat sent — Earned: +${hbResult.tokensEarned} $DTH | New Balance: ${hbResult.newBalance} $DTH`, 'success');
    }
  } catch (e) {
    if (e.message?.startsWith('AUTH_EXPIRED')) throw e;
    logger(label, `First heartbeat failed: ${e.message} — Will retry in heartbeat loop`, 'warn');
  }

  // Save session data
  const accountId = account.cookie || account.identifier || `account_${index}`;
  saveTokenData(accountId, {
    username: user.username,
    balance: accState.balance,
    deviceId: accState.deviceId,
    lastMiningEpoch: miningData.epoch?.number,
  });

  accState.status = 'MINING';
  logger(label, `Setup complete — Balance: ${accState.balance} $DTH | Heartbeat active`, 'success');
  renderDashboard();

  return { user, miningData };
}

// ============================================================
// HEARTBEAT LOOP — CONTINUOUS 24/7 MINING (Like Real Browser)
// ============================================================
// From heartbeat.har analysis, the REAL browser does:
//   - POST /api/mining/heartbeat every ~30s  → EARNS TOKENS!
//   - GET  /api/mining/status    every ~15s  → read-only status
//   - GET  /api/launch/status    every ~30s  → keep-alive
//   - GET  /api/support/tickets  every ~60s  → keep-alive
//   - GET  /api/auth/me          every ~60s  → session refresh
//
// The heartbeat POST is the CRITICAL call — without it,
// no tokens are earned. It returns { tokensEarned, newBalance }.
// ============================================================

async function heartbeatLoop(client, fp, account, index, proxyManager = null) {
  const label = `Account ${index + 1}`;
  const accState = state.accounts[index];
  const accountId = account.cookie || account.identifier || `account_${index}`;

  let lastHeartbeat = 0;
  let lastStatusPoll = 0;
  let lastLaunchPoll = 0;
  let lastTicketsPoll = 0;
  let lastAuthRefresh = 0;
  let lastDeviceConnect = Date.now();

  // Tracking
  let prevEpoch = accState.epoch;
  let prevBalance = accState.balance;
  let currentEpochEnd = null;
  let heartbeatCount = 0;
  let sessionTotalEarned = accState.totalEarned || 0;

  logger(label, `Mining heartbeat started — POST every ${MINING_HEARTBEAT_MS / 1000}s | Status poll every ${STATUS_POLL_MS / 1000}s`, 'success');

  while (true) {
    const now = Date.now();

    // ── TIMED PROXY ROTATION (optional, every N minutes) ──────
    if (proxyManager && proxyManager.shouldTimeRotate()) {
      proxyManager.rotate('timed_rotation');
      accState.proxyLabel = proxyManager.currentLabel();
      // Throw to rebuild client in accountMiningLoop
      const rotateErr = new Error('PROXY_ROTATED');
      rotateErr.proxyRotated = true;
      throw rotateErr;
    }

    // ── MINING HEARTBEAT (every 30s — THIS EARNS TOKENS) ──────
    if (now - lastHeartbeat >= MINING_HEARTBEAT_MS) {
      try {
        const hb = await sendMiningHeartbeat(client, label);
        heartbeatCount++;

        // Handle disconnected: true — need to re-start mining session
        if (hb?.disconnected) {
          logger(label, 'Heartbeat returned disconnected — reconnecting mining session...', 'warn');
          try {
            await startMining(client, label);
            logger(label, 'Mining session reconnected after disconnect', 'success');
          } catch (reconnErr) {
            logger(label, `Mining reconnect failed: ${reconnErr.message}`, 'error');
          }
          lastHeartbeat = now;
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }

        if (hb?.success) {
          const earned = hb.tokensEarned || 0;
          sessionTotalEarned += earned;
          accState.balance = hb.newBalance;
          accState.totalEarned = parseFloat(sessionTotalEarned.toFixed(6));
          accState.epoch = hb.epochNumber;
          accState.lastRun = formatDateTime(new Date());
          accState.status = 'MINING';

          if (earned > 0) {
            logger(label, `💎 +${earned} $DTH | Balance: ${hb.newBalance} $DTH | Epoch #${hb.epochNumber} | HB #${heartbeatCount}`, 'success');
          } else {
            // Epoch just changed, no tokens this tick (normal)
            if (heartbeatCount % 5 === 0) {
              logger(label, `Heartbeat #${heartbeatCount} — Epoch #${hb.epochNumber} | ${hb.newBalance} $DTH | Session: +${sessionTotalEarned.toFixed(4)}`, 'info');
            }
          }

          // Track epoch changes — reconnect mining at epoch boundary
          if (hb.epochNumber !== prevEpoch && prevEpoch !== null) {
            logger(label, `New epoch #${hb.epochNumber} started — reconnecting mining session...`, 'data');
            try {
              await startMining(client, label);
              await sleep(1000);
              await sendMiningHeartbeat(client, label);
              logger(label, `Mining reconnected for epoch #${hb.epochNumber}`, 'success');
            } catch (epochErr) {
              logger(label, `Epoch reconnect failed: ${epochErr.message}`, 'warn');
            }
          }
          prevEpoch = hb.epochNumber;
          prevBalance = hb.newBalance;

          renderDashboard();
        }
      } catch (e) {
        if (e.message?.startsWith('AUTH_EXPIRED')) throw e;
        logger(label, `Heartbeat failed: ${e.message}`, 'warn');
      }
      lastHeartbeat = now;
    }

    // ── Mining Status Poll (every 15s — READ-ONLY) ────────────
    if (now - lastStatusPoll >= STATUS_POLL_MS) {
      try {
        const data = await smartRequest(client, 'get', API.MINING_STATUS, null, label, 2);
        if (data) {
          accState.speed = data.miningSpeed;
          accState.baseRate = data.baseRate;
          currentEpochEnd = data.epoch?.endTime ? new Date(data.epoch.endTime).getTime() : null;
          if (currentEpochEnd) {
            accState.nextRun = formatDateTime(new Date(currentEpochEnd));
          }
          // Update balance from status if heartbeat hasn't reported yet
          if (data.balance > accState.balance) {
            accState.balance = data.balance;
          }
          renderDashboard();
        }
      } catch (e) {
        if (e.message?.startsWith('AUTH_EXPIRED')) throw e;
        // Silent — status poll is secondary
      }
      lastStatusPoll = now;
    }

    // ── Launch Status Keep-Alive (every 30s — SILENT) ─────────
    if (now - lastLaunchPoll >= LAUNCH_POLL_MS) {
      try {
        await client.get(API.LAUNCH_STATUS);
      } catch (e) { /* silent */ }
      lastLaunchPoll = now;
    }

    // ── Support Tickets Keep-Alive (every 60s — SILENT) ──────
    if (now - lastTicketsPoll >= TICKETS_POLL_MS) {
      try {
        await client.get(API.SUPPORT_TICKETS);
      } catch (e) { /* silent */ }
      lastTicketsPoll = now;
    }

    // ── Auth Refresh (every 60s — keeps session alive) ────────
    if (now - lastAuthRefresh >= 60 * 1000) {
      try {
        await client.get(API.AUTH_ME);
      } catch (e) {
        if (e.response?.status === 401 || e.response?.status === 403) {
          throw new Error('AUTH_EXPIRED:' + e.response.status);
        }
      }
      lastAuthRefresh = now;
    }

    // ── Device Reconnect at Epoch Boundary ────────────────────
    // Use /api/mining/connect (NOT /api/devices/connect) — this is what the browser does
    if (currentEpochEnd && now >= currentEpochEnd - DEVICE_RECONNECT_BUFFER_MS && now - lastDeviceConnect > EPOCH_INTERVAL_MS / 2) {
      try {
        logger(label, 'Epoch ending — Reconnecting mining session...', 'info');
        await startMining(client, label);
        lastDeviceConnect = Date.now();
      } catch (e) {
        logger(label, `Epoch reconnect failed: ${e.message}`, 'warn');
      }
    }

    // ── Save session periodically (every 10 heartbeats = ~5 min) ──
    if (heartbeatCount > 0 && heartbeatCount % 10 === 0) {
      saveTokenData(accountId, {
        balance: accState.balance,
        deviceId: accState.deviceId,
        lastMiningEpoch: prevEpoch,
        totalEarned: sessionTotalEarned,
      });
    }

    // Short sleep between checks (5s internal tick)
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

// ============================================================
// 24/7 ACCOUNT MINING LOOP (No daily reset — runs forever)
// ============================================================

async function accountMiningLoop(account, index) {
  const label = `Account ${index + 1}`;
  const accState = state.accounts[index];
  const accountId = account.cookie || account.identifier || `account_${index}`;

  // Initialize ProxyManager for this account
  const pm = new ProxyManager(account.proxy, label);
  proxyManagers.set(label, pm);

  if (pm.hasMultiple()) {
    logger(label, `Multi-proxy loaded: ${pm.count()} proxies — Auto-rotation enabled (failover after ${PROXY_ROTATE_ON_FAILS} fails${PROXY_ROTATE_INTERVAL_MS > 0 ? `, timed every ${PROXY_ROTATE_INTERVAL_MS / 60000}min` : ''})`, 'success');
    pm.getStats().forEach(s => {
      logger(label, `  ${s.active ? '→' : ' '} Proxy ${s.index}: ${s.proxy}`, 'list');
    });
  }

  while (true) {
    try {
      // Create persistent fingerprint & HTTP client
      const fp = getOrCreateFingerprint(accountId);
      logger(label, `Fingerprint loaded — UA: ${fp.userAgent.slice(0, 55)}...`, 'info');

      const client = createAxiosClient(account, fp, pm);
      activeClients.set(label, client);

      // Show proxy info
      if (pm.current()) {
        logger(label, `${pm.currentLabel()}: ${pm.currentMasked()}`, 'info');
      } else {
        logger(label, 'Direct connection (no proxy)', 'info');
      }
      accState.proxyLabel = pm.currentLabel();

      // Phase 1: Initial setup (warmup → auth → device connect → mining connect → first heartbeat)
      await initialSetup(client, fp, account, index);

      // Phase 2: Enter 24/7 heartbeat loop (polls every 15s like real browser)
      await heartbeatLoop(client, fp, account, index, pm);

    } catch (err) {
      if (err.proxyRotated) {
        // Proxy was auto-rotated — rebuild client immediately
        logger(label, `Rebuilding client with new proxy: ${pm.currentMasked()}`, 'warn');
        accState.status = 'RECONNECTING';
        accState.proxyLabel = pm.currentLabel();
        renderDashboard();
        await sleep(3000 + Math.random() * 2000);
        continue; // Restart loop with new proxy
      } else if (err.message?.startsWith('AUTH_EXPIRED')) {
        accState.status = 'AUTH_EXPIRED';
        logger(label, 'Session expired — Update cookie in accounts.json', 'error');
        logger(label, 'Retrying in 5 minutes...', 'info');
        accState.nextRun = formatDateTime(new Date(Date.now() + 5 * 60 * 1000));
        renderDashboard();
        await sleep(5 * 60 * 1000);
      } else {
        accState.status = 'FAILED';
        logger(label, `Connection error: ${err.message} — Retrying in 60s`, 'error');
        accState.nextRun = formatDateTime(new Date(Date.now() + 60000));
        renderDashboard();

        // On generic failure with multi-proxy, try rotating
        if (pm.hasMultiple()) {
          pm.rotate('connection_error');
          accState.proxyLabel = pm.currentLabel();
        }

        await sleep(60000);
      }
    }
  }
}

// ============================================================
// MAIN ENTRY POINT (24/7 Continuous — No Daily Reset)
// ============================================================

async function main() {
  // Load accounts
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    console.log(chalk.red('ERROR: accounts.json not found!'));
    console.log(chalk.yellow('Copy accounts_tmp.json to accounts.json and fill in your data.'));
    process.exit(1);
  }

  const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  if (!Array.isArray(accounts) || accounts.length === 0) {
    console.log(chalk.red('ERROR: accounts.json must be a non-empty array!'));
    process.exit(1);
  }

  // Apply MAX_CONCURRENT_ACCOUNTS limit
  const activeAccounts = MAX_CONCURRENT_ACCOUNTS > 0
    ? accounts.slice(0, MAX_CONCURRENT_ACCOUNTS)
    : accounts;

  if (MAX_CONCURRENT_ACCOUNTS > 0 && accounts.length > MAX_CONCURRENT_ACCOUNTS) {
    console.log(chalk.yellow(`MAX_CONCURRENT_ACCOUNTS = ${MAX_CONCURRENT_ACCOUNTS} — Running ${activeAccounts.length} of ${accounts.length} accounts`));
  }

  // Initialize state for each account
  state.accounts = activeAccounts.map((acc, i) => ({
    label: `Account ${i + 1}`,
    status: 'WAITING',
    balance: null,
    speed: null,
    epoch: null,
    totalEarned: 0,
    deviceId: acc.deviceId || null,
    baseRate: null,
    proxyLabel: Array.isArray(acc.proxy) ? `0/${acc.proxy.length}` : (acc.proxy ? 'Proxy' : 'Direct'),
    lastRun: '-',
    nextRun: '-',
  }));

  renderDashboard();

  logger('System', `Loaded ${activeAccounts.length} account(s) — 24/7 continuous mode`, 'success');
  logger('System', 'Mining via POST /api/mining/heartbeat (30s interval)', 'info');
  logger('System', `Intervals: Heartbeat ${MINING_HEARTBEAT_MS / 1000}s | Status ${STATUS_POLL_MS / 1000}s | Epoch ${EPOCH_INTERVAL_MS / 1000 / 60}min`, 'info');

  // Log proxy configuration per account
  activeAccounts.forEach((acc, i) => {
    const proxyList = Array.isArray(acc.proxy) ? acc.proxy : (acc.proxy ? [acc.proxy] : []);
    const proxyCount = proxyList.filter(p => p).length;
    if (proxyCount > 1) {
      logger(`Account ${i + 1}`, `Multi-proxy: ${proxyCount} proxies configured (auto-rotation enabled)`, 'info');
    } else if (proxyCount === 1) {
      logger(`Account ${i + 1}`, `Single proxy configured`, 'info');
    } else {
      logger(`Account ${i + 1}`, `Direct connection (no proxy)`, 'info');
    }
  });

  // Launch independent mining loops (staggered start)
  const loops = activeAccounts.map((account, index) => {
    const stagger = index * (3000 + Math.random() * 5000);
    return new Promise(resolve => {
      setTimeout(() => {
        accountMiningLoop(account, index).catch(err => {
          logger(`Account ${index + 1}`, `Fatal loop error: ${err.message}`, 'error');
        });
        resolve();
      }, stagger);
    });
  });

  await Promise.all(loops);

  // Keep process alive (loops run forever in background)
  setInterval(() => {
    renderDashboard();
  }, 60000);
}

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

// Store active clients for graceful disconnect
const activeClients = new Map();

process.on('SIGINT', async () => {
  console.log(chalk.yellow('\n\nShutting down — disconnecting mining sessions...'));
  const disconnects = [];
  for (const [label, client] of activeClients) {
    disconnects.push(stopMining(client, label));
  }
  await Promise.allSettled(disconnects);
  console.log(chalk.yellow('All sessions disconnected. Goodbye.'));
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  logger('System', `Uncaught exception: ${err.message}`, 'error');
});

process.on('unhandledRejection', (reason) => {
  logger('System', `Unhandled rejection: ${reason}`, 'error');
});

// ============================================================
// START
// ============================================================
main().catch(err => {
  console.error(chalk.red(`Fatal error: ${err.message}`));
  process.exit(1);
});
