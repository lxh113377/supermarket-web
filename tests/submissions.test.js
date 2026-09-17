import { describe, it, expect } from 'vitest'
import { getSubmissions, getSubmissionImages } from '../functions/lib/actions/submissions'

// 性能回归守卫（2026-09-18）：线上 14 条提交的 images 合计 1.22MB base64，
// 列表接口整包下发导致手机端打开「服务」页卡顿数秒。
// 契约：getSubmissions 只回 imageCount（不含 images 字段），原图由 getSubmissionImages 按需单条拉取。

const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' // 仅作占位，长度无关

function makeDB(rows) {
  return {
    prepare(sql) {
      let bound = []
      const api = {
        bind(...p) { bound = p; return api },
        async all() {
          // 列表查询（含 imageCount 计算列）
          if (sql.includes('imageCount')) {
            return {
              results: rows.map((r) => {
                const { images, ...rest } = r
                let count = 0
                try { const arr = JSON.parse(images ?? '[]'); count = Array.isArray(arr) ? arr.length : 0 } catch { count = 0 }
                return { ...rest, imageCount: count }
              }),
            }
          }
          // 单条原图查询
          if (sql.includes('WHERE _id = ?')) {
            const hit = rows.find((r) => r._id === bound[0])
            return { results: hit ? [{ images: hit.images }] : [] }
          }
          throw new Error('未预期的 SQL: ' + sql)
        },
      }
      return api
    },
  }
}

const ROWS = [
  { _id: 's1', serviceId: 'svc1', serviceName: '代取快递', categoryId: 'c1', categoryName: '生活', formData: '{"wechat":"wx1"}', images: JSON.stringify([IMG, IMG]), status: 'pending', createdAt: '2026-09-18T00:00:00.000Z', updatedAt: null },
  { _id: 's2', serviceId: 'svc2', serviceName: '办校园卡', categoryId: 'c1', categoryName: '生活', formData: '{}', images: '[]', status: 'done', createdAt: '2026-09-17T00:00:00.000Z', updatedAt: null },
  { _id: 's3', serviceId: 'svc3', serviceName: '维修', categoryId: 'c2', categoryName: '维修', formData: '{}', images: null, status: 'pending', createdAt: '2026-09-16T00:00:00.000Z', updatedAt: null },
]

describe('getSubmissions 列表负载', () => {
  it('不返回 images 字段（避免整表 base64 一次性下发）', async () => {
    const { code, data } = await getSubmissions(makeDB(ROWS))
    expect(code).toBe(0)
    for (const row of data) {
      expect(row.images).toBeUndefined()
      expect(Object.keys(row)).not.toContain('images')
    }
  })

  it('回传 imageCount 张数并反序列化 formData', async () => {
    const { data } = await getSubmissions(makeDB(ROWS))
    expect(data[0].imageCount).toBe(2)
    expect(data[1].imageCount).toBe(0)
    expect(data[2].imageCount).toBe(0) // images 为 NULL 视为 0
    expect(data[0].formData).toEqual({ wechat: 'wx1' })
  })

  it('响应体不含大图数据（字符串化后不出现 data:image）', async () => {
    const { data } = await getSubmissions(makeDB(ROWS))
    expect(JSON.stringify(data)).not.toContain('data:image')
  })
})

describe('getSubmissionImages 按需取图', () => {
  it('按 submissionId 返回原图数组', async () => {
    const { code, data } = await getSubmissionImages(makeDB(ROWS), { submissionId: 's1' })
    expect(code).toBe(0)
    expect(data.images).toEqual([IMG, IMG])
  })

  it('缺少 submissionId 直接拒绝', async () => {
    const r = await getSubmissionImages(makeDB(ROWS), {})
    expect(r.code).toBe(-1)
    expect(r.message).toContain('submissionId')
  })

  it('不存在的提交返回失败而非空数组', async () => {
    const r = await getSubmissionImages(makeDB(ROWS), { submissionId: 'not-exist' })
    expect(r.code).toBe(-1)
    expect(r.message).toContain('不存在')
  })
})
