# yyb-apk-extractor

> 从腾讯应用宝官网提取安卓 APK 直链的纯命令行工具
>
> 无需浏览器，零第三方依赖，支持代理，自动下载

[![Node.js >= 16.0.0](https://img.shields.io/badge/Node.js-%3E%3D16.0.0-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)]()

---

## 特性

- 纯 Node.js 实现，零 npm 依赖
- 无需浏览器，通过应用宝移动端接口解析 APK 直链
- 支持 Android 包名或应用宝详情页 URL
- 支持 `http://`、`https://`、`socks5://`、`socks5h://`
- 自动下载 APK，优先使用 `curl`
- 支持断点续传
- 下载阶段只做连接与断流检测，不限制总下载时长
- 输入校验、SSRF 重定向限制、代理格式校验、ZIP 魔数校验
- 输出 JSON，便于脚本化集成

---

## 环境要求

| 项目 | 要求 |
|---|---|
| Node.js | `>= 16.0.0` |
| 下载工具（可选） | `aria2c` / `curl` / `wget` 任意一个 |

---

## 安装

```bash
# 克隆仓库
git clone https://github.com/MisonL/yyb-apk-extractor.git
cd yyb-apk-extractor

# （可选）安装全局命令
npm link
```

> 不执行 `npm link` 也可以直接用 `node index.js` 运行。
>
> 设置环境变量 `NO_COLOR=1` 或传入 `--no-color` 可禁用 CLI 颜色输出。

---

## 使用方法

```bash
node index.js <包名或应用宝详情页URL> [选项]
```

### 选项说明

| 选项 | 说明 |
|---|---|
| `--proxy=地址` | 设置代理，推荐 `http://` 或 `socks5h://` |
| `--no-proxy` | 忽略环境变量中的代理设置 |
| `--download-dir=目录` | 提取链接后自动下载 APK 到指定目录 |
| `--timeout=毫秒` | 网络超时时间，默认 `30000`，必须为正整数毫秒。fetch 阶段为请求总时长；下载阶段为连接/断流检测时长 |
| `--verbose`, `-v` | 显示详细调试日志 |
| `--version`, `-V` | 显示版本号 |
| `--no-color` | 强制禁用 ANSI 颜色输出 |
| `--help`, `-h` | 显示帮助信息 |

### 环境变量

支持通过以下环境变量设置默认代理（按优先级排序）：

```bash
HTTPS_PROXY / https_proxy / HTTP_PROXY / http_proxy / ALL_PROXY / all_proxy
```

---

## 示例

### 1. 提取下载链接

```bash
node index.js com.example.app
```

输出示例：

```json
{
  "pkgName": "com.example.app",
  "detailUrl": "https://sj.qq.com/appdetail/com.example.app",
  "apkUrl": "http://imtt.dd.qq.com/.../apk/xxx.apk?fsname=com.example.app_1.0.0.apk",
  "allUrls": [
    "http://imtt.dd.qq.com/...",
    "https://microdown.myapp.com/..."
  ]
}
```

### 2. 使用 URL 作为输入

```bash
node index.js https://sj.qq.com/appdetail/com.example.app
node index.js 'https://a.app.qq.com/o/simple.jsp?pkgname=com.example.app'
```

### 3. 自动下载 APK

```bash
node index.js com.example.app --download-dir=./downloads
```

### 4. 使用代理

```bash
# HTTP 代理
node index.js com.example.app --proxy=http://127.0.0.1:7890

# SOCKS5h 代理
node index.js com.example.app --proxy=socks5h://127.0.0.1:7890
```

> 提示：尽量避免使用 `socks5://`（本地解析 DNS，易在受限网络中失败）。

---

## 代理说明

| 阶段 | 使用工具 | 说明 |
|---|---|---|
| 页面提取 | `curl` | 对各类代理协议支持最完整 |
| 文件下载 | `curl` -> `aria2c` -> `wget` | 下载阶段优先使用 curl，避免外部工具自动跟随未校验重定向 |

---

## 大文件与慢速下载

默认 `--timeout=30000`（30 秒）：

- fetch 阶段：请求总时长限制为 30 秒
- 下载阶段：仅作为连接建立和断流检测时间，不限制大文件总下载时间
  - `curl`：`--connect-timeout` + `--speed-time` + `--speed-limit 1024` + `-C -`，并在下载前做重定向预检
  - `aria2c`：仅在 `curl` 不可用时作为后备
  - `wget`：仅在 `curl` 和 `aria2c` 都不可用时作为后备

因此下载大体积或慢速 APK 不会因为总时长而被强制中断，网络波动时也能从中断处继续。

---

## 安全设计

- 所有外部命令均通过 `spawnSync` 参数数组调用，无 shell 拼接
- 输入校验：包名白名单、URL 域名校验、非法代理拒绝、未知选项报错、多余参数拦截
- SSRF 防护：页面提取和下载预检都限制目标域名为 `*.qq.com`
- 路径安全：下载文件名经过 `path.posix.basename` 处理并移除控制字符，防止路径遍历
- 代理安全：代理 URL 校验协议、主机、端口；verbose 日志和错误信息中自动隐藏凭据；支持 `--no-proxy` 临时忽略环境代理
- 下载完整性：下载前做 APK 直链重定向预检，下载完成后校验文件存在、非空且 ZIP/APK 头部魔数正确
- 全局兜底：`unhandledRejection` / `uncaughtException` 统一捕获并友好退出

---

## 工作原理

1. 解析输入并提取 Android 包名
2. 请求应用宝移动端页面 `https://a.app.qq.com/o/simple.jsp?pkgname=...`
3. 从 HTML 中匹配所有 `.apk` 链接，优先返回 `imtt` 官方 CDN 链接
4. 若指定 `--download-dir`，则按 `curl` -> `aria2c` -> `wget` 优先级选择工具下载 APK，并校验文件存在、非空且头部魔数符合 ZIP/APK 标准

---

## License

[ISC](./LICENSE)
