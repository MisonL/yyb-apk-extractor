---
kind: dependency_management
name: Node.js CLI 工具依赖管理（零第三方依赖）
category: dependency_management
scope:
    - '**'
source_files:
    - yyb-apk-extractor/package.json
    - yyb-apk-extractor/package-lock.json
    - yyb-apk-extractor/index.js
---

## 1. 使用的系统/方法

仓库中唯一的代码工程位于 `yyb-apk-extractor/`，采用 **Node.js + npm** 作为包管理与发布载体。该工具是一个纯命令行脚本（CLI），通过 `package.json` 的 `bin` 字段将 `index.js` 暴露为全局命令 `yyb-apk-extractor`。

## 2. 关键文件

- `yyb-apk-extractor/package.json`：声明包元数据、`engines.node >= 16.3.0`、`type: commonjs`、`scripts`（test / check / pack:dry-run / start）。
- `yyb-apk-extractor/package-lock.json`：lockfileVersion 3，但当前无第三方依赖，仅锁定自身包条目。
- `yyb-apk-extractor/index.js`：使用 Node 内置模块（`https`、`http`、`fs`、`path`、`os`、`child_process`、`readline`），**未引入任何第三方 npm 包**。
- `yyb-apk-extractor/test/index.test.js`：测试入口，由 `npm test` 执行。

## 3. 架构与约定

- **零第三方依赖策略**：`dependencies` 为空对象，所有网络请求、文件操作、子进程调用均通过 Node 标准库完成。这使得安装只需 `npm install` 且不会拉取任何外部包，极大降低供应链风险。
- **版本约束**：通过 `engines.node >= 16.3.0` 声明最低运行环境；`package-lock.json` 中的 lockfileVersion 为 3，与较新 npm 兼容。
- **发布工件**：`files` 字段显式限定打包时包含的文件（`index.js`、`test`、`README.md`、`LICENSE`），避免把无关文件打入 npm 包。
- **脚本约定**：`check` 脚本串联 `npm test && npm run pack:dry-run`，用于在提交前验证可测试性与可打包性；`pack:dry-run` 用 `npm pack --dry-run` 预检包内容。
- **无 vendoring / 私有 registry**：仓库中不存在 `vendor/`、`node_modules/`、`.npmrc`、`pnpm-lock.yaml`、`go.mod`、`requirements.txt` 等其它语言或工具的依赖清单，也未配置私有源。

## 4. 约定与约束

- 新增依赖必须通过 `npm install <pkg>` 写入 `package.json` 的 `dependencies`，并由 `package-lock.json` 锁定版本——这是 npm 的标准行为，仓库内未见绕过此流程的做法。
- 由于当前无任何第三方依赖，仓库对依赖管理的实际约束非常宽松：没有统一的版本范围策略、没有安全扫描脚本、没有 `npm audit` 集成步骤（仅在 `check` 中做了 dry-run 打包检查）。
- 根目录其余文件（Firecrawl 数据快照、Windows `.reg` 注册表、`.apk`、Python 脚本 `create_oa_guide_doc.py`）均为独立工件，不纳入本项目的依赖管理体系。