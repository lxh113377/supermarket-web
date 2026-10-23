// 打印服务三处同值的静态契约（2026-10-07 新增）。
//
// 打印是站内唯一"顾客可以把任意文件交给后台"的入口，三处数字各写各的代价是
// **顾客按屏上提示操作却被服务端拒**（本仓第十八轮评价图那条老伤的同形）：
//   · 张数上限：前端 print.config / 服务端 shared.js
//   · 单文件体积：前端 print.config / 服务端 shared.js
//   · 扩展名白名单：前端 print.config / 服务端 upload.js
// 两条构建链物理上共享不了模块，只能靠这条判据钉住。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { MAX_PRINT_FILES, PRINT_ALLOWED_EXT, PRINT_INLINE_ALLOWED_EXT } from '../src/pages/print/print.config'
import { validateSubmissionFiles } from '../functions/lib/security.js'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

/** 从 JS 字面量数组里取出字符串元素（只认引号包裹的，避免把注释里的词带进来）。 */
function stringArray(src: string, anchor: string): string[] {
  const start = src.indexOf(anchor)
  expect(start, `没找到 ${anchor} ⇒ 契约已随改名失效，必须修契约而不是放宽`).toBeGreaterThan(-1)
  const seg = src.slice(start, start + 1200)
  const open = seg.indexOf('[')
  const close = seg.indexOf(']', open)
  return [...seg.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1])
}

describe('张数上限两端同值', () => {
  const srv = Number(/export const MAX_SUBMISSION_FILES = (\d+)/.exec(read('functions/lib/shared.js'))![1])
  it('前端 MAX_PRINT_FILES == 服务端 MAX_SUBMISSION_FILES', () => {
    expect(MAX_PRINT_FILES).toBe(srv)
  })
})

describe('单文件体积两端同值', () => {
  // 必须锚在常量名上：两处文件里都有别的 `* 1024 * 1024`
  // （shared.js 的注释里就写着历史值 `2 * 1024 * 1024`），裸匹配会抓到注释里的数。
  const mb = (src: string, name: string) => {
    const m = new RegExp(`const ${name} = (\\d+) \\* 1024 \\* 1024`).exec(src)
    expect(m, `没解析到 ${name} 的 MB 数 ⇒ 契约失效`).toBeTruthy()
    return Number(m![1])
  }
  it('前端 PRINT_FILE_MAX_BYTES == 服务端 PRINT_FILE_MAX_BYTES', () => {
    const srvMb = mb(read('functions/lib/shared.js'), 'PRINT_FILE_MAX_BYTES')
    const cliMb = mb(read('src/pages/print/print.config.ts'), 'PRINT_FILE_MAX_BYTES')
    expect(cliMb).toBe(srvMb)
    expect(srvMb).toBe(20)
  })
})

describe('扩展名白名单两端逐项同值', () => {
  const srvExt = stringArray(read('functions/upload.js'), 'const ALLOWED_EXT')
  it('前端与服务端集合完全相等（顺序无关，但一项都不能差）', () => {
    expect([...PRINT_ALLOWED_EXT].sort()).toEqual([...srvExt].sort())
  })
  it('负面：白名单不许含可执行/归档类扩展名', () => {
    for (const bad of ['exe', 'sh', 'bat', 'zip', 'rar', 'html', 'svg']) {
      expect(srvExt, `.${bad} 不该在打印白名单里`).not.toContain(bad)
    }
  })
  it('正面：需求点名的文档类型都在册（pdf/docx/pptx）', () => {
    for (const need of ['pdf', 'docx', 'pptx', 'doc', 'ppt']) {
      expect(srvExt, `.${need} 必须在册`).toContain(need)
    }
  })
  it('内联窄名单必须是宽名单的子集（R2 开通后同一批文件仍要能直传）', () => {
    for (const ext of PRINT_INLINE_ALLOWED_EXT) {
      expect(srvExt, `.${ext} 在窄名单里却不在服务端 /upload 的宽名单里 ⇒ R2 一开通这类文件反而传不上`).toContain(ext)
    }
  })
})

// 表单实际用的准入是**窄名单**（内联那条路），而它的真伪不由我们说了算：
// 服务端 `isSafePrintFileRef` 只认 image/(jpeg|png|webp|gif)、application/pdf、
// application/msword 与 officedocument.*。所以这一条**不读那份正则、直接调那个真函数**，
// 拿浏览器会给该扩展名挂的 MIME 逐个喂进去 —— 宽名单里的 ppt/xls/heic/txt 在内联形态
// 下会被服务端拒（实测），把它们放进窄名单就是让顾客按屏上提示选了再被拒。
describe('内联窄名单 ⇄ 服务端真准入函数（2026-10-23）', () => {
  const MIME: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    xls: 'application/vnd.ms-excel',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    heic: 'image/heic', txt: 'text/plain',
  }
  const accepts = (ext: string) =>
    validateSubmissionFiles([`data:${MIME[ext]};base64,aGVsbG8=`]) !== null
  it('窄名单里每一项服务端都真收（不是我们以为它收）', () => {
    for (const ext of PRINT_INLINE_ALLOWED_EXT) {
      expect(MIME[ext], `测试自己缺 ${ext} 的 MIME 映射 ⇒ 这条会假绿`).toBeTruthy()
      expect(accepts(ext), `.${ext} 在窄名单里，但服务端 isSafePrintFileRef 不收这种 data: URL`).toBe(true)
    }
  })
  it('宽名单里被排除的那几项确实服务端不收（钉住"为什么窄"）', () => {
    for (const ext of ['ppt', 'xls', 'heic', 'txt']) {
      expect(PRINT_INLINE_ALLOWED_EXT as readonly string[], `.${ext} 现在服务端收了 ⇒ 该放回窄名单，顾客不必再转格式`).not.toContain(ext)
      expect(accepts(ext), `.${ext} 其实服务端能收 ⇒ 窄名单把它踢错了`).toBe(false)
    }
  })
})
