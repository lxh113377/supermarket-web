/**
 * 双端发布一致性判据的反例夹具（第十轮 R10-H2）。
 * 第九轮台账原话：`bundle 不同名`这条分支本机凑不出两端不同构建，因此永远未覆盖。
 * 本轮把判定拆成纯函数后，用真实观测值做正例、逐条造反例，本机零外网。
 * 夹具里的指纹/bundle 名取自 CI run 36233342757 的实际输出，不是编的样本。
 */
import { describe, it, expect } from 'vitest'
import { evaluateParity } from '../scripts/verify-release-parity.mjs'

const AFTER_TS = 1790415000 // epoch 秒（发布起点）
const SKEW = 6 * 3600 * 1000

const site = (label, over = {}) => ({
  label, base: `https://${label}`, swStatus: 200, htmlStatus: 200, swErr: '', htmlErr: '',
  fp: 'sm-v1790415402350', fpTs: 1790415402350, bundle: 'index-CwPZhV2W.js', ...over,
})
const pages = (over = {}) => site('pages.dev', over)
const customer = (over = {}) => site('github.io', { fp: 'sm-v1790415367009', fpTs: 1790415367009, ...over })
const judge = (a, b, extra = {}) =>
  evaluateParity({ a, b, afterTsSec: AFTER_TS, skewLimitMs: SKEW, pubCount: 28, ...extra })

describe('正例：两端同批同构建（照 CI 实测值）', () => {
  it('零问题', () => {
    expect(judge(pages(), customer()).problems).toEqual([])
  })
  it('重试阶梯阶段还没取 /pub —— 不该因此空转重试', () => {
    expect(judge(pages(), customer(), { pubCount: undefined }).problems).toEqual([])
  })
})

describe('反例：六条分支逐条必须判红', () => {
  it('① 两端 bundle 不同名 = 不同构建（第九轮未覆盖的那条）', () => {
    const r = judge(pages(), customer({ bundle: 'index-OLDxyz99.js' }))
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0]).toContain('bundle 不同名')
    expect(r.problems[0]).toContain('index-OLDxyz99.js')
  })
  it('② 顾客端首页解析不到 bundle，同样算不同构建而不是"没问题"', () => {
    expect(judge(pages(), customer({ bundle: null })).problems.join()).toContain('bundle 不同名')
  })
  it('③ 一端取不到 CACHE_VERSION（不可达/未生效）响亮报，不静默过', () => {
    const r = judge(pages(), customer({ fp: null, fpTs: 0, swStatus: 0, swErr: 'ENOTFOUND' }))
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0]).toContain('取不到 sw.js')
    expect(r.problems[0]).toContain('ENOTFOUND')
  })
  it('④ 一端指纹早于本次发布起点 = 这一端没被刷新', () => {
    const r = judge(pages(), customer({ fp: 'sm-v1790000000000', fpTs: 1790000000000 }))
    expect(r.problems.join()).toContain('没被本次发布刷新')
  })
  it('⑤ 两端都新但相差超批次上限 = 不同批次', () => {
    const r = judge(pages({ fp: 'sm-v1790440000000', fpTs: 1790440000000 }), customer())
    expect(r.skewMs).toBe(24632991)
    expect(r.problems.join()).toContain('不同批次发布')
  })
  it('⑥ 发布成功但公开目录为空不算一致', () => {
    expect(judge(pages(), customer(), { pubCount: 0 }).problems.join()).toContain('公开目录为空')
    expect(judge(pages(), customer(), { pubCount: -1 }).problems.join()).toContain('公开目录为空')
  })
})

describe('判据自身不恒绿（反向钉）', () => {
  it('喂两个空探测结果必须产生问题', () => {
    const r = evaluateParity({ a: { fp: null, fpTs: 0 }, b: { fp: null, fpTs: 0 }, afterTsSec: AFTER_TS, skewLimitMs: SKEW })
    expect(r.problems.length).toBeGreaterThan(0)
  })
  it('起点给得比两端都晚 ⇒ 必判"没被刷新"（防起点算错导致漏判）', () => {
    const r = judge(pages(), customer(), { afterTsSec: 1799999999 })
    expect(r.problems.filter((p) => p.includes('没被本次发布刷新'))).toHaveLength(2)
  })
  it('问题不重复记账：单条故障只出 1 条', () => {
    expect(judge(pages(), customer({ bundle: 'index-OTHER.js' })).problems).toHaveLength(1)
  })
})
