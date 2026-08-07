import { useCallback, useEffect, useState } from 'react'
import { getCategories, getProducts } from '../db.js'

export default function useProducts() {
  const [categories, setCategories] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const [cats, prods] = await Promise.all([getCategories(), getProducts()])
      setCategories(cats)
      setProducts(prods)
      setError('')
    } catch (err) {
      setError('加载数据失败：' + err.message)
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
