// 打印表单的准入与校验（纯函数直测，含负面用例）。
//
// 这些边界不是"顺手写几条"：打印是唯一接受**文档**的入口，扩展名白名单一旦与服务端
// functions/upload.js 的 ALLOWED_EXT 错位，症状是"顾客选完九个文件、点提交才被整条退回"。

import { describe, it, expect } from 'vitest'
import {
  fileExtOf, formatBytes, overflowReason, screenFile, screenFiles, validatePrintForm,
} from '../src/pages/print/printFormLogic'
import { MAX_PRINT_FILES, PRINT_FILE_MAX_BYTES } from '../src/pages/print/print.config'

const ok = { building: '36栋', room: '502' }

describe('fileExtOf', () => {
  it('常规文件名取最后一个点后的部分并小写', () => {
    expect(fileExtOf('实验报告.PDF')).toBe('pdf')
    expect(fileExtOf('a.b.docx')).toBe('docx')
  })
  it('负面：空串 / 无点 / 点结尾 / 非字符串 ⇒ 一律空串（不会落到白名单里）', () => {
    expect(fileExtOf('')).toBe('')
    expect(fileExtOf('README')).toBe('')
    expect(fileExtOf('文件.')).toBe('')
    expect(fileExtOf(null as unknown as string)).toBe('')
  })
  it('负面：路径穿越形态取不到能用的扩展名', () => {
    expect(fileExtOf('../../etc/passwd')).toBe('')
    expect(fileExtOf('/etc/passwd')).toBe('')
  })
})

describe('screenFile', () => {
  it('图片与常见文档全部放行', () => {
    for (const n of ['a.jpg', 'b.png', 'c.pdf', 'd.docx', 'e.pptx', 'f.xlsx', 'g.txt', 'h.heic']) {
      expect(screenFile({ name: n, size: 1024 }).ok, n).toBe(true)
    }
  })
  it('负面：空文件被拒（0 字节的占位文件不该进队列）', () => {
    const r = screenFile({ name: 'a.pdf', size: 0 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('为空')
  })
  it('负面：超过 20MB 被拒', () => {
    const r = screenFile({ name: 'a.pdf', size: PRINT_FILE_MAX_BYTES + 1 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('20MB')
  })
  it('负面：不在白名单的扩展名被拒（.exe / .zip / 无扩展名）', () => {
    expect(screenFile({ name: 'virus.exe', size: 10 }).ok).toBe(false)
    expect(screenFile({ name: 'a.zip', size: 10 }).ok).toBe(false)
    expect(screenFile({ name: 'noext', size: 10 }).ok).toBe(false)
  })
  it('边界：正好 20MB 放行（拒绝分支不能写成 >=）', () => {
    expect(screenFile({ name: 'a.pdf', size: PRINT_FILE_MAX_BYTES }).ok).toBe(true)
  })
})

describe('screenFiles', () => {
  it('混进一张不支持的，只拒那一张，其余照收（不因为一张坏掉整批）', () => {
    const { accepted, rejected } = screenFiles([
      { name: 'a.pdf', size: 10 },
      { name: 'b.exe', size: 10 },
      { name: 'c.png', size: 10 },
    ])
    expect(accepted.map((f) => f.name)).toEqual(['a.pdf', 'c.png'])
    expect(rejected).toHaveLength(1)
    expect(rejected[0].name).toBe('b.exe')
  })
  it('负面：空数组不炸，返回两个空集合', () => {
    expect(screenFiles([]).accepted).toEqual([])
  })
})

describe('overflowReason', () => {
  it('刚好装满不提示', () => {
    expect(overflowReason(MAX_PRINT_FILES - 1, 1)).toBeNull()
    expect(overflowReason(0, MAX_PRINT_FILES)).toBeNull()
  })
  it('负面：装不下时给出带当前数量的原因', () => {
    const r = overflowReason(7, 5)
    expect(r).toContain(`最多上传 ${MAX_PRINT_FILES}`)
    expect(r).toContain('当前 7')
  })
})

describe('validatePrintForm', () => {
  it('楼栋 + 房间 + 至少一个文件 ⇒ 通过', () => {
    expect(validatePrintForm(ok, [{ name: 'a.pdf', size: 10 }]).ok).toBe(true)
  })
  it('微信号与备注留空仍通过（选填项）', () => {
    expect(validatePrintForm({ building: '36栋', room: '502', wechat: '', remark: '' }, [{ name: 'a.pdf', size: 10 }]).ok).toBe(true)
  })
  it('负面：楼栋/房间只写空格 ⇒ 按没填处理（trim 后才判）', () => {
    const a = validatePrintForm({ building: '   ', room: '502' }, [{ name: 'a.pdf', size: 10 }])
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.field).toBe('building')
    const b = validatePrintForm({ building: '36栋', room: '\t\n' }, [{ name: 'a.pdf', size: 10 }])
    expect(b.ok).toBe(false)
    if (!b.ok) expect(b.field).toBe('room')
  })
  it('负面：没有文件时拦在 files 字段', () => {
    const r = validatePrintForm(ok, [])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('files')
  })
  it('负面：备注超 200 字 ⇒ 拦在 remark（服务端会截 200，不拦就是"存的和写的不一样"）', () => {
    const r = validatePrintForm({ ...ok, remark: 'x'.repeat(201) }, [{ name: 'a.pdf', size: 10 }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('remark')
  })
  it('负面：文件数超过上限 ⇒ 拦在 files', () => {
    const many = Array.from({ length: MAX_PRINT_FILES + 1 }, (_, i) => ({ name: `a${i}.pdf`, size: 10 }))
    const r = validatePrintForm(ok, many)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.field).toBe('files')
  })
})

describe('formatBytes', () => {
  it('按 KB / MB 分档', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })
  it('负面：非法输入不炸（NaN / 负数按 0 处理）', () => {
    expect(formatBytes(NaN)).toBe('0 B')
    expect(formatBytes(-5)).toBe('-5 B')
  })
})
