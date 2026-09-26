/**
 * 「PR 带没带回归手段」advisory 判据的夹具（第十轮 R10-M2）。
 * 本判据故意不阻断，所以它的价值全在"报得准"——正反两侧都在这里钉住。
 */
import { describe, it, expect } from 'vitest'
import { evaluatePrTests, isTestFile } from '../scripts/check-pr-has-tests.mjs'

describe('evaluatePrTests 三态', () => {
  it('改了 functions 且加了测试 ⇒ covered', () => {
    const v = evaluatePrTests(['functions/lib/notify.js', 'tests/orderNotify.test.js'])
    expect(v.verdict).toBe('covered')
    expect(v.code).toEqual(['functions/lib/notify.js'])
  })
  it('只改产品代码 ⇒ missing-tests（这就是要报的那类）', () => {
    expect(evaluatePrTests(['src/App.tsx']).verdict).toBe('missing-tests')
  })
  it('纯文档/配置 PR ⇒ no-code-change，不该被骚扰', () => {
    for (const f of [['README.md'], ['CHANGELOG.md'], ['docs/env-vars.md'],
      ['.github/workflows/ci.yml'], ['deliverables/报告.md']]) {
      expect(evaluatePrTests(f).verdict, f.join()).toBe('no-code-change')
    }
  })
  it('空变更集 ⇒ no-code-change（零输入不得记"已覆盖"）', () => {
    expect(evaluatePrTests([]).verdict).toBe('no-code-change')
  })
  it('只改 e2e 也算带回归手段', () => {
    expect(evaluatePrTests(['src/x.tsx', 'tests/e2e/cart.spec.ts']).verdict).toBe('covered')
  })
  it('反向钉：tests 目录外的 .test.ts 也算（防有人把测试扔到 src 里躲判据）', () => {
    expect(isTestFile('src/foo.test.ts')).toBe(true)
    expect(isTestFile('src/foo.ts')).toBe(false)
  })
  it('依赖目录不算产品代码（dependabot 六条不该天天被报）', () => {
    expect(evaluatePrTests(['package-lock.json', 'package.json']).verdict).toBe('no-code-change')
  })
})
