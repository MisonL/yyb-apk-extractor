const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 加载被测模块（不触发 CLI 主流程）
const {
  buildAria2cDownloadArgs,
  buildAria2cProxyConfigText,
  buildCommandInvocation,
  buildCurlDownloadArgs,
  buildCurlProxyConfigInput,
  buildSpawnOptions,
  buildWgetDownloadArgs,
  clearCommandCache,
  collectDoctorInfo,
  cleanupTempFiles,
  createColors,
  createChildEnv,
  downloadApk,
  getCommandCandidates,
  getCurlOutputTarget,
  getDownloadOrder,
  getSupportedSignals,
  isExistingWindowsExecutableCandidate,
  isValidPkgName,
  isDirectAppInput,
  findAppInfoFromHtml,
  formatAppConfirmSummary,
  normalizeInteractiveCommand,
  parseConnections,
  parseCustomDirConfirmAnswer,
  parseDownloader,
  parseDownloadPromptAnswer,
  parseResultIndex,
  parseTimeoutMs,
  resolveInteractiveDownloadDir,
  hasProxyCredentials,
  validateSearchKeyword,
  sanitizeTerminalOutput,
  sanitizeProcessOutput,
  safeTencentUrl,
  sanitizeDownloadFileName,
  validateDownloadDir,
  selectDownloader,
  timeoutSeconds,
  parseAppEntriesFromHtml,
  dedupeAppEntries,
  formatSearchResultsSummary,
  maybeDownloadAfterConfirm,
  parseSearchResultsFromHtml,
  parseArgs,
  resolveDirectDownloadDir,
  validateProxy,
  verifyDownloadedApkFile,
  writeTempConfigFile,
  splitProxyAuth,
  handleInteractiveTimeout,
  createReadline,
  shouldUseColor,
} = require('../index.js');

const testQueue = [];
const apkMagic = Buffer.from('504b030400000000', 'hex');

function section(name) {
  testQueue.push({ section: name });
}

function test(name, fn) {
  testQueue.push({ name, fn });
}

async function runTests() {
  for (const item of testQueue) {
    if (item.section) {
      console.log(item.section);
      continue;
    }
    try {
      await item.fn();
      console.log(`  ok: ${item.name}`);
    } catch (e) {
      console.error(`  FAIL: ${item.name}`);
      console.error(`    ${e.message}`);
      process.exitCode = 1;
    }
  }
}

section('\n=== 包名校验 ===');
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

section('\n=== 搜索关键词校验 ===');
test('中英文关键词通过', () => {
  assert.strictEqual(validateSearchKeyword('微信'), '微信');
  assert.strictEqual(validateSearchKeyword('  WeChat  '), 'WeChat');
  assert.strictEqual(validateSearchKeyword('AI-chat_2.0'), 'AI-chat_2.0');
});
test('中文标点关键词通过', () => {
  assert.strictEqual(validateSearchKeyword('《微信》'), '《微信》');
  assert.strictEqual(validateSearchKeyword('微信，社交'), '微信，社交');
});
test('常见程序名符号关键词通过', () => {
  assert.strictEqual(validateSearchKeyword('C#'), 'C#');
  assert.strictEqual(validateSearchKeyword('99%'), '99%');
  assert.strictEqual(validateSearchKeyword('A*'), 'A*');
  assert.strictEqual(validateSearchKeyword('@foo'), '@foo');
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
  assert.throws(() => validateSearchKeyword('微信|cat'), /非法字符/);
});

section('\n=== 终端输出净化 ===');
test('NO_COLOR 只要存在就禁用颜色', () => {
  assert.strictEqual(shouldUseColor({ isTTY: true }, ['node', 'index.js'], {}), true);
  assert.strictEqual(shouldUseColor({ isTTY: true }, ['node', 'index.js'], { NO_COLOR: '1' }), false);
  assert.strictEqual(shouldUseColor({ isTTY: true }, ['node', 'index.js'], { NO_COLOR: '' }), false);
  assert.strictEqual(shouldUseColor({ isTTY: false }, ['node', 'index.js'], {}), false);
  assert.strictEqual(shouldUseColor({ isTTY: true }, ['node', 'index.js', '--no-color'], {}), false);
});

test('禁用颜色时 ANSI 码为空', () => {
  const colors = createColors(false);
  assert.strictEqual(colors.bold, '');
  assert.strictEqual(colors.cyan, '');
  assert.strictEqual(colors.reset, '');
});

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

