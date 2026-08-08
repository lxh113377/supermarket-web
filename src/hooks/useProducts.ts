import { useCallback, useEffect, useState } from 'react'
import { getCategories, getProducts } from '../db'
import type { Category, Product } from '../types'

export default function useProducts() {
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const [cats, prods] = await Promise.all([getCategories(), getProducts()])
      setCategories(cats)
      setProducts(prods)
      setError('')
    } catch (err) {
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
