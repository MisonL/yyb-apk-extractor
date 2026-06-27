#!/usr/bin/env node

/**
 * 应用宝 APK 下载链接提取器（纯命令行版）
 *
 * 不依赖浏览器，通过应用宝移动端页面接口获取 APK 直链。
 * 使用代理时需要系统已安装 curl。
 *
 * 使用方法:
 *   node index.js <包名或应用宝详情页URL> [选项]
 *
 *   包名或URL          安卓包名(如 com.example.app) 或应用宝详情页 URL
 *   --proxy=地址        设置代理, 支持 http/https/socks5/socks5h,
 *                       建议 Clash/V2Ray 混合端口用 http:// 或 socks5h://（远程 DNS）
 *   --no-proxy          忽略环境变量代理
 *   --download-dir=目录 提取链接后自动下载 APK 到指定目录
 *   --timeout=毫秒      网络超时时间(默认 30000)。fetch 阶段为请求总时长；
 *                       下载阶段为连接/断流检测时长，不限制大文件总下载时间
 *   --verbose, -v       显示详细调试日志
 *   --version, -V       显示版本号
 *   --no-color          强制禁用 ANSI 颜色输出
 *
 * 示例:
 *   node index.js com.example.app
 *   node index.js https://sj.qq.com/appdetail/com.example.app
 *   node index.js com.example.app --proxy=http://127.0.0.1:7890
 *   node index.js com.example.app --proxy=socks5h://127.0.0.1:7890
 *   node index.js com.example.app --download-dir=./downloads
 *
 * 代理说明:
 *   - http://  最稳，适合 Clash/V2Ray 混合代理端口
 *   - socks5h://  SOCKS5 并让代理服务器解析 DNS，避免本地 DNS 失败
 *   - 避免使用 socks5://（本地解析 DNS，易在受限网络中失败）
 *
 * 环境变量:
 *   HTTPS_PROXY / https_proxy / HTTP_PROXY / http_proxy / ALL_PROXY / all_proxy : 默认代理（按优先级排序）
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

// 版本号从 package.json 读取，保持单一来源
let VERSION = '1.0.0';
try {
  VERSION = require('./package.json').version;
} catch {
  // ignore
}

// 命令查找缓存，避免同一进程内重复 fork which/where
const commandCache = new Map();

const MOBILE_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 10; SM-G960U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const PROXY_ENV_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'];

// 应用宝搜索相关常量
const SEARCH_URL_TEMPLATE = 'https://sj.qq.com/search?q=';
const INTERACTIVE_INPUT_MAX_LEN = 100;
const MAX_KEYWORD_LEN = INTERACTIVE_INPUT_MAX_LEN;
const SEARCH_RESULT_LIMIT = 20;
const ALLOWED_SEARCH_HOSTNAMES = ['sj.qq.com'];

// 终端颜色支持：非 TTY 或设置 NO_COLOR/--no-color 时禁用，保证管道输出干净
const noColorFlag = process.argv.includes('--no-color');
const useColor = process.stderr.isTTY && !process.env.NO_COLOR && !noColorFlag;
const c = useColor
  ? {
      reset: '\x1b[0m',
      bold: '\x1b[1m',
      dim: '\x1b[2m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      cyan: '\x1b[36m',
    }
  : Object.fromEntries(['reset', 'bold', 'dim', 'red', 'green', 'yellow', 'blue', 'cyan'].map((k) => [k, '']));

function padEnd(str, len) {
  const visualLen = str.replace(/\x1b\[\d+m/g, '').length;
  return str + ' '.repeat(Math.max(0, len - visualLen));
}

function opt(name, desc, extra = '') {
  const line = `  ${c.yellow}${padEnd(name, 22)}${c.reset} ${desc}`;
  return extra ? [line, `  ${padEnd('', 22)} ${extra}`] : [line];
}

function showVersion() {
  console.log(VERSION);
  process.exit(0);
}

function showHelp() {
  const title = `${c.bold}${c.cyan}应用宝 APK 下载链接提取器${c.reset} ${c.dim}v${VERSION}${c.reset}`;
  const lines = [
    '',
    title,
    '',
    `${c.bold}用法:${c.reset}`,
    `  ${c.yellow}node index.js${c.reset} ${c.green}<包名或应用宝详情页URL>${c.reset} [选项]`,
    `  ${c.yellow}node index.js search${c.reset} ${c.green}<关键词>${c.reset} [选项]`,
    `  ${c.yellow}node index.js --interactive${c.reset}`,
    '',
    `${c.bold}选项:${c.reset}`,
    ...opt('--proxy=地址', '设置代理, 支持 http/https/socks5/socks5h', `${c.dim}建议 Clash/V2Ray 混合端口用 http:// 或 socks5h://${c.reset}`),
    ...opt('--no-proxy', '忽略环境变量代理'),
    ...opt('--download-dir=目录', '提取链接后自动下载 APK 到指定目录'),
    ...opt('--timeout=毫秒', '网络超时时间 (默认 30000)', `${c.dim}fetch 阶段为请求总时长; 下载阶段为连接/断流检测时长${c.reset}`),
    ...opt('--insecure', '下载时跳过 HTTPS 证书校验（仅限测试环境）'),
    ...opt('--verbose, -v', '显示详细调试日志'),
    ...opt('--interactive, -i', '进入交互式向导'),
    ...opt('--version, -V', '显示版本号'),
    ...opt('--no-color', '强制禁用 ANSI 颜色输出'),
    ...opt('--help, -h', '显示本帮助信息'),
    '',
    `${c.bold}示例:${c.reset}`,
    `  ${c.dim}# 直接输入包名${c.reset}`,
    `  ${c.yellow}node index.js${c.reset} ${c.green}com.example.app${c.reset}`,
    '',
    `  ${c.dim}# 输入应用宝详情页 URL${c.reset}`,
    `  ${c.yellow}node index.js${c.reset} ${c.green}https://sj.qq.com/appdetail/com.example.app${c.reset}`,
    '',
    `  ${c.dim}# 搜索应用${c.reset}`,
    `  ${c.yellow}node index.js search${c.reset} ${c.green}微信${c.reset}`,
    '',
    `  ${c.dim}# 进入交互模式${c.reset}`,
    `  ${c.yellow}node index.js --interactive${c.reset}`,
    '',
    `  ${c.dim}# 使用 HTTP 代理 (推荐)${c.reset}`,
    `  ${c.yellow}node index.js${c.reset} ${c.green}com.example.app${c.reset} --proxy=${c.cyan}http://127.0.0.1:7890${c.reset}`,
    '',
    `  ${c.dim}# 使用 SOCKS5h 代理 (远程 DNS)${c.reset}`,
    `  ${c.yellow}node index.js${c.reset} ${c.green}com.example.app${c.reset} --proxy=${c.cyan}socks5h://127.0.0.1:7890${c.reset}`,
    '',
    `  ${c.dim}# 自动下载到指定目录${c.reset}`,
    `  ${c.yellow}node index.js${c.reset} ${c.green}com.example.app${c.reset} --download-dir=${c.cyan}./downloads${c.reset}`,
    '',
    `${c.bold}环境变量:${c.reset}`,
    `  ${c.cyan}HTTPS_PROXY${c.reset} / ${c.cyan}https_proxy${c.reset} / ${c.cyan}HTTP_PROXY${c.reset} / ${c.cyan}http_proxy${c.reset}`,
    `  ${c.dim}按上述优先级自动读取默认代理${c.reset}`,
    '',
  ];
  console.log(lines.join('\n'));
  process.exit(0);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let mode = 'direct';
  let pkgNameOrUrl = '';
  let keyword = '';
  let interactiveFlag = false;
  const proxyFromEnv =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy ||
    '';
  const options = {
    proxy: '',
    ignoreProxyEnv: false,
    timeout: 30000,
    verbose: false,
    downloadDir: '',
    insecure: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp();
    } else if (arg === '--version' || arg === '-V') {
      showVersion();
    } else if (arg === '--no-color') {
      // 已在顶部处理，解析阶段直接跳过
    } else if (arg === '--no-proxy') {
      options.proxy = '';
      options.ignoreProxyEnv = true;
    } else if (arg.startsWith('--proxy=')) {
      options.proxy = validateProxy(arg.slice('--proxy='.length));
      options.ignoreProxyEnv = false;
    } else if (arg.startsWith('--timeout=')) {
      const raw = arg.slice('--timeout='.length);
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== raw) {
        throw new Error('--timeout 必须是正整数毫秒');
      }
      options.timeout = parsed;
    } else if (arg.startsWith('--download-dir=')) {
      options.downloadDir = arg.slice('--download-dir='.length);
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--insecure') {
      options.insecure = true;
    } else if (arg === '--interactive' || arg === '-i') {
      interactiveFlag = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`未知选项: ${arg}`);
    } else {
      // 位置参数：第一个非选项参数决定模式
      if (!pkgNameOrUrl) {
        pkgNameOrUrl = arg;
      } else if (pkgNameOrUrl === 'search' && !keyword) {
        keyword = arg;
      } else {
        throw new Error(`多余参数: ${arg}`);
      }
    }
  }

  // 解析位置参数模式
  if (pkgNameOrUrl === 'search') {
    mode = 'search';
    pkgNameOrUrl = '';
    if (!keyword) {
      throw new Error('search 命令需要提供一个关键词');
    }
  }

  if (interactiveFlag) {
    if (pkgNameOrUrl || keyword) {
      throw new Error('--interactive 模式不支持位置参数');
    }
    mode = 'interactive';
  }

  // 交互模式不需要包名；搜索模式需要关键词；直接模式需要包名/URL
  if (mode === 'direct' && !pkgNameOrUrl) {
    throw new Error('请提供包名或应用宝详情页 URL，或使用 --interactive 进入交互模式');
  }

  const MAX_INPUT_LEN = 2048;
  if (pkgNameOrUrl && pkgNameOrUrl.length > MAX_INPUT_LEN) {
    throw new Error(`输入过长 (>${MAX_INPUT_LEN} 字符)`);
  }
  // 关键词长度在 trim 后校验，与 validateSearchKeyword 保持一致
  if (keyword && keyword.trim().length > MAX_KEYWORD_LEN) {
    throw new Error(`关键词过长 (>${MAX_KEYWORD_LEN} 字符)`);
  }

  // 若显式传入空值 --download-dir=，语义不明确，要求用 . 表示当前目录
  if (args.some((a) => a === '--download-dir=')) {
    throw new Error('--download-dir= 值不能为空，如需当前目录请使用 --download-dir=.');
  }

  validateDownloadDir(options.downloadDir, '--download-dir');

  if (!options.proxy && !options.ignoreProxyEnv && proxyFromEnv) {
    options.proxy = validateProxy(proxyFromEnv);
  }

  return { mode, pkgNameOrUrl, keyword, options };
}

function validateDownloadDir(dir, label = '下载目录') {
  if (dir === '') return;
  if (!dir.trim()) {
    throw new Error(`${label} 不能为空`);
  }
  const segments = dir.split(/[\\/]+/).filter(Boolean);
  if (segments.includes('..')) {
    throw new Error(`${label} 不能包含路径遍历 ..`);
  }
  const resolved = path.resolve(dir);
  if (resolved === path.parse(resolved).root) {
    throw new Error(`${label} 不能为根目录`);
  }
}

function normalizeUrl(input) {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    // 规范化协议大小写，避免 detailUrl 输出 HTTP:// 等异常格式
    const protocolEnd = trimmed.indexOf('://');
    return trimmed.slice(0, protocolEnd).toLowerCase() + trimmed.slice(protocolEnd);
  }
  const pkgName = trimmed.replace(/^\/+|\/+$/g, '');
  return `https://sj.qq.com/appdetail/${pkgName}`;
}

function isValidPkgName(name) {
  // Android 包名基本规则：以字母开头，段内可含字母/数字/下划线，至少两段
  return /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(name);
}

function getPkgName(url) {
  try {
    const u = new URL(url);
    // 拒绝路径中包含 .. 的 URL，防止路径遍历
    if (u.pathname.includes('..')) return '';

    // 如果是 simple.jsp URL，从 query 参数提取 pkgname
    if (u.pathname.toLowerCase().endsWith('simple.jsp')) {
      const pkg = u.searchParams.get('pkgname');
      if (pkg && isValidPkgName(pkg)) return pkg;
      return '';
    }
    const parts = u.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || '';
    return isValidPkgName(last) ? last : '';
  } catch {
    return '';
  }
}

function isAria2cProxySupported(proxy) {
  // aria2c --all-proxy 支持 http:// 与 https:// 代理；socks5/socks5h 等会报 unrecognized proxy format
  if (!proxy) return true;
  return /^https?:\/\//i.test(proxy);
}

function validateProxy(proxy) {
  if (!proxy) return '';
  let parsed;
  try {
    parsed = new URL(proxy);
  } catch {
    throw new Error(`--proxy 不是有效 URL: ${maskUrl(proxy)}`);
  }
  if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(parsed.protocol)) {
    throw new Error(`--proxy 仅支持 http/https/socks5/socks5h 协议: ${maskUrl(proxy)}`);
  }
  if (!parsed.hostname || !parsed.port) {
    throw new Error(`--proxy 必须包含主机和端口: ${maskUrl(proxy)}`);
  }
  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    throw new Error(`--proxy 不能包含路径、查询串或片段: ${maskUrl(proxy)}`);
  }
  return parsed.toString();
}

// 将代理 URL 拆分为“无凭据 URL”和“凭据”，避免在子进程参数/环境中暴露密码
function splitProxyAuth(proxyUrl) {
  if (!proxyUrl) return { url: '', username: '', password: '' };
  try {
    const u = new URL(proxyUrl);
    const username = u.username;
    const password = u.password;
    u.username = '';
    u.password = '';
    return { url: u.toString(), username, password };
  } catch {
    return { url: proxyUrl, username: '', password: '' };
  }
}

function hasProxyCredentials(proxyUrl) {
  const { username, password } = splitProxyAuth(proxyUrl);
  return Boolean(username || password);
}

function buildCurlProxyConfigInput(proxyUrl) {
  if (!proxyUrl) return '';
  return `proxy = ${JSON.stringify(proxyUrl)}\n`;
}

function buildAria2cProxyConfigText(proxyUrl) {
  if (!proxyUrl) return '';
  return `all-proxy=${proxyUrl}\n`;
}

function writeTempConfigFile(prefix, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.chmodSync(dir, 0o700);
  const filePath = path.join(dir, 'config');
  fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
  return {
    filePath,
    cleanup() {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}

function createChildEnv(options) {
  if (!options.ignoreProxyEnv && !options.proxy) {
    return process.env;
  }

  const env = { ...process.env };
  for (const key of PROXY_ENV_KEYS) {
    delete env[key];
  }

  if (options.proxy) {
    // 环境变量中不暴露代理凭据
    const { url: proxyWithoutAuth } = splitProxyAuth(options.proxy);
    for (const key of PROXY_ENV_KEYS) {
      env[key] = proxyWithoutAuth;
    }
  }

  return env;
}

function assertAllowedHttpUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} 不是有效 URL: ${value}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} 仅支持 http/https 协议: ${value}`);
  }
  assertAllowedHostname(parsed.hostname, label);
  return parsed;
}

function maskUrl(value) {
  try {
    const u = new URL(value);
    if (u.username) u.username = '***';
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return value;
  }
}

// 终端输出安全净化：过滤来自网络的字符串中的 ANSI 转义序列、C1 控制字符与换行/回车
function sanitizeTerminalOutput(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
    .replace(/[\x00-\x1f\x7f\u0080-\u009f]/g, '');
}

// 安全 URL 校验：仅接受 http/https，且目标域名在腾讯/应用宝可控范围内
function safeTencentUrl(value, allowedHosts = []) {
  if (typeof value !== 'string' || !value.trim()) return '';
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
  const host = parsed.hostname.toLowerCase();
  const safePatterns = [
    /^[a-z0-9-]+(\.[a-z0-9-]+)*\.qq\.com$/,
    /^[a-z0-9-]+(\.[a-z0-9-]+)*\.myapp\.com$/,
    /^[a-z0-9-]+(\.[a-z0-9-]+)*\.qpic\.cn$/,
    /^[a-z0-9-]+(\.[a-z0-9-]+)*\.qlogo\.cn$/,
    ...allowedHosts.map((h) => new RegExp(`^${h.replace(/\./g, '\\.').replace(/\*/g, '[a-z0-9-]+')}$`, 'i')),
  ];
  if (!safePatterns.some((re) => re.test(host))) return '';
  return parsed.toString();
}

function log(options, ...args) {
  if (options.verbose) {
    console.error(`${c.dim}[debug]${c.reset}`, ...args);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retrySync(fn, retries = 3) {
  // 同步重试：不引入 sleep，立即重试以简化实现；网络操作本身耗时已足够间隔
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return fn();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

async function retryAsync(fn, retries = 3, delayMs = 1000) {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (i < retries - 1) {
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '未知大小';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const k = 1024;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
}

function findCommand(names) {
  const key = names.join('|');
  if (commandCache.has(key)) return commandCache.get(key);

  for (const name of names) {
    try {
      // 直接在 PATH 中执行 --version，成功退出视为可用
      const res = spawnSync(name, ['--version'], { stdio: 'ignore' });
      if (res.status === 0) {
        commandCache.set(key, name);
        return name;
      }
    } catch {
      // ignore
    }
  }
  commandCache.set(key, null);
  return null;
}

function assertAllowedHostname(hostname, context) {
  const h = hostname.toLowerCase();
  if (!h.endsWith('.qq.com') && h !== 'qq.com') {
    throw new Error(`${context} 非腾讯域名 (${hostname})，已拒绝`);
  }
}

function fetchHtmlWithNode(url, options, redirectCount = 0) {
  if (redirectCount > 5) {
    return Promise.reject(new Error('重定向次数过多（>5），疑似配置错误'));
  }
  return new Promise((resolve, reject) => {
    try {
      assertAllowedHttpUrl(url, '请求');
    } catch (e) {
      return reject(e.message ? new Error(e.message) : new Error(`无效的 URL: ${url}`));
    }

    const client = url.toLowerCase().startsWith('https:') ? https : http;
    const maxHtmlBytes = 10 * 1024 * 1024;
    let receivedBytes = 0;
    const req = client.get(
      url,
      {
        headers: {
          'User-Agent': MOBILE_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
        timeout: options.timeout,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.on('error', (e) => {
            // 重定向响应流错误不影响主流程，verbose 模式下保留可见性
            if (options.verbose) {
              log(options, `重定向响应流错误（已忽略）: ${e.message}`);
            }
          });
          res.resume(); // 消费原响应体，避免缓冲区满阻塞
          let nextUrl;
          try {
            nextUrl = new URL(res.headers.location, url).toString();
            assertAllowedHttpUrl(nextUrl, '重定向');
          } catch (e) {
            return reject(e.message ? new Error(e.message) : new Error(`无效的重定向 URL: ${res.headers.location}`));
          }
          return fetchHtmlWithNode(nextUrl, options, redirectCount + 1).then(resolve, reject);
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume(); // 消费错误响应体，避免缓冲区满阻塞
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.on('error', reject); // 2xx 响应流错误：协议错误、socket 中断等
        let data = '';
        res.setEncoding('utf-8');
        res.on('data', (chunk) => {
          receivedBytes += Buffer.byteLength(chunk, 'utf8');
          if (receivedBytes > maxHtmlBytes) {
            req.destroy();
            return reject(new Error(`响应体超过 ${formatBytes(maxHtmlBytes)} 上限`));
          }
          data += chunk;
        });
        res.on('end', () => resolve(data));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
  });
}

function parseCurlHeaders(stdout) {
  // curl -D - 在代理 CONNECT、100 Continue 等场景可能输出多段响应头，取最后一段真实响应头。
  let offset = 0;
  let headers = '';

  while (stdout.slice(offset).startsWith('HTTP/')) {
    const crlf = stdout.indexOf('\r\n\r\n', offset);
    const lf = stdout.indexOf('\n\n', offset);
    let sep = -1;
    if (crlf !== -1 && lf !== -1) sep = Math.min(crlf, lf);
    else sep = crlf !== -1 ? crlf : lf;
    if (sep === -1) return { headers: stdout.slice(offset), body: '' };

    const sepLen = stdout.charAt(sep) === '\r' ? 4 : 2;
    headers = stdout.slice(offset, sep);
    offset = sep + sepLen;

    if (!stdout.slice(offset).startsWith('HTTP/')) {
      return { headers, body: stdout.slice(offset) };
    }
  }

  return { headers, body: stdout };
}

function fetchHtmlWithCurl(url, options, redirectCount = 0) {
  if (redirectCount > 5) {
    throw new Error('重定向次数过多（>5），疑似配置错误');
  }

  const curl = findCommand(['curl']);
  if (!curl) return null;
  assertAllowedHttpUrl(url, '请求');

  const timeoutSec = String(Math.max(1, Math.round((options.timeout || 30000) / 1000)));
  const args = [
    '-s', // 静默
    '-D', '-', // 将响应头输出到 stdout，便于手动处理重定向
    '--connect-timeout', timeoutSec,
    '--max-time', timeoutSec,
    '-A', MOBILE_USER_AGENT,
    '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    '-H', 'Accept-Language: zh-CN,zh;q=0.9',
  ];

  if (options.proxy) {
    const { url: proxyUrl } = splitProxyAuth(options.proxy);
    if (hasProxyCredentials(options.proxy)) {
      args.push('-K', '-');
    } else {
      args.push('-x', proxyUrl);
    }
  }

  args.push(url);

  log(options, `执行 curl 获取页面: ${url}`);
  const result = spawnSync(curl, args, {
    encoding: 'utf-8',
    stdio: 'pipe',
    maxBuffer: 10 * 1024 * 1024,
    input: options.proxy && hasProxyCredentials(options.proxy) ? buildCurlProxyConfigInput(options.proxy) : undefined,
    env: createChildEnv(options),
  });

  if (result.error) {
    throw new Error(`curl 执行失败: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    throw new Error(`curl 请求失败 (exit ${result.status})${stderr ? ': ' + stderr : ''}`);
  }

  const { headers, body } = parseCurlHeaders(result.stdout);
  const statusLine = headers.split(/\r?\n/)[0] || '';
  const statusMatch = statusLine.match(/HTTP\/\d(?:\.\d)?\s+(\d{3})/);
  const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;

  if (statusCode >= 300 && statusCode < 400) {
    const locationMatch = headers.match(/^\s*[Ll]ocation:\s*(.+)$/m);
    if (locationMatch) {
      const location = locationMatch[1].trim();
      let nextUrl;
      try {
        nextUrl = new URL(location, url).toString();
        assertAllowedHttpUrl(nextUrl, 'curl 重定向');
      } catch (e) {
        throw new Error(e.message || `无效的重定向 URL: ${location}`);
      }
      return fetchHtmlWithCurl(nextUrl, options, redirectCount + 1);
    }
  }

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`HTTP ${statusCode}`);
  }

  return body;
}

