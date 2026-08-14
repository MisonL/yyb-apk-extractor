---
kind: configuration_system
name: 仓库级配置体系：Flclash YAML、Windows TLS 注册表与 CLI 环境变量/参数配置
category: configuration_system
scope:
    - '**'
source_files:
    - flclash-sub/tianlu.yaml
    - qdm_tls12_enable.reg
    - qdm_tls12_restore.reg
    - yyb-apk-extractor/package.json
    - yyb-apk-extractor/index.js
---

## 1. 使用的系统与方法

本仓库没有统一的运行时配置框架，而是按工件类型分别采用三种独立的配置方式：
- **Flclash（代理客户端）配置文件**：使用 `flclash-sub/tianlu.yaml` 作为 Flclash/Tun 的声明式 YAML 配置，定义监听端口、代理服务器、Proxy Group 和规则。
- **Windows TLS 策略配置**：通过根目录的 `.reg` 文件（`qdm_tls12_enable.reg`、`qdm_tls12_restore.reg`）写入 .NET Framework v4.0.30319 的 `SystemDefaultTlsVersions` 与 `SchUseStrongCrypto` 注册表项，强制启用 TLS 1.2 或恢复默认值。
- **CLI 工具配置**：`yyb-apk-extractor/index.js` 是一个纯 Node.js 命令行程序，配置来源包括命令行参数、环境变量和内部常量，没有外部配置文件。

## 2. 关键文件

- `flclash-sub/tianlu.yaml`：Flclash 代理配置，包含 `port`、`socks-port`、`external-controller`、`proxies`、`proxy-groups`、`rules`。
- `qdm_tls12_enable.reg` / `qdm_tls12_restore.reg`：成对的 Windows 注册表脚本，用于启用/恢复 TLS 1.2。
- `yyb-apk-extractor/package.json`：声明 CLI 入口 `bin: { "yyb-apk-extractor": "./index.js" }`、Node 引擎要求 `>=16.3.0`、脚本 `start/test/check`。
- `yyb-apk-extractor/index.js`：实现全部配置解析逻辑（见下文）。
- `create_oa_guide_doc.py`：硬编码输出路径、字体、字号等样式常量，属于“生成型脚本的配置”，不属于应用运行时配置。

## 3. 架构与设计约定

### 3.1 Flclash YAML 配置
- 单一配置文件集中管理本地 HTTP(S)/SOCKS 监听端口、上游 Shadowsocks 节点、`PROXY` 选择组以及 `MATCH,PROXY` 兜底规则。
- 所有网络相关行为由该 YAML 驱动，不依赖环境变量。

### 3.2 Windows TLS 注册表配置
- 提供“启用”和“恢复”两套 `.reg` 文件，形成可逆策略：启用时设置 `SystemDefaultTlsVersions=1`、`SchUseStrongCrypto=1`；恢复时删除这两个键。
- 同时写入 `HKLM\SOFTWARE\Microsoft\.NETFramework\v4.0.30319` 与 WOW6432Node 对应路径，覆盖 32/64 位 .NET 进程。

### 3.3 CLI 配置分层（yyb-apk-extractor）
配置来源按优先级从低到高为：**内部默认常量 → 环境变量 → 命令行参数**，具体约定如下：

| 配置项 | 默认值/约束 | 读取位置 | 说明 |
|---|---|---|---|
| 版本 | `package.json.version` | `index.js` 顶部 try/catch | 单一来源，避免硬编码 |
| 代理 | 空字符串 | `parseArgs` 中先读 `process.env`，再被 `--proxy=` 覆盖 | 支持 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` 及其小写形式 |
| 忽略环境变量代理 | `false` | `--no-proxy` | 显式关闭环境变量代理 |
| 超时 | `30000` ms | `--timeout=<毫秒|单位>` | 支持 `ms/s/m`，必须为正整数 |
| 下载目录 | `./downloads` | `--download-dir=<路径>` | 禁止 `..`、禁止根目录 |
| 下载器 | `auto` | `--downloader=auto|curl|aria2c|wget` | 仅允许白名单 |
| 多线程 | `false` | `--multi-thread` | 优先走 aria2c |
| 并发连接数 | `16` | `--connections=<1..16>` | 上限 `MAX_DOWNLOAD_CONNECTIONS` |
| 调试日志 | `false` | `--verbose/-v` | 控制 `[debug]` 前缀输出 |
| 颜色输出 | 自动检测 TTY + `NO_COLOR` | `--no-color` / `NO_COLOR` | 管道场景默认禁用 |
| 模式 | direct/search/interactive/doctor | 位置参数 + `--interactive` | 非 TTY 下禁止交互模式 |

### 3.4 安全相关配置约定
- 代理凭据在子进程环境中会被剥离用户名/密码，只传递无凭据 URL，避免泄露到 curl/aria2c/wget 进程。
- 所有来自网络的输出经过 `sanitizeTerminalOutput` 过滤 ANSI 转义序列与控制字符。
- 目标 URL 必须匹配腾讯域名白名单（`*.qq.com`、`*.myapp.com`、`*.qpic.cn`、`*.qlogo.cn` 及 `ALLOWED_SEARCH_HOSTNAMES`），拒绝任意主机名。

## 4. 约定与约束

- **Flclash**：所有代理行为由 `tianlu.yaml` 唯一决定，新增节点需加入 `proxies` 并在 `proxy-groups` 中引用。
- **TLS 策略**：启用与恢复是成对操作，生产环境应仅导入 `qdm_tls12_enable.reg`，需要回滚时使用 `qdm_tls12_restore.reg`。
- **CLI 配置优先级**：命令行参数始终覆盖环境变量，环境变量仅在未显式传入 `--proxy=` 且未设置 `--no-proxy` 时生效。
- **代理协议限制**：`--proxy` 仅接受 `http://`、`https://`、`socks5://`、`socks5h://`，且必须包含 host 与 port，不允许 path/query/hash。
- **下载器选择**：当使用 `socks5/socks5h` 代理时，aria2c 不可用；当代理含凭据时，wget 不可用；最终失败会抛出明确错误而非静默降级。
- **输入校验**：包名必须符合 Android 包名正则；URL 必须为 http/https 且 host 在白名单内；关键词长度 ≤ 100；总输入长度 ≤ 2048。
- **临时文件清理**：动态生成的代理配置文件写入 `os.tmpdir()` 下的私有目录（权限 `0o700`），并通过 `exit`/信号处理器保证退出时删除。
- **版本号**：CLI 版本从 `package.json` 读取，`package.json` 是唯一权威来源。

## 5. 结论

该仓库不存在跨模块的统一配置加载库，而是按工件形态分别采用 YAML 声明式配置、Windows 注册表策略和 CLI 参数+环境变量组合。配置职责清晰分离：Flclash 负责网络代理，`.reg` 负责系统 TLS 行为，`yyb-apk-extractor` 负责自身运行参数，三者互不耦合。