const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 加载被测模块（不触发 CLI 主流程）
const {
  buildAria2cProxyConfigText,
  buildCurlProxyConfigInput,
  buildSpawnOptions,
  cleanupTempFiles,
  createChildEnv,
  isValidPkgName,
  hasProxyCredentials,
  validateSearchKeyword,
  sanitizeTerminalOutput,
  sanitizeProcessOutput,
  safeTencentUrl,
  validateDownloadDir,
  parseSearchResultsFromHtml,
  parseArgs,
  validateProxy,
  writeTempConfigFile,
  splitProxyAuth,
  createReadline,
} = require('../index.js');

function test(name, fn) {
  try {
    fn();
    console.log(`  ok: ${name}`);
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

console.log('\n=== 包名校验 ===');
test('合法包名通过', () => {
  assert.strictEqual(isValidPkgName('com.example.app'), true);
  assert.strictEqual(isValidPkgName('a.b'), true);
});
test('非法包名拒绝', () => {
  assert.strictEqual(isValidPkgName('example'), false); // 仅一段
  assert.strictEqual(isValidPkgName('1com.example.app'), false); // 数字开头
  assert.strictEqual(isValidPkgName('com.example.app!'), false); // 特殊字符
  assert.strictEqual(isValidPkgName(''), false);
});

console.log('\n=== 搜索关键词校验 ===');
test('中英文关键词通过', () => {
  assert.strictEqual(validateSearchKeyword('微信'), '微信');
  assert.strictEqual(validateSearchKeyword('  WeChat  '), 'WeChat');
  assert.strictEqual(validateSearchKeyword('AI-chat_2.0'), 'AI-chat_2.0');
});
test('中文标点关键词通过', () => {
  assert.strictEqual(validateSearchKeyword('《微信》'), '《微信》');
  assert.strictEqual(validateSearchKeyword('微信，社交'), '微信，社交');
});
test('空关键词拒绝', () => {
  assert.throws(() => validateSearchKeyword(''), /不能为空/);
  assert.throws(() => validateSearchKeyword('   '), /不能为空/);
});
test('超长关键词拒绝', () => {
  const long = 'a'.repeat(101);
  assert.throws(() => validateSearchKeyword(long), /过长/);
});
test('危险字符拒绝', () => {
  assert.throws(() => validateSearchKeyword('微信;rm -rf /'), /非法字符/);
  assert.throws(() => validateSearchKeyword('微信&url=http://evil.com'), /非法字符/);
});

console.log('\n=== 终端输出净化 ===');
test('ANSI 转义序列被过滤', () => {
  assert.strictEqual(sanitizeTerminalOutput('\x1b[31m微信\x1b[0m'), '微信');
});
test('控制字符被过滤', () => {
  assert.strictEqual(sanitizeTerminalOutput('微\x00信\x1f'), '微信');
});
test('C1 控制字符被过滤', () => {
  assert.strictEqual(sanitizeTerminalOutput('微\u009d信\u009c'), '微信');
});
test('回车换行被过滤', () => {
  assert.strictEqual(sanitizeTerminalOutput('微\r\n信'), '微信');
});
test('正常中文保留', () => {
  assert.strictEqual(sanitizeTerminalOutput('深圳市腾讯计算机系统有限公司'), '深圳市腾讯计算机系统有限公司');
});

console.log('\n=== 腾讯 URL 安全校验 ===');
test('官方 CDN URL 通过', () => {
  assert.strictEqual(
    safeTencentUrl('http://imtt2.dd.qq.com/sjy.00009/sjy.00004/16891/apk/xxx.apk'),
    'http://imtt2.dd.qq.com/sjy.00009/sjy.00004/16891/apk/xxx.apk'
  );
});
test('图标 URL 通过', () => {
  assert.strictEqual(
    safeTencentUrl('http://pp.myapp.com/ma_icon/0/icon_10910_1781183032/256'),
    'http://pp.myapp.com/ma_icon/0/icon_10910_1781183032/256'
  );
});
test('非腾讯域名拒绝', () => {
  assert.strictEqual(safeTencentUrl('http://evil.com/xxx.apk'), '');
});
test('非 http/https 协议拒绝', () => {
  assert.strictEqual(safeTencentUrl('ftp://imtt.dd.qq.com/xxx.apk'), '');
});
test('空值处理', () => {
  assert.strictEqual(safeTencentUrl(''), '');
  assert.strictEqual(safeTencentUrl(null), '');
});

console.log('\n=== 下载目录校验 ===');
test('合法目录通过', () => {
  validateDownloadDir('./downloads');
  validateDownloadDir('/tmp/yyb');
});
test('空目录通过', () => {
  validateDownloadDir('');
});
test('路径遍历拒绝', () => {
  assert.throws(() => validateDownloadDir('../../../etc'), /路径遍历/);
});
test('根目录拒绝', () => {
  assert.throws(() => validateDownloadDir('/'), /根目录/);
});

console.log('\n=== 搜索结果解析 ===');
test('从 __NEXT_DATA__ 解析应用列表', () => {
  const html = `<!DOCTYPE html><html><head></head><body>
    <script id="__NEXT_DATA__" type="application/json">
    {
      "props": {
        "pageProps": {
          "dynamicCardResponse": {
            "ret": 0,
            "msg": "success",
            "data": {
              "components": [
                {
                  "data": {
                    "name": "SearchList",
                    "itemData": [
                      {
                        "pkg_name": "com.tencent.mm",
                        "app_id": "10910",
                        "name": "微信",
                        "icon": "http://pp.myapp.com/icon.png",
                        "download_url": "http://imtt2.dd.qq.com/xxx.apk",
                        "version_name": "8.0.74",
                        "developer": "腾讯",
                        "apk_size": "261152116",
                        "average_rating": "4.30",
                        "editor_intro": "微信，是一个生活方式"
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      }
    }
    </script>
  </body></html>`;
  const results = parseSearchResultsFromHtml(html);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].pkgName, 'com.tencent.mm');
  assert.strictEqual(results[0].name, '微信');
  assert.strictEqual(results[0].icon, 'http://pp.myapp.com/icon.png');
  assert.strictEqual(results[0].rawDownloadUrl, 'http://imtt2.dd.qq.com/xxx.apk');
});
test('非法包名被过滤', () => {
  const html = `<script id="__NEXT_DATA__" type="application/json">
    {"props":{"pageProps":{"dynamicCardResponse":{"ret":0,"data":{"components":[{"data":{"itemData":[{"pkg_name":"not valid","app_id":"1","name":"x"}]}}]}}}}}
  </script>`;
  const results = parseSearchResultsFromHtml(html);
  assert.strictEqual(results.length, 0);
});
test('接口返回异常抛出错误', () => {
  const html = `<script id="__NEXT_DATA__" type="application/json">
    {"props":{"pageProps":{"dynamicCardResponse":{"ret":-1,"msg":"fail"}}}}
  </script>`;
  assert.throws(() => parseSearchResultsFromHtml(html), /接口返回异常/);
});

