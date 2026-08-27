import { useCallback, useEffect, useRef, useState } from 'react'
import { getCategories, getProducts } from '../db'
import type { Category, Product } from '../types'

export default function useProducts() {
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // P0-8：请求序号竞态守卫——快速重复 refresh 时丢弃过期响应
  const refreshSeq = useRef(0)

  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current
    try {
      const [cats, prods] = await Promise.all([getCategories(), getProducts()])
      if (seq !== refreshSeq.current) return
      setCategories(cats)
      setProducts(prods)
      setError('')
    } catch (err) {
      if (seq !== refreshSeq.current) return
      setError('加载数据失败：' + (err instanceof Error ? err.message : String(err)))
    }
  }, [])

  useEffect(() => {
    async function init() {
      try {
        await refresh()
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [refresh])

  return { categories, products, loading, error, refresh }
}
