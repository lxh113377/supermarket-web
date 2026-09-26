/**
 * 环境变量登记册门禁的夹具（第十轮 R10-H3）。
 * 形状沿用第九轮 gateFixtures：判定核心是纯函数，所以正反两侧都能在本机常驻跑。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  collectCodeVars, parseRegistry, evaluateEnvRegistry, readSources, REGISTRY_REL,
} from '../scripts/check-env-docs.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const row = (name, over = {}) =>
  ({ name, line: 5, kind: 'secret', where: 'Pages secret', unset: 'no-op', purpose: 'x', ...over })

describe('collectCodeVars：只收服务端/构建期变量', () => {
  it('env.X 与 VITE_* 都收', () => {
    const set = collectCodeVars({
      'functions/web.js': 'const k = env.ADMIN_KEY; const d = env.DB',
      'src/api.ts': 'const b = import.meta.env.VITE_CB_API_BASE',
    })
    expect([...set].sort()).toEqual(['ADMIN_KEY', 'DB', 'VITE_CB_API_BASE'])
  })
  it('process.env.X 不算（那是 CI 进程环境，不是 Pages 变量）', () => {
    expect(collectCodeVars({ 'functions/x.js': 'process.env.HOME_DIR' })).toEqual(new Set())
  })
  it('小写 / 下划线开头 / 单字符都不收（避免把别的东西当成环境变量）', () => {
    expect(collectCodeVars({ 'functions/x.js': 'env.foo; env._X; env.X' }).size).toBe(0)
  })
})

describe('parseRegistry：表头与分隔行不能被误当条目', () => {
  const md = [
    '| 变量 | 种类 | 配置位置 | 未配置时行为 | 用途 |',
    '|---|---|---|---|---|',
    '| `ADMIN_KEY` | secret | Pages | fail-closed | 主密钥 |',
    '| `DB` | 绑定 | Functions | 响亮失败 | D1 |',
    '',
    '正文里出现的 |竖线| 不该被解析成行',
  ].join('\n')
  it('只解析出两行合法条目', () => {
    const rows = parseRegistry(md)
    expect(rows.map((r) => r.name)).toEqual(['ADMIN_KEY', 'DB'])
  })
  it('逐列落位（种类/位置/未配置行为）', () => {
    const [admin] = parseRegistry(md)
    expect(admin).toMatchObject({ kind: 'secret', where: 'Pages', unset: 'fail-closed' })
    expect(admin.line).toBeGreaterThan(0)
  })
  it('空表 ⇒ 零行（门禁主程序据此判红，不会恒绿）', () => {
    expect(parseRegistry('# 只有标题\n\n没有表格')).toEqual([])
  })
})

describe('evaluateEnvRegistry：六类缺口逐条判红', () => {
  const code = new Set(['ADMIN_KEY', 'DB'])
  it('两行齐全且都写明未配置行为 ⇒ 通过', () => {
    expect(evaluateEnvRegistry(code, [row('ADMIN_KEY'), row('DB', { kind: '绑定' })])).toEqual([])
  })
  it('代码引用但未登记', () => {
    const p = evaluateEnvRegistry(code, [row('ADMIN_KEY')])
    expect(p).toHaveLength(1)
    expect(p[0]).toContain('DB')
    expect(p[0]).toContain('没有这一行')
  })
  it('登记了但代码不再引用 = 死文档', () => {
    const p = evaluateEnvRegistry(new Set(['ADMIN_KEY']), [row('ADMIN_KEY'), row('OLD_SECRET')])
    expect(p).toHaveLength(1)
    expect(p[0]).toContain('OLD_SECRET')
    expect(p[0]).toContain('死文档')
  })
  it('未配置时行为留空 → 判红（这条承诺是本门禁的存在理由）', () => {
    expect(evaluateEnvRegistry(code, [row('ADMIN_KEY', { unset: '' }), row('DB')])[0])
      .toContain('没写「未配置时行为」')
  })
  it('种类取值非法 → 判红并回显合法取值', () => {
    const p = evaluateEnvRegistry(code, [row('ADMIN_KEY', { kind: '密钥' }), row('DB')])
    expect(p[0]).toContain('种类')
    expect(p[0]).toContain('secret/plain/build/绑定')
  })
  it('配置位置留空 → 判红', () => {
    expect(evaluateEnvRegistry(code, [row('ADMIN_KEY', { where: '' }), row('DB')])[0])
      .toContain('没写配置位置')
  })
  it('同名重复登记 → 判红（防两个真相源）', () => {
    expect(evaluateEnvRegistry(code, [row('ADMIN_KEY'), row('ADMIN_KEY'), row('DB')])[0])
      .toContain('重复登记')
  })
  it('登记册为空且代码有引用 ⇒ 每个变量各一条（不静默过）', () => {
    expect(evaluateEnvRegistry(code, [])).toHaveLength(2)
  })
})

describe('真实仓对账（当场读盘，不用快照）', () => {
  it('functions+src 的变量集与 docs/env-vars.md 完全一致', () => {
    const { sources } = readSources()
    const rows = parseRegistry(readFileSync(join(ROOT, REGISTRY_REL), 'utf8'))
    expect(evaluateEnvRegistry(collectCodeVars(sources), rows)).toEqual([])
    expect(rows.length).toBeGreaterThanOrEqual(10)
  })
})
