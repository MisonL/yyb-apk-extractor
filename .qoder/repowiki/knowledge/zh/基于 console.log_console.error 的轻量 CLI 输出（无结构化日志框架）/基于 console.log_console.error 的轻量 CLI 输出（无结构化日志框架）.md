---
kind: logging_system
name: 基于 console.log/console.error 的轻量 CLI 输出（无结构化日志框架）
category: logging_system
scope:
    - '**'
source_files:
    - yyb-apk-extractor/index.js
    - yyb-apk-extractor/test/index.test.js
---

## 1. 使用的系统/方法

本仓库是一个以 Node.js 编写的命令行工具集合，**没有引入任何第三方日志框架**（如 winston、pino、bunyan、log4js 等）。所有程序输出均通过 Node 内置的 `console.log` 与 `console.error` 直接写入 stdout/stderr。CLI 工具位于 `yyb-apk-extractor/index.js`，测试脚本位于 `yyb-apk-extractor/test/index.test.js`。

- **stdout**：用于正常结果输出，例如版本信息、JSON 结果（`console.log(JSON.stringify(...))`）、搜索摘要等。
- **stderr**：用于进度提示、调试信息、错误消息和交互反馈（如 `[debug]`、`[download]`、`[ok]`、`[error]` 前缀），并通过 chalk 彩色标记区分语义段。

## 2. 关键文件

- `yyb-apk-extractor/index.js`：唯一实现日志输出的主模块，集中使用 `console.log` / `console.error` 输出下载进度、搜索结果、确认提示、错误信息等。
- `yyb-apk-extractor/test/index.test.js`：通过断言 stderr/stdout 内容来验证 CLI 行为，间接约束了日志输出格式（例如要求 doctor 模式 stdout 为纯 JSON、非 TTY 时 stderr 包含特定提示文本）。

## 3. 架构与约定

- **无全局 logger 实例**：代码中不存在 `const log = createLogger()` 或 `import { logger }` 之类的初始化逻辑，每个调用点直接使用 `console.*`。
- **颜色控制**：通过 `createColors(shouldUseColor(...))` 生成带 ANSI 颜色的包装器，并在 `NO_COLOR` 环境变量存在或非 TTY 时自动禁用颜色，确保管道/CI 环境下输出可被解析。
- **结构化字段**：未采用 JSON 结构化日志；除 doctor 模式显式 `JSON.stringify` 输出环境诊断外，其余均为人类可读的格式化字符串。
- **日志级别**：没有正式的 level 枚举，但通过前缀约定区分用途：`[debug]`、`[download]`、`[ok]`、`[error]` 等作为视觉标签；真正的“错误”统一走 `console.error`。
- **敏感信息脱敏**：代理凭据通过 `maskUrl` 函数在错误消息中替换为 `***:***@host`，测试也断言了该行为。
- **子进程输出透传**：curl/wget/aria2c 等外部工具的 stdout/stderr 会原样转发到当前进程的 stderr（见 `if (stdout) console.error(stdout)`），不额外封装。

## 4. 约定与约束

- **无日志配置中心**：没有配置文件、环境变量开关来控制日志级别或输出目标，仅依赖 `--verbose` 参数影响部分工具（如 aria2c 的 `--console-log-level=warn`）的行为。
- **TTY 感知**：是否启用颜色由 `shouldUseColor` 根据 `process.stdin.isTTY`、`NO_COLOR` 环境变量及 `--no-color` 参数决定，测试覆盖了这些分支。
- **CI/管道友好**：doctor 模式的 stdout 必须是合法 JSON（测试断言 `JSON.parse(result.stdout)` 成功且 stderr 为空），这是强制约定的输出契约。
- **错误路径统一**：异常、校验失败、网络错误等一律通过 `console.error` 输出并配合 `process.exitCode = 1` 或抛出错误，不会混入 stdout。
- **无日志轮转/持久化**：所有输出直接打到终端，没有文件 sink、没有日志聚合、没有异步 flush 机制。

综上，该仓库的“日志系统”本质上是**基于原生 console 的轻量级 CLI 输出约定**，适合单进程命令行工具，不具备生产级应用所需的结构化、分级、可路由能力。