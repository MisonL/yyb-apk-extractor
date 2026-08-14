---
kind: error_handling
name: CLI 工具错误处理：统一抛出、重试与全局兜底
category: error_handling
scope:
    - '**'
source_files:
    - yyb-apk-extractor/index.js
    - yyb-apk-extractor/test/index.test.js
---

## 1. 采用的体系/方法

仓库中真正有代码的模块是 `yyb-apk-extractor/index.js`（Node.js CLI），以及一个 Python 脚本 `create_oa_guide_doc.py`。Python 脚本仅做文档生成，没有显式异常处理逻辑；因此本仓库的错误处理实践完全集中在 Node.js CLI 中。

该 CLI 采用**“函数内快速失败 + 统一 `throw new Error(...)` + 顶层 `unhandledRejection/uncaughtException` 兜底”**的模式，没有自定义 error 类、错误码枚举或中间件层。

## 2. 关键文件与位置

- `yyb-apk-extractor/index.js`：全部错误处理逻辑所在（约 2300 行）
- `yyb-apk-extractor/test/index.test.js`：通过 `assert.throws` 断言各校验函数的错误行为，构成错误路径的契约测试
- `create_oa_guide_doc.py`：无显式错误处理（依赖 `python-docx` 抛错）

## 3. 架构与约定

### 3.1 参数与输入校验：集中抛错
所有入口参数在进入业务逻辑前被严格校验，失败时直接 `throw new Error(人类可读中文消息)`：
- 命令行选项：`parseArgs` 遇到未知选项、多余参数、`--interactive` 在非 TTY 下使用等，抛出如 `未知选项: --xxx`、`非 TTY 终端无法进入交互模式` 等错误（第 267–338 行）
- 超时解析：`parseTimeoutMs` 拒绝非正整数、溢出值（第 340–360 行）
- 下载器选择：`parseDownloader` 只允许 `auto/curl/aria2c/wget`（第 362–368 行）
- 连接数：`parseConnections` 限制 1–16（第 370–380 行）
- 下载目录：`validateDownloadDir` 拒绝空值、路径遍历 `..`、根目录（第 386–399 行）
- 包名/URL：`isValidPkgName`、`normalizeUrl`、`assertAllowedHttpUrl`、`assertAllowedDownloadHttpUrl`、`assertAllowedDownloadRedirectTarget` 共同实现白名单 URL 校验，拒绝非腾讯域名及非 http/https 协议（第 401–450、742–754、1075–1110 行）
- 搜索关键词：`validateSearchKeyword` 用正则限制 CJK、数字、空格和有限标点，拒绝 shell 注入字符（第 1301–1311 行）

### 3.2 网络请求错误：HTTP 状态 → Error
- `fetchHtmlWithNode`：对 3xx 重定向递归调用并限制最多 5 次；非 2xx 返回 `reject(new Error('HTTP ' + statusCode))`；响应体超过 10MB 主动 `req.destroy()` 并 reject（第 1112–1178 行）
- `fetchHtmlWithCurl`：通过 `spawnSync` 执行 curl，`result.status !== 0` 时拼接 stderr（经 `sanitizeProcessOutput` 脱敏代理凭据）后 throw（第 1205–1280 行）
- APK 下载重定向预检 `resolveDownloadRedirects`：同样限制 5 次重定向，405/501 降级为原始 URL，其他非 2xx 报 `APK 下载地址预检失败: HTTP ...`（第 1440–1518 行）

### 3.3 重试策略
两个通用重试封装用于网络不稳定场景：
- `retrySync(fn, retries = 3)`：同步版本，立即重试（第 833–844 行）
- `retryAsync(fn, retries = 3, delayMs = 1000)`：异步版本，带指数退避前的固定间隔 sleep（第 846–859 行）
在 `extractApkDownloadUrl`、`searchApps`、`fetchAppInfo` 中优先尝试 curl，失败且未配置代理时回退到 Node 内置 https，再失败则抛错（第 1520–1576、1578–1606、1608–1632 行）。下载阶段也用了 `retryAsync(..., 2, 3000)` 重试一次（第 2199–2204 行）。

