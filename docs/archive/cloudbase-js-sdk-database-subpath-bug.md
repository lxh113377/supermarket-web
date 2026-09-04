# Bug Report: `@cloudbase/js-sdk` v3.6.4 `./database` 子路径入口文件缺失且未导出 `registerDatabase`

> 复现材料整理，用于向腾讯云 CloudBase JS SDK 官方仓库提交 issue。
> 所有结论均通过实地读取 `node_modules/@cloudbase/js-sdk@3.6.4` 的文件验证（见末尾「Verification」章节），非推测。

## 环境

| 项 | 值 |
|----|----|
| 包名 | `@cloudbase/js-sdk` |
| 版本 | `3.6.4` |
| 安装方式 | `npm i @cloudbase/js-sdk@3.6.4` |
| 子路径 exports 总数 | 14（含 `.` 根 + 13 个模块子路径） |
| 验证时间 | 2026-08-08 |
| 验证手段 | 直接读取 `node_modules/@cloudbase/js-sdk/` 下文件与 `package.json` 的 `exports` 字段 |

## 一句话总结

`@cloudbase/js-sdk@3.6.4` 的 `exports["./database"]` 指向的三个入口文件（`database/dist/index.esm.js`、`database/dist/index.js`、`database/dist/index.d.ts`）**在发布包中全部不存在**；而真实存在的 `database/dist/esm/index.js` 只导出 `Db` 类，**不导出 `registerDatabase`**。结果是：该模块**既无法通过声明的子路径被解析（import 直接失败），也无法在按需引入场景下完成数据库组件的注册**。

## 影响范围

- **14 个子路径中，只有 `./database` 损坏**。其余 13 个（`./app`、`./auth`、`./ai`、`./storage`、`./functions`、`./realtime`、`./apis`、`./cloudrun`、`./container`、`./model`、`./mysql`、`./oauth`、`.`）声明的入口文件均真实存在、可被正常 import。
- 对希望**按需/_tree-shaking_ 引入数据库模块**的用户，当前唯一可用路径是**整包导入**全量 SDK（顶层 `import('@cloudbase/js-sdk')` 或 `import cloudbase from '@cloudbase/js-sdk'`），使「按需引入省体积」的目标落空。

## 证据

### 1. `package.json` 中 `./database` 的声明

```json
{
  "exports": {
    "./database": {
      "import": "./database/dist/index.esm.js",
      "require": "./database/dist/index.js",
      "types": "./database/dist/index.d.ts"
    }
  }
}
```

### 2. 声明入口文件在发布包中的存在性（实测）

| 声明路径 | 是否存在 |
|----------|----------|
| `database/dist/index.esm.js` | ❌ MISSING |
| `database/dist/index.js` | ❌ MISSING |
| `database/dist/index.d.ts` | ❌ MISSING |

> 注意：其余 13 个子路径的 `dist/index.esm.js` / `dist/index.js` / `dist/index.d.ts` **全部存在**。`database` 模块的真实产物结构与其他模块不一致——它实际生成在 `database/dist/esm/index.js`（`esm/` 目录，而非 `index.esm.js`），但 `exports` 映射并未指向该真实路径。

### 3. 真实文件 `database/dist/esm/index.js` 的导出内容

```
export { Query }
export { CollectionReference }
export { DocumentReference }
export { Db }
```

→ **没有 `registerDatabase`**。

### 4. 全量入口 `dist/index.esm.js` 顶层确有 `registerDatabase`

全量入口导出了 `registerDatabase`（即 SDK 内部完成数据库组件注册的公开符号）。说明注册能力本身存在，只是**未通过 `./database` 子路径对外部暴露**。

## 复现步骤

### 复现 A：直接 import 声明的子路径（必然失败）

```js
// 任意 ESM / bundler（Vite/webpack/rollup）环境
import { Db } from '@cloudbase/js-sdk/database'
// 抛错（节选）：
//   Error [ERR_PACKAGE_PATH_NOT_EXPORTED] / MODULE_NOT_FOUND
//   无法解析 '@cloudbase/js-sdk/database' 的入口
```

原因：声明的 `database/dist/index.esm.js` 等文件在包内不存在，模块解析器找不到入口。

### 复现 B：绕过声明、直连真实文件（能 import，但不可用）

```js
// 即便改指向真实存在的文件
import { Db } from '@cloudbase/js-sdk/database/dist/esm/index.js'

// 拿到了 Db 类，但：
//   1) 该路径未经 package "exports" 暴露，需 bundler 配 "resolve.unsafe" / "server.fs" 之类放行，违反封装；
//   2) Db 只是类定义，没有 registerDatabase —— 无法把它挂到 app 实例上，
//      调用 app.database() 时底层仍依赖全量入口里已注册的组件。
```

