// 上限两侧同值的静态契约（第三十六轮；样板 = tests/reviewImageCapContract.test.ts 与 batchChunkContract.test.ts）。
//
// 为什么值得单独一条判据：第十八轮那次同类缺陷（服务端 3 张、前端与文案都写 5 张）是**按屏上指示操作必然失败**
// 的形态。R35 把服务端条数补齐后普查过一遍：真条数上限共 3 个语义（评价 3 / 服务申请 5 / 图册 9），
// 其中**只有评价 1 个**有等值夹具 ⇒ 另两个仍是"两侧各自写着一个数字，谁改了另一个不知道"。
//
// 两条构建链不能共享模块（云函数是 CommonJS 独立打包），所以常量天然是双写；
// 本契约钉的是"双写必须同值 + 屏上文案必须由同一个常量渲染"，而不是把值抽成共享文件。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

// 解析不到就必须判红：静默返回 NaN 的契约等于没有契约（第 ㉙ 形态：反例没进被审谓词）
const num = (re: RegExp, src: string, what: string) => {
  const m = re.exec(src)
  expect(m, `没解析到 ${what} ⇒ 本契约已随改名/换写法失效，必须修契约而不是放宽`).toBeTruthy()
  return Number(m![1])
}

describe('服务申请表配图张数两侧契约（≤5）', () => {
  const srvFile = read('functions/lib/actions/submissions.js')
  const cliFile = read('src/pages/ServiceFormPage.tsx')
  const srv = num(/clean\.images\.length > (\d+)/, srvFile, '服务端 createSubmission 条数 cap')
  const cli = num(/images\.length \+ valid\.length > (\d+)/, cliFile, '前端 ServiceFormPage 张数上限')

  it('前端 == 服务端（R35 补服务端 cap 时定的同值，此处防下一轮单边改）', () => {
    expect(cli).toBe(srv)
    expect(srv).toBe(5)
  })
  it('两侧值都在登记册在册（C2 只保证"有行"，不保证"两侧同值"）', () => {
    const reg = read('docs/limit-provenance.md')
    expect(reg).toContain('functions/lib/actions/submissions.js | 拒绝型 | 5')
    expect(reg).toContain('src/pages/ServiceFormPage.tsx | 拒绝型 | 5')
  })
})

describe('商品图册张数两侧契约（≤9，形态不同但值必须同）', () => {
  const srvFile = read('functions/lib/actions/products.js')
  const cliFile = read('src/components/admin/ProductInlineEditForm.tsx')
  const srv = num(/data\.images\.length > (\d+)/, srvFile, '服务端 createProduct/updateProduct 条数 cap')
  // 真实写法是链式换行（`…\n  .slice(0, 9)`），所以锚点不能带 `images.` 前缀——
  // 第一版带了就"没解析到"，这条契约的防空转腿当场把它自己抓红了一次。
  const cli = num(/\.slice\(\s*0, (\d+)\)/, cliFile, '前端内联编辑的图册截断上限')

  it('服务端与前端同值（前端是"砍掉"、服务端是"拒绝" ⇒ 值不同就会出现"砍了仍被拒"）', () => {
    expect(cli).toBe(srv)
    expect(srv).toBe(9)
  })
  it('服务端两个出口都带 cap（只补 create 漏 update 会被同一族绕开，R35 的 C9 已钉，这里再钉值）', () => {
    const outlets = srvFile.match(/data\.images\.length > \d+/g) || []
    expect(outlets.length, `出口数=${outlets.length}，应为 2（createProduct + updateProduct）`).toBe(2)
    expect(new Set(outlets).size).toBe(1)
  })
})

describe('口味名长度两侧契约（≤20，前端常量 / 后端字面量）', () => {
  const srvFile = read('functions/lib/actions/products.js')
  const cliFile = read('src/components/admin/ProductInlineEditForm.tsx')
  // 这一对是本轮把「截断上限」形状纳面后才看得见的：前端 `.slice(0, FLAVOR_MAX_LEN)`、
  // 服务端 `.slice(0, 20)` —— 旧口径只认数字，前端那一侧结构上隐形，两侧不同值也不会红。
  const cli = num(/const FLAVOR_MAX_LEN = (\d+)/, cliFile, '前端 FLAVOR_MAX_LEN')
  const srv = num(/String\(item\.label[^\n]*?\.slice\(0, (\d+)\)/, srvFile, '服务端 sanitizeSpecOptions 的 label 截断')

  it('前端常量 == 服务端字面量（改了任一侧，另一侧不跟 ⇒ 输入被静默截断或被服务端悄悄截）', () => {
    expect(cli).toBe(srv)
    expect(srv).toBe(20)
  })
  it('输入框 maxLength 也走同一常量（屏上限制与代码限制不能是两个数）', () => {
    expect(cliFile).toMatch(/maxLength=\{FLAVOR_MAX_LEN\}/)
    expect(cliFile).not.toMatch(/maxLength=\{?20\}?/)
  })
})

describe('可选口味条数两侧契约（≤20，SPEC_OPTION_LIMIT 双写）', () => {
  const srvFile = read('functions/lib/actions/products.js')
  const cliFile = read('src/components/admin/ProductInlineEditForm.tsx')
  // 这条以前在普查面上**完全隐形**：右侧是常量名而非数字，且 SPEC_ 不匹配 CONST_RE ⇒ 双侧各写各的。
  const srv = num(/export const SPEC_OPTION_LIMIT = (\d+)/, srvFile, '服务端 SPEC_OPTION_LIMIT')
  const cli = num(/export const SPEC_OPTION_LIMIT = (\d+)/, cliFile, '前端 SPEC_OPTION_LIMIT')

  it('两侧常量同值（现值 20）', () => {
    expect(cli).toBe(srv)
    expect(srv).toBe(20)
  })
  it('两侧都真的在比较处引用常量，没有退回字面量', () => {
    expect(srvFile).toMatch(/out\.length >= SPEC_OPTION_LIMIT/)
    expect(cliFile).toMatch(/form\.specOptions\.length >= SPEC_OPTION_LIMIT/)
    expect(cliFile).not.toMatch(/specOptions\.length >= \d+/)
  })
})