console.log('\n=== 参数解析 ===');
test('直接模式解析包名', () => {
  const { mode, pkgNameOrUrl, keyword, options } = parseArgs(['node', 'index.js', 'com.example.app']);
  assert.strictEqual(mode, 'direct');
  assert.strictEqual(pkgNameOrUrl, 'com.example.app');
  assert.strictEqual(keyword, '');
  assert.strictEqual(options.verbose, false);
});
test('搜索模式解析关键词并 trim 后校验长度', () => {
  const { mode, keyword } = parseArgs(['node', 'index.js', 'search', '  微信  ']);
  assert.strictEqual(mode, 'search');
  assert.strictEqual(keyword, '  微信  ');
});
test('超长关键词（trim 后合法）不被误拒', () => {
  // 100 个 a + 首尾空格 => trim 后为 100，应合法
  const { mode, keyword } = parseArgs(['node', 'index.js', 'search', ` ${'a'.repeat(100)} `]);
  assert.strictEqual(mode, 'search');
  assert.strictEqual(keyword.trim().length, 100);
});
test('超长关键词（trim 后仍超长）被拒绝', () => {
  assert.throws(() => parseArgs(['node', 'index.js', 'search', ` ${'a'.repeat(101)} `]), /关键词过长/);
});
test('交互模式不接受位置参数', () => {
  assert.throws(() => parseArgs(['node', 'index.js', '--interactive', 'com.example.app']), /--interactive 模式不支持位置参数/);
});
test('解析 --insecure、--verbose、--timeout、--download-dir', () => {
  const { options } = parseArgs([
    'node', 'index.js', 'com.example.app',
    '--insecure', '--verbose', '--timeout=60000', '--download-dir=./dl',
  ]);
  assert.strictEqual(options.insecure, true);
  assert.strictEqual(options.verbose, true);
  assert.strictEqual(options.timeout, 60000);
  assert.strictEqual(options.downloadDir, './dl');
});