### 3.4 子进程/外部工具错误
- `runToolWithInput`：`spawnSync` 的 `result.error` 直接 throw；`result.status !== 0` 时拼接 stderr（经 `sanitizeProcessOutput` 脱敏）并 throw（第 1672–1705 行）
- Windows `.cmd/.bat` 参数注入防护：`assertSafeWindowsCommandScriptArgs` 拒绝包含双引号或控制字符的参数（第 711–717 行）
- 代理凭据泄露防护：`splitProxyAuth` 剥离用户名密码；`maskUrl`、`maskProxySecrets`、`sanitizeProcessOutput` 在所有日志输出中把 `user:pass@host` 替换为 `***:***@host`（第 523–582、756–782 行）

### 3.5 资源清理错误
临时配置文件通过 `writeTempConfigFile` 创建，注册到 `tempCleanupTasks`，并在 `SIGHUP/SIGINT/SIGTERM/SIGBREAK/process.exit` 信号中清理；清理本身 catch 忽略错误，避免二次异常（第 597–651 行）。

### 3.6 顶层兜底
- `registerGlobalErrorHandlers`：注册 `unhandledRejection` 和 `uncaughtException`，打印 `[error] 未捕获的...` 后 `process.exit(1)`（第 2210–2219 行）
- `main().catch(...)`：作为 `require.main === module` 时的最终入口，任何未被内部 try/catch 捕获的 Promise 拒绝都会以相同格式输出并退出（第 2221–2229 行）
- 交互模式主循环：每个命令 handler 外层 try/catch，捕获后输出 `[error]` 并继续循环（第 2131–2158 行）

### 3.7 成功/失败输出分离
- 结构化结果（搜索结果、doctor、提取结果）始终通过 `console.log(JSON.stringify(...))` 输出到 stdout，便于管道消费
- 人类可读日志、进度、错误信息通过 `console.error` 输出到 stderr，支持 `--no-color` / `NO_COLOR` 禁用 ANSI 颜色（第 85–117 行）

## 4. 约定与约束

| 约定 | 证据来源 |
|---|---|
| 所有输入校验失败必须 `throw new Error(中文消息)`，禁止静默返回 null/undefined | `parseArgs`、`validateSearchKeyword`、`validateDownloadDir`、`validateProxy` 等函数均如此 |
| 所有外部 URL 必须经过 `assertAllowedHttpUrl` / `safeTencentUrl` / `assertAllowedDownloadRedirectTarget` 白名单校验，否则抛错 | 多处调用点（第 742–754、801–821、1075–1110 行） |
| 网络请求统一使用 `retrySync`/`retryAsync` 最多 3 次重试，并重定向上限 5 次 | `extractApkDownloadUrl`、`searchApps`、`fetchHtmlWithNode`、`fetchHtmlWithCurl`、`resolveDownloadRedirects` |
| 子进程 stderr 输出必须经 `sanitizeProcessOutput` 脱敏后再拼入错误消息 | `fetchHtmlWithCurl`、`downloadApk` 中的 `runToolWithInput` |
| 代理凭据不得出现在日志、stderr、stdout 中；必须用 `maskUrl`/`maskProxySecrets` 隐藏 | `splitProxyAuth`、`maskUrl`、`maskProxySecrets` 及测试用例（test/index.test.js 第 770–776 行） |
| 非 TTY 下禁止进入交互模式，必须提前抛错 | `parseArgs` 与 `runInteractive` 双重检查（第 299–315、2087–2089 行） |
| 所有未捕获的同步/异步异常由 `uncaughtException`/`unhandledRejection` 兜底，统一 exit code 1 | `registerGlobalErrorHandlers`（第 2210–2219 行） |
| 下载完成后必须验证 APK 魔数 `504b0304`，不合法则删除文件并抛错 | `verifyDownloadedApkFile`（第 1412–1438 行） |
| 测试通过 `assert.throws` 断言错误消息片段，作为错误行为的契约 | `test/index.test.js` 中大量 `assert.throws(..., /.../)` 断言 |

## 5. 不适用部分

- `create_oa_guide_doc.py` 是一个一次性文档生成脚本，没有任何 try/catch、错误类型定义或日志级别管理，其错误传播完全依赖 `python-docx` 库的原生异常，因此不属于本仓库的“错误处理系统”范畴。
- 根目录其余文件（JSON 数据快照、`.reg` 注册表、`.apk`、`.docx`）不包含可执行代码，不涉及错误处理。

综上，本仓库的错误处理是一套**轻量但严谨的 CLI 风格方案**：以细粒度输入校验 + 统一 `Error` 消息 + 重试 + 白名单 URL 校验 + 全局 unhandled 兜底为核心，并通过测试用例固化错误边界。