section('\n=== 腾讯 URL 安全校验 ===');
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
test('allowedHosts 仅支持星号通配符且其他正则元字符按字面量处理', () => {
  assert.strictEqual(safeTencentUrl('http://safe.example.com.evil.com/a.apk', ['safe.example.com']), '');
  assert.strictEqual(safeTencentUrl('http://safeXexample.com/a.apk', ['safe+example.com']), '');
  assert.strictEqual(
    safeTencentUrl('http://safe.example.com/a.apk', ['safe.example.com']),
    'http://safe.example.com/a.apk'
  );
  assert.strictEqual(
    safeTencentUrl('http://cdn.example.com/a.apk', ['*.example.com']),
    'http://cdn.example.com/a.apk'
  );
});
test('空值处理', () => {
  assert.strictEqual(safeTencentUrl(''), '');
  assert.strictEqual(safeTencentUrl(null), '');
});

section('\n=== 下载目录校验 ===');
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
test('下载文件名兼容 Windows 非法字符和保留名', () => {
  assert.strictEqual(sanitizeDownloadFileName('../a<b>:c?.apk', 'fallback.apk'), 'a_b__c_.apk');
  assert.strictEqual(sanitizeDownloadFileName('CON.apk', 'fallback.apk'), '_CON.apk');
  assert.strictEqual(sanitizeDownloadFileName('COM0.apk', 'fallback.apk'), '_COM0.apk');
  assert.strictEqual(sanitizeDownloadFileName('CLOCK$.apk', 'fallback.apk'), '_CLOCK$.apk');
  assert.strictEqual(sanitizeDownloadFileName('bad name. ', 'fallback.apk'), 'bad name');
  assert.strictEqual(sanitizeDownloadFileName('', 'fallback.apk'), 'fallback.apk');
});