function parseApkUrlFromHtml(html) {
  if (!html) return { apkUrl: null, allUrls: [] };
  // 优先匹配 imtt 官方 CDN 的 .apk 链接
  const matches = html.match(/https?:\/\/[^"'<>\s]+\.apk[^"'<>\s]*/gi) || [];
  const allUrls = [...new Set(matches)].filter((u) => {
    try {
      assertAllowedHttpUrl(u, 'APK 下载地址');
      return true;
    } catch {
      return false;
    }
  });
  const official = allUrls.find((u) => u.includes('imtt'));
  return {
    apkUrl: official || allUrls[0] || null,
    allUrls,
  };
}

function validateSearchKeyword(keyword) {
  if (typeof keyword !== 'string') throw new Error('搜索关键词必须是字符串');
  const trimmed = keyword.trim();
  if (!trimmed) throw new Error('搜索关键词不能为空');
  if (trimmed.length > MAX_KEYWORD_LEN) throw new Error(`搜索关键词过长（>${MAX_KEYWORD_LEN} 字符）`);
  // 允许中文（CJK 常用汉字区）、英文、数字、空格及中英安全标点
  if (!/^[\u4e00-\u9fa5\u3400-\u4DBF\u3001-\u3003\u3008-\u3011\u2014\u2018\u2019\u201C\u201D\u2026\uFF08\uFF09\uFF0C\uFF0E\uFF01\uFF1F\uFF1A\uFF1B\uFF5Ea-zA-Z0-9\s\-_.+&"'()]+$/.test(trimmed)) {
    throw new Error('搜索关键词包含非法字符，仅支持中英文、数字及常用标点');
  }
  return trimmed;
}

function parseSearchResultsFromHtml(html) {
  if (!html) return [];
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('未能从搜索页解析 __NEXT_DATA__');

  let data;
  try {
    data = JSON.parse(m[1]);
  } catch (e) {
    throw new Error('搜索页 __NEXT_DATA__ JSON 解析失败');
  }

  const dcr = data?.props?.pageProps?.dynamicCardResponse;
  if (!dcr || dcr.ret !== 0) {
    throw new Error(`搜索接口返回异常: ${dcr?.msg || '未知错误'}`);
  }

  const results = [];
  for (const comp of dcr.data?.components || []) {
    for (const item of comp.data?.itemData || []) {
      if (!item.pkg_name || !isValidPkgName(item.pkg_name)) continue;
      results.push({
        pkgName: item.pkg_name,
        appId: item.app_id,
        name: sanitizeTerminalOutput(item.name),
        developer: sanitizeTerminalOutput(item.developer),
        version: sanitizeTerminalOutput(item.version_name),
        icon: safeTencentUrl(item.icon),
        apkSize: Number(item.apk_size) || 0,
        rating: item.average_rating,
        intro: sanitizeTerminalOutput(item.editor_intro),
        detailUrl: `https://sj.qq.com/appdetail/${item.pkg_name}`,
        rawDownloadUrl: safeTencentUrl(item.download_url),
      });
    }
  }
  return results.slice(0, SEARCH_RESULT_LIMIT);
}

function resolveDownloadRedirects(url, options, redirectCount = 0) {
  if (redirectCount > 5) {
    throw new Error('APK 下载重定向次数过多（>5），疑似配置错误');
  }

  const safeUrl = assertAllowedHttpUrl(url, 'APK 下载地址').toString();
  const curl = findCommand(['curl']);
  if (!curl) return safeUrl;

  const timeoutSec = String(Math.max(1, Math.round((options.timeout || 30000) / 1000)));
  const args = [
    '-s',
    '-D', '-',
    '-o', os.devNull,
    '--connect-timeout', timeoutSec,
    '--max-time', timeoutSec,
    '-A', MOBILE_USER_AGENT,
    '-H', 'Referer: https://a.app.qq.com/',
  ];
  if (options.proxy) {
    const { url: proxyUrl } = splitProxyAuth(options.proxy);
    if (hasProxyCredentials(options.proxy)) {
      args.push('-K', '-');
    } else {
      args.push('-x', proxyUrl);
    }
  }
  args.push(safeUrl);

  const result = spawnSync(curl, args, {
    encoding: 'utf-8',
    stdio: 'pipe',
    maxBuffer: 1024 * 1024,
    input: options.proxy && hasProxyCredentials(options.proxy) ? buildCurlProxyConfigInput(options.proxy) : undefined,
    env: createChildEnv(options),
  });

  if (result.error) {
    throw new Error(`curl 解析下载重定向失败: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    throw new Error(`curl 解析下载重定向失败 (exit ${result.status})${stderr ? ': ' + stderr : ''}`);
  }

  const { headers } = parseCurlHeaders(result.stdout);
  const statusLine = headers.split(/\r?\n/)[0] || '';
  const statusMatch = statusLine.match(/HTTP\/\d(?:\.\d)?\s+(\d{3})/);
  const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;

  if (statusCode >= 300 && statusCode < 400) {
    const locationMatch = headers.match(/^\s*[Ll]ocation:\s*(.+)$/m);
    if (!locationMatch) {
      throw new Error(`APK 下载地址返回 HTTP ${statusCode} 但缺少 Location`);
    }
    const nextUrl = new URL(locationMatch[1].trim(), safeUrl).toString();
    assertAllowedHttpUrl(nextUrl, 'APK 下载重定向');
    return resolveDownloadRedirects(nextUrl, options, redirectCount + 1);
  }

  if (statusCode === 405 || statusCode === 501) {
    log(options, `服务器不支持 HEAD 预检，使用原始下载地址: ${safeUrl}`);
    return safeUrl;
  }

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`APK 下载地址预检失败: HTTP ${statusCode || '未知'}`);
  }

  return safeUrl;
}

async function extractApkDownloadUrl(input, options) {
  const trimmed = input.trim();
  const isUrl = /^https?:\/\//i.test(trimmed);
  // 非 URL 输入必须是合法包名，防止路径遍历或特殊字符被当成包名
  if (!isUrl && !isValidPkgName(trimmed)) {
    throw new Error(`非法包名: ${input}（应为类似 com.example.app 的 Android 包名）`);
  }

  const url = normalizeUrl(input);
  const pkgName = getPkgName(url);

  if (!pkgName) {
    throw new Error(`无法从输入中解析包名: ${input}`);
  }

  // a.app.qq.com 的移动端页面会返回带 APK 直链的 HTML
  const simpleUrl = `https://a.app.qq.com/o/simple.jsp?pkgname=${encodeURIComponent(pkgName)}`;
  log(options, `目标包名: ${pkgName}`);
  log(options, `请求应用宝移动页面: ${simpleUrl}`);

  let html = null;

  // 优先使用 curl（天然支持各类代理），失败时自动重试
  try {
    html = retrySync(() => fetchHtmlWithCurl(simpleUrl, options), 3);
  } catch (e) {
    // curl 存在但执行失败：有代理时直接报错，无代理时回退到 Node.js
    if (options.proxy) throw e;
    log(options, `curl 执行失败，回退到 Node.js 内置模块: ${e.message}`);
  }

  // 兜底：使用 Node.js 内置 https（不支持代理，除非系统已透明转发）
  if (html === null) {
    if (options.proxy) {
      throw new Error(
        '未检测到 curl，无法通过代理访问。请安装 curl，或移除 --proxy 在无代理网络中使用。'
      );
    }
    html = await retryAsync(() => fetchHtmlWithNode(simpleUrl, options), 3);
  }

  if (!html) {
    throw new Error('未能获取应用宝页面内容');
  }

  const { apkUrl, allUrls } = parseApkUrlFromHtml(html);
  if (!apkUrl) {
    throw new Error('未能从页面中解析出 APK 下载链接，可能应用宝页面结构已变更');
  }

  return {
    pkgName,
    detailUrl: url,
    apkUrl,
    allUrls,
  };
}

async function searchApps(keyword, options) {
  const q = validateSearchKeyword(keyword);
  const searchUrl = `${SEARCH_URL_TEMPLATE}${encodeURIComponent(q)}`;
  const parsed = assertAllowedHttpUrl(searchUrl, '搜索请求');
  if (!ALLOWED_SEARCH_HOSTNAMES.includes(parsed.hostname.toLowerCase())) {
    throw new Error(`搜索请求目标域名 ${parsed.hostname} 不在白名单中`);
  }

  log(options, `搜索关键词: ${q}`);
  log(options, `请求应用宝搜索页: ${searchUrl}`);

  let html = null;
  try {
    html = retrySync(() => fetchHtmlWithCurl(searchUrl, options), 3);
  } catch (e) {
    if (options.proxy) throw e;
    log(options, `curl 搜索失败，回退到 Node.js 内置模块: ${e.message}`);
  }

  if (html === null) {
    if (options.proxy) {
      throw new Error('未检测到 curl，无法通过代理搜索。请安装 curl，或移除 --proxy。');
    }
    html = await retryAsync(() => fetchHtmlWithNode(searchUrl, options), 3);
  }

  const results = parseSearchResultsFromHtml(html);
  return { query: q, count: results.length, results };
}

async function downloadApk(apkUrl, pkgName, downloadDir, options) {
  const safeApkUrl = resolveDownloadRedirects(apkUrl, options);

  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  // 从 URL 的 fsname 参数提取文件名，否则使用包名
  let fileName = `${pkgName}.apk`;
  try {
    const u = new URL(apkUrl);
    const fsName = u.searchParams.get('fsname');
    if (fsName) fileName = fsName;
  } catch {
    // ignore
  }

  // 安全：仅保留文件名部分，防止路径遍历（如 fsname=../evil.apk 或 a/b\\c.apk）
  // 统一使用 POSIX 路径语义处理，再移除控制字符与路径分隔符残留
  fileName = path.posix.basename(fileName.replace(/\\/g, '/'));
  fileName = fileName.replace(/[\x00-\x1f]/g, '');
  if (!fileName || fileName === '.' || fileName === '/') {
    fileName = `${pkgName}.apk`;
  }

  const filePath = path.resolve(downloadDir, fileName);
  log(options, `开始下载 APK 到: ${filePath}`);
  if (!options.verbose) {
    console.error(`${c.blue}[download]${c.reset} ${c.bold}${fileName}${c.reset}`);
  }

  const ua = MOBILE_USER_AGENT;
  const referer = 'https://a.app.qq.com/';

  const proxyEnv = options.proxy
    ? createChildEnv(options)
    : options.ignoreProxyEnv
      ? createChildEnv(options)
      : process.env;
  const stdio = options.verbose ? 'inherit' : 'pipe';
  const timeoutSec = String(Math.max(1, Math.round((options.timeout || 30000) / 1000)));

  function runTool(exe, args) {
    return runToolWithInput(exe, args, '');
  }

  function runToolWithInput(exe, args, input) {
    // 日志中脱敏代理 URL 及代理凭据参数（支持 --flag value 与 --flag=value 两种形式）
    const proxyAuthFlags = ['--proxy-user', '--proxy-password', '--all-proxy-user', '--all-proxy-passwd'];
    const logArgs = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === options.proxy) {
        logArgs.push(maskUrl(a));
      } else if (proxyAuthFlags.some((f) => a === f) && i + 1 < args.length) {
        logArgs.push(a, '***');
        i++;
      } else if (proxyAuthFlags.some((f) => a.startsWith(`${f}=`))) {
        const flag = a.slice(0, a.indexOf('='));
        logArgs.push(`${flag}=***`);
      } else {
        logArgs.push(a);
      }
    }
    log(options, `执行下载命令: ${exe} ${logArgs.join(' ')}`);
    const spawnOptions = {
      env: proxyEnv,
      stdio: input ? 'pipe' : stdio,
      maxBuffer: 100 * 1024 * 1024,
    };
    if (input) {
      spawnOptions.input = input;
    }
    const result = spawnSync(exe, args, spawnOptions);
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const stderr = (result.stderr || '').trim();
      throw new Error(`下载工具 ${exe} 退出码 ${result.status}${stderr ? ': ' + stderr : ''}`);
    }
  }

  // 下载阶段优先使用 curl，避免外部工具自动跟随未校验的跨域重定向。
  const curl = findCommand(['curl']);
  if (curl) {
    const curlArgs = [
      '--fail',
      '--connect-timeout', timeoutSec, // 连接建立超时
      '--speed-time', timeoutSec,       // 若平均速度低于 speed-limit 持续该时长则中断
      '--speed-limit', '1024',          // 1KB/s，检测是否基本断流
      '-C', '-',                        // 断点续传
      '-o', filePath,
      '-H', `User-Agent: ${ua}`,
      '-H', `Referer: ${referer}`,
    ];
    let curlInput = '';
    if (options.proxy) {
      const { url: proxyUrl } = splitProxyAuth(options.proxy);
      if (hasProxyCredentials(options.proxy)) {
        curlArgs.push('-K', '-');
        curlInput = buildCurlProxyConfigInput(options.proxy);
      } else {
        curlArgs.push('--proxy', proxyUrl);
      }
    }
    if (options.insecure) {
      curlArgs.push('--insecure');
    }
    curlArgs.push(safeApkUrl);
    runToolWithInput(curl, curlArgs, curlInput);
  } else {
    const aria2c = findCommand(['aria2c']);
    if (aria2c && isAria2cProxySupported(options.proxy)) {
      const aria2cArgs = [
        '-x', '16',
        '-s', '16',
        '--continue=true', // 断点续传
        '--allow-overwrite=true',
        '--auto-file-renaming=false',
        '--timeout', timeoutSec,
        '--connect-timeout', timeoutSec,
        '--lowest-speed-limit=1024',
        '-o', fileName,
        '--dir', downloadDir,
        '--header', `User-Agent: ${ua}`,
        '--header', `Referer: ${referer}`,
      ];
      let aria2cConfig = null;
      if (options.proxy) {
        const { url: proxyUrl } = splitProxyAuth(options.proxy);
        if (hasProxyCredentials(options.proxy)) {
          aria2cConfig = writeTempConfigFile(
            'yyb-apk-extractor-aria2c-',
            buildAria2cProxyConfigText(options.proxy)
          );
          aria2cArgs.push('--conf-path', aria2cConfig.filePath);
        } else {
          aria2cArgs.push('--all-proxy', proxyUrl);
        }
      }
      if (options.insecure) {
        aria2cArgs.push('--check-certificate=false');
      }
      aria2cArgs.push(safeApkUrl);
      try {
        runToolWithInput(aria2c, aria2cArgs, '');
      } finally {
        if (aria2cConfig) aria2cConfig.cleanup();
      }
    } else {
      const wget = findCommand(['wget']);
      if (wget) {
        if (options.proxy && hasProxyCredentials(options.proxy)) {
          throw new Error('带认证的代理需要 curl 或 aria2c；wget 不接受代理密码出现在命令行');
        }
        if (options.proxy && /^socks5h?:\/\//i.test(options.proxy)) {
          throw new Error('wget 对 socks5/socks5h 代理支持不稳定，请安装 curl 或使用 http:// 代理');
        }
        const wgetArgs = [
          '-T', timeoutSec,
          '-c', // 断点续传
          '--max-redirect=0',
          '-O', filePath,
          `--user-agent=${ua}`,
          `--referer=${referer}`,
        ];
        if (options.insecure) {
          wgetArgs.push('--no-check-certificate');
        }
        wgetArgs.push(safeApkUrl);
        runTool(wget, wgetArgs);
      } else {
        throw new Error('未找到可用的下载工具（aria2c / curl / wget），无法下载 APK');
      }
    }
  }

  // 完整性校验：文件必须存在且非空
  if (!fs.existsSync(filePath)) {
    throw new Error(`下载完成后未找到文件: ${filePath}`);
  }
  const stats = fs.statSync(filePath);
  if (stats.size === 0) {
    throw new Error(`下载完成但文件大小为 0: ${filePath}`);
  }

  // 完整性校验 2：APK 本质是 ZIP，读取前 4 字节魔数 PK\x03\x04 (504b0304)
  let fd;
  try {
    const magic = Buffer.alloc(4);
    fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, magic, 0, 4, 0);
    if (magic.toString('hex') !== '504b0304') {
      try { fs.unlinkSync(filePath); } catch {}
      throw new Error(`下载的文件不是合法 APK/ZIP (魔数 ${magic.toString('hex')} 不匹配 504b0304)，已自动清理`);
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }

  if (!options.verbose) {
    console.error(`${c.green}[ok]${c.reset} ${c.bold}${fileName}${c.reset} ${c.dim}(${formatBytes(stats.size)})${c.reset}`);
  }

  return filePath;
}

function createReadline({ inputTimeoutMs = 30000, maxInputLen = INTERACTIVE_INPUT_MAX_LEN } = {}) {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  let pendingResolve = null;
  let pendingTimer = null;

  const clearPending = () => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    pendingResolve = null;
  };

  rl.on('close', () => {
    closed = true;
    if (pendingResolve) {
      pendingResolve(null);
      clearPending();
    }
  });

  const ask = (prompt) =>
    new Promise((resolve) => {
      if (closed) {
        resolve(null);
        return;
      }
      pendingResolve = resolve;
      rl.question(prompt, (ans) => {
        if (!pendingResolve) return;
        // 限制单行输入长度，防止 DoS
        pendingResolve(typeof ans === 'string' ? ans.slice(0, maxInputLen) : '');
        clearPending();
      });
      pendingTimer = setTimeout(() => {
        if (!pendingResolve) return;
        pendingResolve(null);
        clearPending();
      }, inputTimeoutMs);
    });
  return { rl, ask, isClosed: () => closed };
}

function printInteractiveHelp() {
  console.error(`
可用命令：
  search <关键词>  搜索应用
  list / ls        列出上一次搜索结果
  select <序号>    选中应用
  download         下载当前选中的应用
  get <包名或URL>  直接提取 APK 直链
  proxy <地址>     设置/切换代理（空地址表示清除）
  help             显示本帮助
  exit / quit      退出交互模式
`);
}

function printSearchResults(state) {
  if (!state.results.length) {
    console.error('暂无搜索结果，先输入 search <关键词>');
    return;
  }
  console.error(`\n搜索结果（共 ${state.results.length} 条）：`);
  state.results.forEach((r, i) => {
    const idx = String(i + 1).padStart(2, ' ');
    const size = r.apkSize > 0 ? formatBytes(r.apkSize) : '';
    const meta = [r.pkgName, r.version, r.developer, size].filter(Boolean).join(' | ');
    console.error(`${idx}. ${r.name} ${c.dim}| ${meta}${c.reset}`);
  });
}

async function handleInteractiveSearch(arg, state, options) {
  if (!arg) {
    console.error('请输入搜索关键词');
    return;
  }
  state.busy = true;
  const res = await searchApps(arg, options);
  state.results = res.results;
  state.selected = null;
  printSearchResults(state);
}

function handleInteractiveSelect(arg, state) {
  if (!/^\d+$/.test(arg)) {
    console.error('序号必须是正整数');
    return;
  }
  const idx = Number(arg) - 1;
  if (idx < 0 || idx >= state.results.length) {
    console.error('序号超出范围');
    return;
  }
  state.selected = state.results[idx];
  console.error(`已选中: ${state.selected.name} (${state.selected.pkgName})`);
}

async function handleInteractiveDownload(arg, state, options, ask, isClosed) {
  if (!state.selected) {
    console.error('请先 select 一个应用');
    return;
  }
  let dir = options.downloadDir;
  if (!dir) {
    const answerRaw = await ask('下载目录 (默认当前目录): ');
    if (answerRaw === null || isClosed()) return 'break';
    const answer = answerRaw.trim();
    dir = answer || '.';
  }
  validateDownloadDir(dir, '下载目录');
  state.busy = true;
  const result = await extractApkDownloadUrl(state.selected.pkgName, options);
  const filePath = await downloadApk(result.apkUrl, result.pkgName, dir, options);
  console.log(JSON.stringify({ ...result, downloadedFile: filePath }, null, 2));
}

async function handleInteractiveGet(arg, state, options) {
  if (!arg) {
    console.error('请输入包名或应用宝详情页 URL');
    return;
  }
  state.busy = true;
  const result = await extractApkDownloadUrl(arg, options);
  if (options.downloadDir) {
    result.downloadedFile = await downloadApk(
      result.apkUrl,
      result.pkgName,
      options.downloadDir,
      options
    );
  }
  console.log(JSON.stringify(result, null, 2));
}

function handleInteractiveProxy(arg, options) {
  if (arg) {
    options.proxy = validateProxy(arg);
    options.ignoreProxyEnv = true;
  } else {
    options.proxy = '';
    options.ignoreProxyEnv = true;
  }
  console.error(`代理已设置为: ${options.proxy ? maskUrl(options.proxy) : '无'}`);
}

async function runInteractive(options) {
  if (!process.stdin.isTTY) {
    throw new Error('交互模式需要在 TTY 终端中运行');
  }

  const { rl, ask, isClosed } = createReadline();
  const state = { results: [], selected: null, busy: false, exiting: false };

  const commandMap = {
    help: printInteractiveHelp,
    h: printInteractiveHelp,
    '?': printInteractiveHelp,
    search: handleInteractiveSearch,
    s: handleInteractiveSearch,
    list: () => printSearchResults(state),
    ls: () => printSearchResults(state),
    select: handleInteractiveSelect,
    sel: handleInteractiveSelect,
    download: (arg) => handleInteractiveDownload(arg, state, options, ask, isClosed),
    d: (arg) => handleInteractiveDownload(arg, state, options, ask, isClosed),
    get: (arg) => handleInteractiveGet(arg, state, options),
    g: (arg) => handleInteractiveGet(arg, state, options),
    proxy: (arg) => handleInteractiveProxy(arg, options),
    p: (arg) => handleInteractiveProxy(arg, options),
  };

  try {
    console.error(`${c.bold}${c.cyan}yyb-apk-extractor 交互模式${c.reset} ${c.dim}v${VERSION}${c.reset}\n`);
    printInteractiveHelp();

    while (!state.exiting) {
      const raw = await ask('yyb> ');
      if (raw === null || isClosed()) {
        break;
      }
      const line = typeof raw === 'string' ? raw.trim() : '';
      if (!line) continue;
      const [cmd, ...rest] = line.split(/\s+/);
      const arg = rest.join(' ');

      try {
        if (state.busy) {
          console.error('当前有任务执行中，请等待完成');
          continue;
        }
        if (cmd === 'exit' || cmd === 'quit' || cmd === 'q') {
          state.exiting = true;
          break;
        }
        const handler = commandMap[cmd];
        if (!handler) {
          console.error('未知命令，输入 help 查看帮助');
          continue;
        }
        const handlerResult = await handler(arg);
        if (handlerResult === 'break') {
          break;
        }
      } catch (e) {
        console.error(`${c.red}[error]${c.reset} ${e.message}`);
      } finally {
        state.busy = false;
      }
    }
  } finally {
    rl.close();
  }
}

async function main() {
  const { mode, pkgNameOrUrl, keyword, options } = parseArgs(process.argv);

  if (mode === 'interactive') {
    await runInteractive(options);
    return;
  }

  if (mode === 'search') {
    const result = await searchApps(keyword, options);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // 原有直接提取模式
  const result = await extractApkDownloadUrl(pkgNameOrUrl, options);

  if (options.downloadDir) {
    const filePath = await retryAsync(
      () => downloadApk(result.apkUrl, result.pkgName, options.downloadDir, options),
      2,
      3000
    );
    result.downloadedFile = filePath;
  }

  console.log(JSON.stringify(result, null, 2));
}

function registerGlobalErrorHandlers() {
  process.on('unhandledRejection', (err) => {
    console.error(`${c.red}[error] 未捕获的异步异常:${c.reset} ${err && err.message ? err.message : err}`);
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    console.error(`${c.red}[error] 未捕获的同步异常:${c.reset} ${err && err.message ? err.message : err}`);
    process.exit(1);
  });
}

if (require.main === module) {
  registerGlobalErrorHandlers();
  main().catch((err) => {
    console.error(`${c.red}[error]${c.reset} ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  assertAllowedHttpUrl,
  assertAllowedHostname,
  createChildEnv,
  buildAria2cProxyConfigText,
  buildCurlProxyConfigInput,
  createReadline,
  extractApkDownloadUrl,
  fetchHtmlWithCurl,
  fetchHtmlWithNode,
  formatBytes,
  getPkgName,
  hasProxyCredentials,
  isAria2cProxySupported,
  isValidPkgName,
  maskUrl,
  normalizeUrl,
  parseApkUrlFromHtml,
  parseArgs,
  parseCurlHeaders,
  parseSearchResultsFromHtml,
  resolveDownloadRedirects,
  runInteractive,
  safeTencentUrl,
  sanitizeTerminalOutput,
  searchApps,
  splitProxyAuth,
  validateDownloadDir,
  validateProxy,
  validateSearchKeyword,
};
