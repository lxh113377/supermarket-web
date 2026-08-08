import React, { useState, useEffect, useCallback } from 'react'
import { getAllReviews, addCloudReview, deleteCloudReview, getAdminProducts } from '../db'
import type { Product, Review } from '../types'

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-yellow-500 text-sm">
      {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}
    </span>
  )
}

export default function ReviewsTab() {
  const [reviews, setReviews] = useState<Review[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)

  // 新增表单
  const [showForm, setShowForm] = useState(false)
  const [formProduct, setFormProduct] = useState('')
  const [formUser, setFormUser] = useState('')
  const [formRating, setFormRating] = useState(5)
  const [formText, setFormText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [revs, prods] = await Promise.all([
        getAllReviews(),
        getAdminProducts(),
      ])
      setReviews((revs || []) as Review[])
      setProducts((prods || []) as Product[])
    } catch (e) {
      console.error('加载评价失败:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // 根据 productOrder 查商品名
  const getProductName = (order: number | string): string => {
    const p = products.find(p => p.order === order)
    return p ? `${p.name}${p.spec ? ' ' + p.spec : ''}` : `#${order}（已下架）`
  }

  // 删除评价
  const doDelete = async (reviewId: string) => {
    if (!confirm('确定删除这条评价？此操作不可撤销。')) return
    setDeleting(reviewId)
    try {
      await deleteCloudReview(reviewId)
      setReviews(prev => prev.filter(r => r._id !== reviewId))
    } catch (e) {
      alert('删除失败：' + (e instanceof Error ? e.message : '未知错误'))
    } finally {
      setDeleting(null)
    }
  }

  // 新增评价
  const doAdd = async () => {
    if (!formProduct) return setFormError('请选择商品')
    if (!formText.trim()) return setFormError('请输入评价内容')
    setSubmitting(true)
    setFormError('')
    try {
      const rev = await addCloudReview(Number(formProduct), {
        user: formUser.trim() || '管理员',
        rating: formRating,
        text: formText.trim(),
      })
      setReviews(prev => [rev, ...prev])
      setShowForm(false)
      setFormProduct('')
      setFormUser('')
      setFormRating(5)
      setFormText('')
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '新增失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <p className="text-gray-500 text-sm text-center">加载中...</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 操作栏 */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">共 {reviews.length} 条评价</span>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="px-3 py-1.5 text-xs text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
          >
            刷新
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="px-3 py-1.5 text-xs bg-brand-500 text-white rounded-lg hover:bg-brand-600"
          >
            + 新增评价
          </button>
        </div>
      </div>

      {/* 新增表单弹出 */}
      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border border-brand-200 p-4 space-y-3">
          <h3 className="text-sm font-bold text-gray-900">新增评价</h3>
          {/* 选择商品 */}
          <select
            value={formProduct}
            onChange={(e) => setFormProduct(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="">选择商品</option>
            {products.filter(p => p.enabled !== false).map(p => (
              <option key={p.order} value={p.order}>
                {p.name}{p.spec ? ' ' + p.spec : ''} (order={p.order})
              </option>
            ))}
          </select>
          {/* 昵称 */}
          <input
            type="text"
            placeholder={'昵称（选填，默认"管理员"）'}
            value={formUser}
            onChange={(e) => setFormUser(e.target.value)}
            maxLength={20}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
          {/* 评分 */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">评分：</span>
            {[1,2,3,4,5].map(n => (
              <button
                key={n}
                onClick={() => setFormRating(n)}
                aria-label={`${n}星`}
                className={`text-2xl ${n <= formRating ? 'text-yellow-400' : 'text-gray-300'}`}
              >★</button>
            ))}
          </div>
          {/* 内容 */}
          <textarea
            placeholder="评价内容（最多500字）"
            value={formText}
            onChange={(e) => setFormText(e.target.value)}
            maxLength={500}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
          />
          {formError && <p className="text-red-500 text-xs">{formError}</p>}
          <div className="flex gap-2">
            <button
              onClick={doAdd}
              disabled={submitting}
              className="flex-1 bg-brand-500 text-white py-2 rounded-lg text-sm disabled:opacity-50"
            >
              {submitting ? '提交中...' : '发布'}
            </button>
            <button
              onClick={() => { setShowForm(false); setFormError('') }}
              className="flex-1 bg-gray-100 text-gray-600 py-2 rounded-lg text-sm"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 评价列表 */}
      {reviews.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <p className="text-gray-400 text-sm text-center">暂无云端评价，点击上方"新增评价"添加</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {reviews.map((rev) => (
            <div key={rev._id} className="flex items-start gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
                  <span className="font-medium text-gray-600">{rev.user}</span>
                  <span>·</span>
                  <span>{rev.date || (rev.createdAt && new Date(rev.createdAt).toISOString().slice(0, 10))}</span>
                </div>
                <Stars rating={rev.rating} />
                <p className="text-sm text-gray-700 mt-1">{rev.text}</p>
                <p className="text-xs text-brand-500 mt-1">{getProductName(rev.productOrder)}</p>
              </div>
              <button
                onClick={() => doDelete(rev._id || '')}
                disabled={deleting === (rev._id || '')}
                className="text-xs text-red-400 hover:text-red-600 py-1 px-2 disabled:opacity-50 flex-shrink-0"
              >
                {deleting === (rev._id || '') ? '删除中' : '删除'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