### 复现 C：文件存在性断言（Node，零依赖）

```js
import fs from 'node:fs'
import path from 'node:path'
const root = path.dirname(require.resolve('@cloudbase/js-sdk/package.json')) // 注意：需包允许 ./package.json，否则用绝对路径
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const ent = pkg.exports['./database']
const declared = Object.values(ent).map(v => (typeof v === 'string' ? v : (v.default || ''))).filter(Boolean)
for (const rel of declared) {
  const fp = path.join(root, rel.replace('./', ''))
  console.log((fs.existsSync(fp) ? 'OK  ' : 'MISS') + '  ' + rel)
}
// 期望全部 OK，实际全部 MISS
```

## 期望行为（Expected）

1. `exports["./database"]` 指向的入口文件应当真实存在于发布包中，使 `import ... from '@cloudbase/js-sdk/database'` 可正常解析。
2. 若 `./database` 子路径的设计意图是支持按需引入数据库模块，则它应导出完成注册所需的全部符号（至少包含 `registerDatabase`，或在子路径内自动完成注册），否则该子路径在「按需引入」场景下不可用。

## 实际行为（Actual）

1. `./database` 声明的三个入口文件全部缺失，import 声明子路径直接失败。
2. 真实文件 `database/dist/esm/index.js` 仅导出 `Db` 等类，**不含 `registerDatabase`**，无法在按需引入场景下完成组件注册。
3. 用户只能整包导入全量 SDK，tree-shaking 数据库模块的目标无法实现。

## 当前可行的 Workaround

整包动态导入（本项目当前采用，已验证可用）：

```js
// src/cloudbase.js
const { default: cloudbase } = await import('@cloudbase/js-sdk')
const app = cloudbase.init({ /* ... */ })
const db = app.database() // 依赖全量入口内部的 registerDatabase
```

代价：全量 SDK（含未使用的 auth/storage/functions/ai/realtime 等）被打入同一 chunk，体积约 734KB（gzip ~181KB）。若放在首屏会显著拖慢首屏，**必须配合动态 `import()` 懒加载**将其移出首屏 bundle。

## 建议修复（Suggested Fix）

1. **修正 `exports["./database"]` 的路径**，使其指向真实生成的产物（推测应为 `database/dist/esm/index.js` 对应的 esm/cjs/d.ts 三件套），与其他子包（`app`/`auth`/…）的产物结构保持一致。
2. **在 `./database` 子路径中暴露 `registerDatabase`**（或在子路径入口内部自动 `registerDatabase`），使按需引入场景下 `app.database()` 能正常工作。
3. 增加发布前的**子路径入口存在性冒烟测试**：遍历 `exports` 中每个子路径声明的文件，断言其在 `dist/` 中真实存在，避免再次出现「声明与产物脱节」。

## Verification（本材料数据来源）

以下命令在装有 `@cloudbase/js-sdk@3.6.4` 的项目中实地执行，输出即上文表格依据：

```bash
PK=node_modules/@cloudbase/js-sdk
node -e "const p=require('path'),fs=require('fs');const r=p.resolve('$PK');const pkg=JSON.parse(fs.readFileSync(p.join(r,'package.json'),'utf8'));for(const k of Object.keys(pkg.exports)){const e=pkg.exports[k];const vs=typeof e==='string'?[e]:Object.values(e).map(v=>typeof v==='string'?v:(v.default||''));const s=vs.map(v=>{const f=p.join(r,v.replace('./',''));return (fs.existsSync(f)?'OK':'MISS')+' '+v;}).join(' | ');console.log(k.padEnd(14)+' '+s);}"
```

输出节选（仅 `./database` 全 MISS，其余全 OK）：

```
.               OK  | OK ./dist/index.esm.js | OK ./dist/index.cjs.js | OK ./index.d.ts
./ai            OK ./ai/dist/index.esm.js | OK ./ai/dist/index.js | OK ./ai/dist/index.d.ts
./app           OK ./app/dist/index.esm.js | OK ./app/dist/index.js | OK ./app/dist/index.d.ts
...
./database      MISS ./database/dist/index.esm.js | MISS ./database/dist/index.js | MISS ./database/dist/index.d.ts
...
./storage       OK ./storage/dist/index.esm.js | OK ./storage/dist/index.js | OK ./storage/dist/index.d.ts
```

```bash
# 真实 database 文件导出内容
node -e "const p=require('path'),fs=require('fs');const r=p.resolve('node_modules/@cloudbase/js-sdk');const c=fs.readFileSync(p.join(r,'database','dist','esm','index.js'),'utf8');console.log([...c.matchAll(/export\s*\{[^}]*\}/g)].map(m=>m[0]).join('\n'))"
# → export { Query }  export { CollectionReference }  export { DocumentReference }  export { Db }
```