console.log('\n=== 代理校验 ===');
test('合法代理 URL 通过', () => {
  assert.strictEqual(validateProxy('http://127.0.0.1:7890'), 'http://127.0.0.1:7890/');
  assert.strictEqual(validateProxy('socks5h://127.0.0.1:1080'), 'socks5h://127.0.0.1:1080');
});
test('代理凭据校验通过', () => {
  assert.strictEqual(validateProxy('http://user:pass@127.0.0.1:7890'), 'http://user:pass@127.0.0.1:7890/');
});
test('非法代理协议拒绝', () => {
  assert.throws(() => validateProxy('ftp://127.0.0.1:7890'), /仅支持/);
});
test('splitProxyAuth 剥离凭据', () => {
  const result = splitProxyAuth('http://user:pass@127.0.0.1:7890');
  assert.strictEqual(result.url, 'http://127.0.0.1:7890/');
  assert.strictEqual(result.username, 'user');
  assert.strictEqual(result.password, 'pass');
});
test('splitProxyAuth 无凭据代理返回空凭据', () => {
  const result = splitProxyAuth('http://127.0.0.1:7890');
  assert.strictEqual(result.url, 'http://127.0.0.1:7890/');
  assert.strictEqual(result.username, '');
  assert.strictEqual(result.password, '');
});
test('代理凭据不进入子进程环境变量', () => {
  const options = {
    proxy: 'http://user:secret@127.0.0.1:7890',
    ignoreProxyEnv: false,
  };
  const env = createChildEnv(options);
  assert.strictEqual(env.HTTPS_PROXY, 'http://127.0.0.1:7890/');
  assert.strictEqual(env.HTTP_PROXY, 'http://127.0.0.1:7890/');
  assert.ok(!env.HTTPS_PROXY.includes('secret'));
  assert.ok(!env.HTTP_PROXY.includes('secret'));
  assert.ok(!env.ALL_PROXY.includes('secret'));
});
test('默认子进程环境变量不透传父进程代理凭据', () => {
  const oldHttpsProxy = process.env.HTTPS_PROXY;
  const oldHttpProxy = process.env.HTTP_PROXY;
  const oldAllProxy = process.env.ALL_PROXY;
  process.env.HTTPS_PROXY = 'http://user:secret@127.0.0.1:7890';
  process.env.HTTP_PROXY = 'http://user:secret@127.0.0.1:7890';
  process.env.ALL_PROXY = 'http://user:secret@127.0.0.1:7890';
  try {
    const env = createChildEnv({ proxy: '', ignoreProxyEnv: false });
    assert.strictEqual(env.HTTPS_PROXY, 'http://127.0.0.1:7890/');
    assert.strictEqual(env.HTTP_PROXY, 'http://127.0.0.1:7890/');
    assert.strictEqual(env.ALL_PROXY, 'http://127.0.0.1:7890/');
    assert.ok(!env.HTTPS_PROXY.includes('secret'));
    assert.ok(!env.HTTP_PROXY.includes('secret'));
    assert.ok(!env.ALL_PROXY.includes('secret'));
  } finally {
    if (oldHttpsProxy === undefined) delete process.env.HTTPS_PROXY;
    else process.env.HTTPS_PROXY = oldHttpsProxy;
    if (oldHttpProxy === undefined) delete process.env.HTTP_PROXY;
    else process.env.HTTP_PROXY = oldHttpProxy;
    if (oldAllProxy === undefined) delete process.env.ALL_PROXY;
    else process.env.ALL_PROXY = oldAllProxy;
  }
});
test('忽略代理环境变量时不传递任何代理变量', () => {
  const oldHttpsProxy = process.env.HTTPS_PROXY;
  process.env.HTTPS_PROXY = 'http://user:secret@127.0.0.1:7890';
  try {
    const env = createChildEnv({ proxy: '', ignoreProxyEnv: true });
    assert.strictEqual(env.HTTPS_PROXY, undefined);
  } finally {
    if (oldHttpsProxy === undefined) delete process.env.HTTPS_PROXY;
    else process.env.HTTPS_PROXY = oldHttpsProxy;
  }
});
test('createChildEnv 默认参数不会崩溃', () => {
  const env = createChildEnv();
  assert.ok(env);
  assert.strictEqual(typeof env, 'object');
});
test('认证代理通过工具配置输入承载，不拼入无凭据 URL', () => {
  const proxy = 'http://user:secret@127.0.0.1:7890';
  const { url } = splitProxyAuth(proxy);
  assert.strictEqual(hasProxyCredentials(proxy), true);
  assert.strictEqual(url, 'http://127.0.0.1:7890/');
  assert.ok(buildCurlProxyConfigInput(proxy).includes('secret'));
  assert.ok(buildAria2cProxyConfigText(proxy).includes('secret'));
  assert.ok(!url.includes('secret'));
});
test('带 stdin 的 verbose 下载命令仍继承 stdout/stderr', () => {
  const options = buildSpawnOptions({
    env: {},
    stdio: 'inherit',
    input: 'proxy = "http://user:secret@127.0.0.1:7890/"\n',
  });
  assert.deepStrictEqual(options.stdio, ['pipe', 'inherit', 'inherit']);
  assert.ok(options.input.includes('secret'));
});
test('带 stdin 的非 verbose 下载命令保持输出可捕获', () => {
  const options = buildSpawnOptions({
    env: {},
    stdio: 'pipe',
    input: 'proxy = "http://user:secret@127.0.0.1:7890/"\n',
  });
  assert.deepStrictEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
});
test('临时配置文件清理可删除凭据文件且可重复调用', () => {
  const tempConfig = writeTempConfigFile(
    'yyb-apk-extractor-test-',
    buildAria2cProxyConfigText('http://user:secret@127.0.0.1:7890/')
  );
  assert.ok(fs.existsSync(tempConfig.filePath));
  assert.ok(fs.readFileSync(tempConfig.filePath, 'utf8').includes('secret'));
  const dir = path.dirname(tempConfig.filePath);
  tempConfig.cleanup();
  tempConfig.cleanup();
  assert.strictEqual(fs.existsSync(dir), false);
});
test('进程级临时文件清理会清空待清理配置', () => {
  const tempConfig = writeTempConfigFile(
    'yyb-apk-extractor-test-',
    buildAria2cProxyConfigText('http://user:secret@127.0.0.1:7890/')
  );
  const dir = path.dirname(tempConfig.filePath);
  cleanupTempFiles();
  assert.strictEqual(fs.existsSync(dir), false);
});
test('工具失败 stderr Buffer 可正确转成文本', () => {
  const buf = Buffer.from('proxy failed', 'utf8');
  assert.strictEqual(sanitizeProcessOutput(buf), 'proxy failed');
});
test('工具失败 stderr 中的代理凭据会脱敏', () => {
  const text = [
    'proxy = "http://user:secret@127.0.0.1:7890/"',
    'all-proxy=http://user:secret@127.0.0.1:7890/',
    'failed http://user:secret@127.0.0.1:7890/',
    'failed socks5://user:secret@127.0.0.1:1080',
    'failed socks5h://user:secret@127.0.0.1:1080',
  ].join('\n');
  const sanitized = sanitizeProcessOutput(text);
  assert.ok(!sanitized.includes('secret'));
  assert.ok(sanitized.includes('http://***@127.0.0.1:7890/'));
  assert.ok(sanitized.includes('socks5://***@127.0.0.1:1080'));
  assert.ok(sanitized.includes('socks5h://***@127.0.0.1:1080'));
});

console.log('\n=== readline 封装 ===');
test('createReadline 返回 ask/isClosed/rl', () => {
  const { ask, isClosed, rl } = createReadline();
  assert.strictEqual(typeof ask, 'function');
  assert.strictEqual(typeof isClosed, 'function');
  assert.ok(rl);
  rl.close();
});
test('createReadline 关闭后 isClosed 为 true', () => {
  const { rl, isClosed } = createReadline();
  rl.close();
  assert.strictEqual(isClosed(), true);
});

console.log('\n测试完成。');