section('\n=== 搜索结果解析 ===');
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
test('畸形搜索数据会跳过而不是抛出', () => {
  const html = `<script id="__NEXT_DATA__" type="application/json">
    {"props":{"pageProps":{"dynamicCardResponse":{"ret":0,"data":{"components":[
      {"data":{"itemData":"bad"}},
      {"data":{"itemData":[null, "bad", 123, {"pkg_name":"com.example.app","name":"ok"}]}},
      null
    ]}}}}}
  </script>`;
  const results = parseSearchResultsFromHtml(html);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].pkgName, 'com.example.app');

  const noComponents = `<script id="__NEXT_DATA__" type="application/json">
    {"props":{"pageProps":{"dynamicCardResponse":{"ret":0,"data":{"components":"bad"}}}}}
  </script>`;
  assert.deepStrictEqual(parseSearchResultsFromHtml(noComponents), []);
});
test('接口返回异常抛出错误', () => {
  const html = `<script id="__NEXT_DATA__" type="application/json">
    {"props":{"pageProps":{"dynamicCardResponse":{"ret":-1,"msg":"fail"}}}}
  </script>`;
  assert.throws(() => parseSearchResultsFromHtml(html), /接口返回异常/);
});
test('详情页可按包名提取目标应用信息', () => {
  const html = `<script id="__NEXT_DATA__" type="application/json">
    {"props":{"pageProps":{"dynamicCardResponse":{"ret":0,"data":{"components":[{"data":{"itemData":[
      {"pkg_name":"com.example.other","name":"其他应用"},
      {
        "pkg_name":"com.tencent.mm",
        "app_id":"10910",
        "name":"微信",
        "icon":"http://pp.myapp.com/icon.png",
        "download_url":"http://imtt2.dd.qq.com/xxx.apk",
        "version_name":"8.0.74",
        "developer":"腾讯",
        "apk_size":"261152116",
        "average_rating":"4.30",
        "editor_intro":"微信，是一个生活方式"
      }
    ]}}]}}}}}
  </script>`;
  const appInfo = findAppInfoFromHtml(html, 'com.tencent.mm');
  assert.strictEqual(appInfo.pkgName, 'com.tencent.mm');
  assert.strictEqual(appInfo.name, '微信');
  assert.strictEqual(appInfo.version, '8.0.74');
});
test('搜索结果解析返回应用宝页面中的全部应用条目', () => {
  const itemData = Array.from({ length: 25 }, (_, i) => ({
    pkg_name: `com.example.app${i}`,
    name: `应用${i}`,
  }));
  const html = `<script id="__NEXT_DATA__" type="application/json">
    ${JSON.stringify({ props: { pageProps: { dynamicCardResponse: { ret: 0, data: { components: [{ data: { itemData } }] } } } } })}
  </script>`;
  assert.strictEqual(parseAppEntriesFromHtml(html).length, 25);
  assert.strictEqual(parseSearchResultsFromHtml(html).length, 25);
});
test('搜索结果按包名去重且保留首次出现顺序', () => {
  const entries = [
    { pkgName: 'com.tencent.mm', name: '微信-1' },
    { pkgName: 'com.tencent.mobileqq', name: 'QQ' },
    { pkgName: 'com.tencent.mm', name: '微信-2' },
  ];
  const deduped = dedupeAppEntries(entries);
  assert.deepStrictEqual(deduped.map((item) => item.pkgName), ['com.tencent.mm', 'com.tencent.mobileqq']);
  assert.strictEqual(deduped[0].name, '微信-1');
});
test('搜索结果摘要适合终端快速浏览', () => {
  const summary = formatSearchResultsSummary({
    query: '微信',
    count: 2,
    results: [
      {
        pkgName: 'com.tencent.mm',
        name: '微信',
        version: '8.0.74',
        developer: '腾讯',
        apkSize: 261152116,
      },
      {
        pkgName: 'com.tencent.mobileqq',
        name: 'QQ',
        version: '9.0.0',
        developer: '腾讯',
        apkSize: 0,
      },
    ],
  });
  assert.ok(summary.includes('搜索结果: 微信 (2 条)'));
  assert.ok(summary.includes('- 微信 | com.tencent.mm | 8.0.74 | 腾讯 | 249.05 MB'));
  assert.ok(summary.includes('可直接用 select <序号> 或 download <序号> 继续。'));
});
test('确认下载摘要展示详细应用信息', () => {
  const summary = formatAppConfirmSummary(
    {
      pkgName: 'com.tencent.mm',
      detailUrl: 'https://sj.qq.com/appdetail/com.tencent.mm',
      apkUrl: 'http://imtt2.dd.qq.com/xxx.apk',
    },
    {
      pkgName: 'com.tencent.mm',
      appId: '10910',
      name: '微信',
      version: '8.0.74',
      developer: '腾讯',
      apkSize: 261152116,
      rating: '4.30',
      intro: '微信，是一个生活方式',
      icon: 'http://pp.myapp.com/icon.png',
    },
    null,
    './downloads'
  );
  assert.ok(summary.includes('名称: 微信'));
  assert.ok(summary.includes('包名: com.tencent.mm'));
  assert.ok(summary.includes('版本: 8.0.74'));
  assert.ok(summary.includes('大小: 249.05 MB'));
  assert.ok(summary.includes('APK: http://imtt2.dd.qq.com/xxx.apk'));
  assert.ok(summary.includes('下载目录: ./downloads'));
});
test('确认下载摘要展示详情获取失败原因', () => {
  const summary = formatAppConfirmSummary(
    {
      pkgName: 'com.tencent.mm',
      detailUrl: 'https://sj.qq.com/appdetail/com.tencent.mm',
      apkUrl: 'http://imtt2.dd.qq.com/xxx.apk',
    },
    null,
    new Error('HTTP 500'),
    './downloads'
  );
  assert.ok(summary.includes('详情状态: 获取失败: HTTP 500'));
  assert.ok(summary.includes('包名: com.tencent.mm'));
});
test('下载确认输入可区分跳过、默认下载与自定义目录', () => {
  assert.deepStrictEqual(parseDownloadPromptAnswer('n', './downloads'), { action: 'skip' });
  assert.deepStrictEqual(parseDownloadPromptAnswer(' ', './downloads'), { action: 'download', dir: './downloads' });
  assert.deepStrictEqual(parseDownloadPromptAnswer('yes', './downloads'), { action: 'download', dir: './downloads' });
  assert.deepStrictEqual(parseDownloadPromptAnswer('./apk', './downloads'), { action: 'custom-dir', dir: './apk' });
});
test('下载确认空回车与 yes 都走默认目录', () => {
  assert.deepStrictEqual(parseDownloadPromptAnswer('   ', './downloads'), { action: 'download', dir: './downloads' });
  assert.deepStrictEqual(parseDownloadPromptAnswer('y', './downloads'), { action: 'download', dir: './downloads' });
  assert.deepStrictEqual(parseDownloadPromptAnswer('好的', './downloads'), { action: 'download', dir: './downloads' });
  assert.deepStrictEqual(parseDownloadPromptAnswer('ok', './downloads'), { action: 'download', dir: './downloads' });
  assert.deepStrictEqual(parseDownloadPromptAnswer('不下载', './downloads'), { action: 'skip' });
  assert.deepStrictEqual(parseDownloadPromptAnswer('cancel', './downloads'), { action: 'skip' });
  assert.deepStrictEqual(parseDownloadPromptAnswer('q', './downloads'), { action: 'skip' });
  assert.deepStrictEqual(parseDownloadPromptAnswer('quit', './downloads'), { action: 'skip' });
});
test('自定义目录二次确认可取消或继续改目录', () => {
  assert.deepStrictEqual(parseCustomDirConfirmAnswer(''), { action: 'download' });
  assert.deepStrictEqual(parseCustomDirConfirmAnswer('n'), { action: 'skip' });
  assert.deepStrictEqual(parseCustomDirConfirmAnswer('q'), { action: 'skip' });
  assert.deepStrictEqual(parseCustomDirConfirmAnswer('./apk2'), { action: 'custom-dir', dir: './apk2' });
});
test('交互模式默认下载目录可被 --download-dir 覆盖', () => {
  assert.strictEqual(resolveInteractiveDownloadDir({}), './downloads');
  assert.strictEqual(resolveInteractiveDownloadDir({ downloadDir: './apk' }), './apk');
});
test('交互下载目录非法时留在当前确认流程并允许取消', async () => {
  const prompts = [];
  const answers = ['../bad', 'n'];
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await maybeDownloadAfterConfirm(
      { pkgName: 'com.example.app', apkUrl: 'http://imtt.dd.qq.com/app.apk' },
      { downloadDir: './downloads', timeout: 1, ignoreProxyEnv: true },
      async (prompt) => {
        prompts.push(prompt);
        return answers.shift();
      },
      () => false
    );
    assert.strictEqual(result.pkgName, 'com.example.app');
    assert.ok(prompts.some((prompt) => prompt.includes('请重新输入下载目录')));
  } finally {
    console.error = originalError;
  }
});

