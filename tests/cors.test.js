import { describe, it, expect } from 'vitest'
import { resolveCorsHeaders } from '../functions/lib/backend'

function req(origin) {
  return { headers: { get: (k) => (k === 'Origin' ? origin : null) } }
}

describe('CORS 白名单（resolveCorsHeaders）', () => {
  it('默认白名单内的 pages.dev 放行并回显 Origin', () => {
    const h = resolveCorsHeaders(req('https://supermarket-web.pages.dev'), {})
    expect(h['Access-Control-Allow-Origin']).toBe('https://supermarket-web.pages.dev')
  })

  it('默认白名单内的 github.io 放行', () => {
    const h = resolveCorsHeaders(req('https://lxh113377.github.io'), {})
    expect(h['Access-Control-Allow-Origin']).toBe('https://lxh113377.github.io')
  })

  it('经 env.ALLOWED_ORIGINS 追加来源', () => {
    const h = resolveCorsHeaders(req('https://shop.example.com'), { ALLOWED_ORIGINS: 'https://shop.example.com, https://other.com' })
    expect(h['Access-Control-Allow-Origin']).toBe('https://shop.example.com')
  })

  it('本地开发（localhost）放行', () => {
    const h = resolveCorsHeaders(req('http://localhost:5173'), {})
    expect(h['Access-Control-Allow-Origin']).toBe('http://localhost:5173')
  })

  it('非白名单来源不带 Access-Control-Allow-Origin', () => {
    const h = resolveCorsHeaders(req('https://evil.example.com'), {})
    expect(h['Access-Control-Allow-Origin']).toBeUndefined()
  })

  it('OPTIONS 方法头固定返回', () => {
    const h = resolveCorsHeaders(req('https://supermarket-web.pages.dev'), {})
    expect(h['Access-Control-Allow-Methods']).toBe('POST, OPTIONS')
    expect(h['Access-Control-Allow-Headers']).toBe('Content-Type')
  })
})