---
kind: build_system
name: 基于 npm scripts 的轻量 Node.js CLI 构建与发布流程
category: build_system
scope:
    - '**'
source_files:
    - yyb-apk-extractor/package.json
    - yyb-apk-extractor/index.js
    - yyb-apk-extractor/test/index.test.js
    - yyb-apk-extractor/.gitignore
---

## 1. 使用的系统/方法

仓库整体是一个杂项工件集合，仅 `yyb-apk-extractor/` 子目录包含可构建的 Node.js CLI 工具。该工具采用最轻量的构建方式：
- **包管理**：npm（CommonJS，`package.json` 中声明 `"type": "commonjs"`）。
- **构建产物**：无编译步骤，直接以单文件 `index.js` 作为入口并通过 `bin` 字段暴露命令行入口 `yyb-apk-extractor`。
- **依赖**：零运行时依赖（`dependencies: {}`），通过 `node --check` 做语法检查。
- **测试**：使用原生 Node.js 运行 `test/index.test.js`，未引入任何测试框架。
- **CI**：README 中标注了 GitHub Actions badge（指向 `workflows/ci.yml`），但当前仓库快照中未包含 `.github/workflows/` 目录，因此 CI 配置不在本仓库内维护。

## 2. 关键文件

- `yyb-apk-extractor/package.json`：定义版本、`bin` 入口、`scripts`、`engines.node >= 16.3.0`、`files` 发布清单。
- `yyb-apk-extractor/index.js`：CLI 主程序（被 `bin` 直接引用）。
- `yyb-apk-extractor/test/index.test.js`：最小化测试用例。
- `yyb-apk-extractor/.gitignore`：忽略构建/临时产物。
- 根目录其他文件（`.firecrawl/` 数据快照、`qdm_tls12_enable.reg`、`create_oa_guide_doc.py`、APK 安装包等）均为一次性数据或脚本工件，不参与构建流水线。

## 3. 架构与约定

- **单文件 CLI**：整个工具由一个 JS 文件构成，通过 `package.json` 的 `bin` 字段映射到全局命令名，无需打包器。
- **脚本即构建**：所有“构建”动作集中在 `npm run <script>`：
  - `npm test`：先用 `node --check index.js` 校验语法，再执行 `test/index.test.js`。
  - `npm run check`：串联 `npm test && npm run pack:dry-run`，用于本地质量门禁。
  - `npm run pack:dry-run`：`npm pack --dry-run`，验证发布包内容。
  - `npm start`：直接运行 `node index.js`。
- **发布范围控制**：`files` 字段显式声明发布到 npm 的条目（`index.js`、`test`、`README.md`、`LICENSE`），避免把无关文件打入包。
- **引擎约束**：`engines.node >= 16.3.0` 强制最低 Node 版本。
- **无跨平台编译**：工具为纯 Node.js，不涉及多目标交叉编译；Windows 侧通过根目录的 `.reg` 注册表文件（`qdm_tls12_enable.reg`、`qdm_tls12_restore.reg`）单独启用 TLS 1.2，属于环境配置而非构建产物。

## 4. 约定与约束

- **无 Makefile / Dockerfile / Gradle / Maven / Cargo / Go module**：仓库不存在这些构建系统文件。
- **无 TypeScript / 前端打包器**：未发现 `tsconfig.json`、`webpack.config.*`、`vite.config.*`、`rollup.config.*` 等配置文件。
- **无 CI 工作流文件**：虽然 README 引用了 GitHub Actions badge，但 `.github/workflows/ci.yml` 未随仓库提交，无法在本仓库内验证其具体步骤。
- **测试必须通过 `npm test` 才能进入 `check` 流程**：`check` 脚本串行执行 `npm test` 和 `pack:dry-run`，形成本地发布的简单门禁。
- **发布前需手动执行 `npm pack --dry-run`**：通过 `pack:dry-run` 脚本验证最终包内容，确保 `files` 白名单正确。
- **Node 版本锁定**：`engines` 字段要求 Node ≥ 16.3.0，这是唯一的环境约束。
- **数据/文档类工件不纳入构建**：`.firecrawl/` 下的 JSON/MD 快照、根目录的 JSON 看板数据、`.docx`、`.apk` 等均为独立产出物，不被任何脚本引用或打包。

综上，该仓库的“构建系统”实质上是 npm 内置脚本 + 单文件 CLI 的最小化实践，没有引入外部构建工具链，适合小型工具的快速迭代与发布。