section('\n=== 参数解析 ===');
test('直接模式解析包名', () => {
  const { mode, pkgNameOrUrl, keyword, options } = parseArgs(['node', 'index.js', 'com.example.app']);
  assert.strictEqual(mode, 'direct');
  assert.strictEqual(pkgNameOrUrl, 'com.example.app');
  assert.strictEqual(keyword, '');
  assert.strictEqual(options.verbose, false);
});
test('无参数默认进入交互模式', () => {
  const { mode, pkgNameOrUrl, keyword } = parseArgs(['node', 'index.js']);
  assert.strictEqual(mode, 'interactive');
  assert.strictEqual(pkgNameOrUrl, '');
  assert.strictEqual(keyword, '');
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
test('解析下载器、多线程和连接数选项', () => {
  const { options } = parseArgs([
    'node', 'index.js', 'com.example.app',
    '--downloader=aria2c', '--multi-thread', '--connections=8',
  ]);
  assert.strictEqual(options.downloader, 'aria2c');
  assert.strictEqual(options.multiThread, true);
  assert.strictEqual(options.connections, 8);
});
test('下载器和连接数非法值会被拒绝', () => {
  assert.throws(() => parseDownloader('bad', '--downloader'), /仅支持/);
  assert.throws(() => parseConnections('0', '--connections'), /1-16/);
  assert.throws(() => parseConnections('17', '--connections'), /1-16/);
  assert.throws(() => parseArgs(['node', 'index.js', 'com.example.app', '--downloader=bad']), /仅支持/);
  assert.throws(() => parseArgs(['node', 'index.js', 'com.example.app', '--connections=x']), /1-16/);
});
test('doctor 模式解析', () => {
  const { mode, pkgNameOrUrl } = parseArgs(['node', 'index.js', 'doctor']);
  assert.strictEqual(mode, 'doctor');
  assert.strictEqual(pkgNameOrUrl, '');
});
test('解析带单位的 --timeout', () => {
  assert.strictEqual(parseTimeoutMs('500ms', '--timeout'), 500);
  assert.strictEqual(parseTimeoutMs('10s', '--timeout'), 10000);
  assert.strictEqual(parseTimeoutMs('5m', '--timeout'), 300000);
  assert.strictEqual(parseTimeoutMs('5000', '--timeout'), 5000);
  assert.throws(() => parseTimeoutMs('0s', '--timeout'), /正整数/);
  assert.throws(() => parseTimeoutMs('abc', '--timeout'), /带单位/);
  assert.throws(() => parseTimeoutMs('9999999999999999999', '--timeout'), /过大/);
  const { options } = parseArgs(['node', 'index.js', 'com.example.app', '--timeout=10s']);
  assert.strictEqual(options.timeout, 10000);
});
test('外部工具秒级超时向上取整', () => {
  assert.strictEqual(timeoutSeconds({ timeout: 1200 }), '2');
  assert.strictEqual(timeoutSeconds({ timeout: 1000 }), '1');
});
test('URL 直接调用默认下载到 downloads', () => {
  assert.strictEqual(
    resolveDirectDownloadDir('https://sj.qq.com/appdetail/com.tencent.mm', { downloadDir: '' }),
    './downloads'
  );
});
test('包名直接调用不默认下载', () => {
  assert.strictEqual(resolveDirectDownloadDir('com.tencent.mm', { downloadDir: '' }), '');
});
test('显式下载目录优先于 URL 默认目录', () => {
  assert.strictEqual(
    resolveDirectDownloadDir('https://sj.qq.com/appdetail/com.tencent.mm', { downloadDir: './dl' }),
    './dl'
  );
});
test('交互模式可识别直接粘贴的 URL 或包名', () => {
  assert.strictEqual(isDirectAppInput('https://sj.qq.com/appdetail/com.tencent.mm'), true);
  assert.strictEqual(isDirectAppInput('com.tencent.mm'), true);
  assert.strictEqual(isDirectAppInput('微信'), false);
});
test('交互下载命令支持直接选择搜索结果序号', () => {
  assert.deepStrictEqual(parseResultIndex('1', 3), { idx: 0 });
  assert.strictEqual(parseResultIndex('0', 3).error, '序号超出范围');
  assert.strictEqual(parseResultIndex('x', 3).error, '序号必须是正整数');
});
test('交互命令大小写不敏感', () => {
  assert.strictEqual(normalizeInteractiveCommand('Search'), 'search');
  assert.strictEqual(normalizeInteractiveCommand('EXIT'), 'exit');
});
test('交互 timeout 命令可查看和更新超时', () => {
  const options = { timeout: 30000 };
  const originalError = console.error;
  console.error = () => {};
  try {
    handleInteractiveTimeout('10s', options);
    assert.strictEqual(options.timeout, 10000);
    handleInteractiveTimeout('', options);
    assert.strictEqual(options.timeout, 10000);
  } finally {
    console.error = originalError;
  }
});
test('默认下载顺序优先 curl，多线程自动模式优先 aria2c', () => {
  assert.deepStrictEqual(getDownloadOrder(), ['curl', 'aria2c', 'wget']);
  assert.deepStrictEqual(getDownloadOrder({ downloader: 'auto', multiThread: false }), ['curl', 'aria2c', 'wget']);
  assert.deepStrictEqual(getDownloadOrder({ downloader: 'auto', multiThread: true }), ['aria2c', 'curl', 'wget']);
  assert.deepStrictEqual(getDownloadOrder({ downloader: 'wget', multiThread: true }), ['wget']);
});
test('下载器选择跳过不可用工具并尊重显式工具', () => {
  const findOnlyCurl = ([name]) => (name === 'curl' ? 'curl' : null);
  assert.deepStrictEqual(
    selectDownloader({ downloader: 'auto', multiThread: true }, findOnlyCurl),
    { downloader: 'curl', command: 'curl' }
  );
  assert.throws(
    () => selectDownloader({ downloader: 'aria2c', proxy: 'socks5h://127.0.0.1:1080' }, () => 'aria2c'),
    /不支持 socks5/
  );
  assert.throws(
    () => selectDownloader({ downloader: 'wget', proxy: 'http://user:pass@127.0.0.1:7890' }, () => 'wget'),
    /代理凭据/
  );
});
test('doctor 环境检查返回工具状态与提示', () => {
  const result = collectDoctorInfo({
    find: ([name]) => (name === 'curl' ? 'curl' : null),
    platform: 'test-os',
    nodeVersion: 'v1.2.3',
  });
  assert.strictEqual(result.platform, 'test-os');
  assert.strictEqual(result.nodeVersion, 'v1.2.3');
  assert.strictEqual(result.tools.curl.available, true);
  assert.strictEqual(result.tools.aria2c.available, false);
  assert.ok(result.notes.some((note) => note.includes('aria2c')));
});
test('curl 预检输出目标按平台选择', () => {
  assert.strictEqual(getCurlOutputTarget('win32'), 'NUL');
  assert.strictEqual(getCurlOutputTarget('darwin'), require('os').devNull);
});
test('Windows 命令候选包含 PATHEXT shim 且优先 PATH 路径', () => {
  const candidates = getCommandCandidates('aria2c', {
    PATH: 'C:\\fake-bin;C:\\real-bin',
    PATHEXT: '.EXE;.CMD',
  }, 'win32');
  assert.strictEqual(candidates[0], path.win32.join('C:\\fake-bin', 'aria2c'));
  assert.ok(candidates.includes(path.win32.join('C:\\fake-bin', 'aria2c.cmd')));
  assert.ok(candidates.indexOf(path.win32.join('C:\\fake-bin', 'aria2c.cmd')) < candidates.indexOf('aria2c'));
});
test('Windows .cmd 下载工具通过 cmd.exe 受控执行', () => {
  const oldComSpec = process.env.ComSpec;
  process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe';
  try {
    const invocation = buildCommandInvocation('C:\\fake bin\\aria2c.cmd', ['--dir', 'C:\\out dir', 'http://example.com/a.apk?x=1&y=2'], 'win32');
    assert.strictEqual(invocation.command, 'C:\\Windows\\System32\\cmd.exe');
    assert.deepStrictEqual(invocation.args.slice(0, 2), ['/d', '/c']);
    assert.ok(invocation.args[2].startsWith('call '));
    assert.ok(invocation.args[2].includes('"C:\\fake bin\\aria2c.cmd"'));
    assert.ok(invocation.args[2].includes('"http://example.com/a.apk?x=1&y=2"'));
  } finally {
    if (oldComSpec === undefined) delete process.env.ComSpec;
    else process.env.ComSpec = oldComSpec;
  }
});
test('Windows 已存在命令候选可直接识别', () => {
  const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'yyb-win-candidate-'));
  const candidate = path.join(tempDir, 'aria2c.cmd');
  fs.writeFileSync(candidate, '@echo off\r\nexit /b 0\r\n');
  try {
    assert.strictEqual(isExistingWindowsExecutableCandidate(candidate, 'win32'), true);
    assert.strictEqual(isExistingWindowsExecutableCandidate(candidate, 'darwin'), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

section('\n=== 下载器执行 ===');
test('curl 下载参数支持认证代理、证书降级和断点续传', () => {
  const { args, input } = buildCurlDownloadArgs({
    filePath: '/tmp/app.apk',
    safeApkUrl: 'http://imtt.dd.qq.com/app.apk',
    timeoutSec: '30',
    ua: 'test-ua',
    referer: 'https://a.app.qq.com/',
    options: {
      proxy: 'http://user:p%40ss%3Aword@127.0.0.1:7890',
      insecure: true,
    },
  });
  assert.ok(args.includes('--fail'));
  assert.strictEqual(args[args.indexOf('--connect-timeout') + 1], '30');
  assert.ok(args.includes('-C'));
  assert.ok(args.includes('-K'));
  assert.ok(args.includes('--silent'));
  assert.ok(args.includes('--show-error'));
  assert.ok(args.includes('--insecure'));
  assert.strictEqual(args[args.length - 1], 'http://imtt.dd.qq.com/app.apk');
  assert.ok(input.includes('p%40ss%3Aword'));
  assert.ok(!input.includes('p%2540ss%253Aword'));
});
test('wget 下载参数允许有限重定向并支持证书降级', () => {
  const args = buildWgetDownloadArgs({
    filePath: '/tmp/app.apk',
    safeApkUrl: 'http://imtt.dd.qq.com/app.apk',
    timeoutSec: '30',
    ua: 'test-ua',
    referer: 'https://a.app.qq.com/',
    options: { insecure: true },
  });
  assert.strictEqual(args[args.indexOf('-T') + 1], '30');
  assert.ok(args.includes('-c'));
  assert.ok(args.includes('--no-verbose'));
  assert.ok(args.includes('--max-redirect=5'));
  assert.ok(args.includes('--no-check-certificate'));
  assert.strictEqual(args[args.length - 1], 'http://imtt.dd.qq.com/app.apk');
});
test('wget verbose 模式保留工具输出', () => {
  const args = buildWgetDownloadArgs({
    filePath: '/tmp/app.apk',
    safeApkUrl: 'http://imtt.dd.qq.com/app.apk',
    timeoutSec: '30',
    ua: 'test-ua',
    referer: 'https://a.app.qq.com/',
    options: { verbose: true },
  });
  assert.strictEqual(args.includes('--no-verbose'), false);
});
test('aria2c 参数构造包含多连接、超时、请求头与净化文件名', () => {
  const args = buildAria2cDownloadArgs({
    fileName: sanitizeDownloadFileName('CON:bad?.apk', 'com.example.app.apk'),
    downloadDir: '/tmp/downloads',
    safeApkUrl: 'http://imtt.dd.qq.com/sjy.00022/app.apk',
    timeoutSec: '30',
    ua: 'test-ua',
    referer: 'https://a.app.qq.com/',
    options: {
      connections: 4,
      proxy: '',
      insecure: true,
    },
  });
  assert.strictEqual(args[args.indexOf('-x') + 1], '4');
  assert.strictEqual(args[args.indexOf('-s') + 1], '4');
  assert.strictEqual(args[args.indexOf('--timeout') + 1], '30');
  assert.strictEqual(args[args.indexOf('--connect-timeout') + 1], '30');
  assert.strictEqual(args[args.indexOf('-o') + 1], 'CON_bad_.apk');
  assert.strictEqual(args[args.indexOf('--dir') + 1], '/tmp/downloads');
  assert.ok(args.includes('--header'));
  assert.ok(args.includes('User-Agent: test-ua'));
  assert.ok(args.includes('Referer: https://a.app.qq.com/'));
  assert.ok(args.includes('--summary-interval=0'));
  assert.ok(args.includes('--console-log-level=warn'));
  assert.ok(args.includes('--check-certificate=false'));
  assert.strictEqual(args[args.length - 1], 'http://imtt.dd.qq.com/sjy.00022/app.apk');
});
test('aria2c 下载参数可用 fake 命令验证且文件名已净化', async () => {
  const oldPath = process.env.PATH;
  const oldPathKey = process.env.Path;
  const basePath = process.platform === 'win32' ? (oldPathKey || oldPath || '') : (oldPath || '');
  const binDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'yyb-fake-bin-'));
  const downloadDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'yyb-download-test-'));
  const argvFile = path.join(downloadDir, 'argv.json');
  const fakeAria2c = path.join(binDir, process.platform === 'win32' ? 'aria2c.cmd' : 'aria2c');
  const fakeRunner = path.join(binDir, 'fake-aria2c.js');
  fs.writeFileSync(fakeRunner, [
    "const fs = require('fs');",
    "const path = require('path');",
    "const args = process.argv.slice(2);",
    "if (args[0] === '--version') process.exit(0);",
    "fs.writeFileSync(process.env.YYB_ARGV_FILE, JSON.stringify(args));",
    "const dir = args[args.indexOf('--dir') + 1];",
    "const name = args[args.indexOf('-o') + 1];",
    `fs.writeFileSync(path.join(dir, name), Buffer.from('${apkMagic.toString('hex')}', 'hex'));`,
  ].join('\n'));
  const script = process.platform === 'win32'
    ? [
        '@echo off',
        `"${process.execPath}" "%~dp0fake-aria2c.js" %*`,
      ].join('\r\n')
    : [
        '#!/bin/sh',
        'node "$(dirname "$0")/fake-aria2c.js" "$@"',
      ].join('\n');
  fs.writeFileSync(fakeAria2c, script, { mode: 0o755 });
  clearCommandCache();
  process.env.PATH = `${binDir}${path.delimiter}${basePath}`;
  if (process.platform === 'win32') {
    process.env.Path = process.env.PATH;
  }
  process.env.YYB_ARGV_FILE = argvFile;
  const selected = selectDownloader({ downloader: 'aria2c', proxy: '' });
  if (process.platform === 'win32') {
    assert.strictEqual(selected.command.toLowerCase(), fakeAria2c.toLowerCase());
  } else {
    assert.strictEqual(selected.command, 'aria2c');
  }
  clearCommandCache();
  const oldConsoleError = console.error;
  console.error = () => {};
  try {
    const filePath = await downloadApk(
      'http://imtt.dd.qq.com/sjy.00022/app.apk?fsname=CON%3Abad%3F.apk',
      'com.example.app',
      downloadDir,
      {
        downloader: 'aria2c',
        connections: 4,
        timeout: 30000,
        verbose: true,
        proxy: '',
        ignoreProxyEnv: true,
      }
    );
    const argv = JSON.parse(fs.readFileSync(argvFile, 'utf8'));
    assert.strictEqual(path.basename(filePath), 'CON_bad_.apk');
    assert.ok(argv.includes('-x'));
    assert.strictEqual(argv[argv.indexOf('-x') + 1], '4');
    assert.ok(argv.includes('-s'));
    assert.strictEqual(argv[argv.indexOf('-s') + 1], '4');
    assert.strictEqual(fs.readFileSync(filePath).slice(0, 4).toString('hex'), '504b0304');
  } finally {
    console.error = oldConsoleError;
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    if (oldPathKey === undefined) delete process.env.Path;
    else process.env.Path = oldPathKey;
    delete process.env.YYB_ARGV_FILE;
    clearCommandCache();
    fs.rmSync(binDir, { recursive: true, force: true });
    fs.rmSync(downloadDir, { recursive: true, force: true });
  }
});

