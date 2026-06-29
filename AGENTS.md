# 仓库贡献指南

## 项目结构与模块组织

本项目是零 npm 运行时依赖的 Node.js 命令行工具，用于从腾讯应用宝提取、搜索并下载 APK 链接。

- `index.js`：主 CLI 入口，包含参数解析、搜索、代理处理、下载器选择和交互模式。
- `test/index.test.js`：自定义 Node 测试运行器，包含单元测试和 CLI 集成测试。
- `.github/workflows/ci.yml`：GitHub Actions 跨平台 CI，覆盖 macOS、Linux、Windows 和多个 Node.js 版本。
- `README.md`：面向用户的安装、用法、安全、代理和开发说明。
- `package.json`：npm 脚本、包元数据和 CLI bin 映射。

不要提交生成的 APK、下载目录、日志、压缩包或本地工具输出。

## 构建、测试与本地开发命令

- `node index.js --help`：查看 CLI 用法。
- `node index.js doctor`：检查本机 Node 环境和下载工具。
- `node index.js search 微信`：对 `sj.qq.com` 发起真实搜索。
- `node index.js com.tencent.mm`：按包名提取 APK 元数据。
- `npm test`：执行 `node --check index.js` 和 `test/index.test.js`。
- `npm run check`：执行测试并运行 `npm pack --dry-run`，用于发布前验证。
- `npm link`：可选，将本地命令暴露为 `yyb-apk-extractor`。

## 代码风格与命名约定

使用 CommonJS 和 Node.js 内置 API。除非有明确项目级理由，不新增运行时依赖。函数保持小而聚焦，优先使用明确的辅助函数名称，例如 `validateProxy`、`sanitizeProcessOutput`、`parseResultIndex`。

使用 2 空格缩进、分号、默认 `const`，仅在需要重新赋值时使用 `let`。成功的非帮助命令必须保持标准输出 `stdout` 为机器可读 JSON；摘要、进度和调试信息写入标准错误 `stderr`。

## 测试指南

测试使用 Node 内置 `assert` 和 `test/index.test.js` 中的队列式运行器。新增测试应放在相关分组附近，命名使用清晰的中文描述。

安全相关改动必须覆盖测试，尤其是代理凭据脱敏、URL/域名校验、非 TTY 行为、下载器调用、标准输出/标准错误分离。自动化测试优先使用本地模拟工具，不做真实 APK 下载。

## 提交与拉取请求规范

提交信息沿用现有 Conventional Commit 风格：`fix: ...`、`docs: ...`、`test: ...`、`refactor: ...`、`security: ...`。

提交或发起 PR 前运行 `npm run check`，并确认 `git status --short` 干净。PR 说明应包含用户可见变化、安全影响、验证命令，以及 CLI 输出、代理、下载或交互模式是否发生行为变化。

## 安全与配置提示

不要记录代理密码，也不要把带凭据的代理 URL 透传到子进程环境变量。外部请求应继续限制在腾讯域名范围内。HTTPS 证书校验默认开启；`--insecure` 必须保持显式开启且仅用于测试环境。