test('下载到非 APK 文件时关闭文件后再清理', () => {
  const downloadDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'yyb-download-bad-'));
  const filePath = path.join(downloadDir, 'bad.apk');
  fs.writeFileSync(filePath, '<!doctype html>');
  try {
    assert.throws(() => verifyDownloadedApkFile(filePath), /已自动清理/);
    assert.strictEqual(fs.existsSync(filePath), false);
  } finally {
    fs.rmSync(downloadDir, { recursive: true, force: true });
  }
});

section('\n=== 代理校验 ===');
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
test('splitProxyAuth 解码 URL 编码的代理凭据', () => {
  const result = splitProxyAuth('http://u%40ser:p%40ss%3Aword@127.0.0.1:7890');
  assert.strictEqual(result.url, 'http://127.0.0.1:7890/');
  assert.strictEqual(result.username, 'u@ser');
  assert.strictEqual(result.password, 'p@ss:word');
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
test('默认子进程环境变量按大小写不敏感处理代理变量', () => {
  const oldMixedProxy = process.env.Http_Proxy;
  process.env.Http_Proxy = 'http://user:secret@127.0.0.1:7890';
  try {
    const env = createChildEnv({ proxy: '', ignoreProxyEnv: false });
    assert.strictEqual(env.Http_Proxy, 'http://127.0.0.1:7890/');
    assert.ok(!env.Http_Proxy.includes('secret'));
  } finally {
    if (oldMixedProxy === undefined) delete process.env.Http_Proxy;
    else process.env.Http_Proxy = oldMixedProxy;
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
test('带 stdin 的非 verbose 下载命令保留错误输出并限制缓冲', () => {
  const options = buildSpawnOptions({
    env: {},
    stdio: 'pipe',
    input: 'proxy = "http://user:secret@127.0.0.1:7890/"\n',
  });
  assert.deepStrictEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.ok(options.maxBuffer <= 4 * 1024 * 1024);
});
test('非 verbose 下载命令保留错误输出并限制缓冲', () => {
  const options = buildSpawnOptions({
    env: {},
    stdio: 'pipe',
    input: '',
  });
  assert.strictEqual(options.stdio, 'pipe');
  assert.ok(options.maxBuffer <= 4 * 1024 * 1024);
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
test('按平台过滤临时文件清理信号', () => {
  assert.deepStrictEqual(
    getSupportedSignals(['SIGHUP', 'SIGINT', 'SIGTERM', 'SIGBREAK'], 'win32'),
    ['SIGINT', 'SIGTERM', 'SIGBREAK']
  );
  assert.deepStrictEqual(
    getSupportedSignals(['SIGHUP', 'SIGINT', 'SIGTERM', 'SIGBREAK'], 'darwin'),
    ['SIGHUP', 'SIGINT', 'SIGTERM']
  );
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

section('\n=== readline 封装 ===');
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
test('createReadline 支持单次 ask 禁用超时', async () => {
  const { PassThrough } = require('stream');
  const oldStdin = process.stdin;
  const oldStdout = process.stdout;
  const input = new PassThrough();
  const output = new PassThrough();
  Object.defineProperty(process, 'stdin', { value: input, configurable: true });
  Object.defineProperty(process, 'stdout', { value: output, configurable: true });
  try {
    const { ask, rl } = createReadline({ inputTimeoutMs: 1 });
    const pending = ask('yyb> ', { timeoutMs: 0 });
    setTimeout(() => input.write('exit\n'), 20);
    assert.strictEqual(await pending, 'exit');
    rl.close();
  } finally {
    Object.defineProperty(process, 'stdin', { value: oldStdin, configurable: true });
    Object.defineProperty(process, 'stdout', { value: oldStdout, configurable: true });
  }
});

runTests().then(() => {
  console.log('\n测试完成。');
});
