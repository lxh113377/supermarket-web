// 超柿全局领域类型（前端唯一权威定义）

export interface Subcategory {
  id: string
  name: string
  order?: number
}

export interface Category {
  _id: string
  name: string
  type: string
  order?: number
  subcategories: Subcategory[]
}

export interface Product {
  _id: string
  name: string
  spec?: string
  price: number
  /** 成本价（可选，管理后台内联编辑录入；看板毛利率仅统计已填成本商品） */
  costPrice?: number
  subcategories?: string[]
  enabled?: boolean
  order?: number | string
  image?: string
  images?: string[]
  description?: string
  /** 商品内嵌评价（接口若一并下发则为 Review[]，此前写 unknown[] 会让下游必须强转） */
  reviews?: Review[]
  createdAt?: Date | string
  updatedAt?: Date | string
}

export type SeedProduct = Omit<Product, '_id'>

export interface Review {
  _id?: string
  productOrder: number
  user: string
  rating: number
  text: string
  images?: string[]
  date?: string
  createdAt?: Date | string
}

export interface OrderItem {
  productId: string
  name: string
  spec?: string
  price: number
  quantity: number
  subcategories?: string[]
}

export type CartItem = OrderItem

export interface Cart {
  items: CartItem[]
}

export interface Order {
  _id: string
  roomNumber: string
  items: OrderItem[]
  totalAmount?: number
  status: 'pending' | 'paid' | 'cancelled'
  wechat?: string
  remark?: string
  paymentScreenshot?: string
  createdAt: Date | string
  updatedAt?: Date | string
}

export interface Submission {
  _id: string
  serviceId: string
  serviceName: string
  categoryId?: string
  categoryName?: string
  formData: Record<string, string>
  images?: string[]
  // 列表接口只回张数，原图按需拉取（性能：避免整表 base64 一次性下发）
  imageCount?: number
  status?: string
  createdAt?: Date | string
  _offline?: boolean
}

export interface ServiceCategory {
  id: string
  name: string
  icon: string
  color: string
  description: string
}

export interface ServiceField {
  key: string
  label: string
  type?: 'text' | 'tel' | 'image'
  required?: boolean
  placeholder?: string
  hint?: string
  minCount?: number
}

export interface Service {
  id: string
  categoryId: string
  name: string
  icon: string
  description: string
  type?: 'supermarket' | 'form'
  popup?: string
  hint?: string
  fields?: ServiceField[]
}

export interface ApiResult<T = unknown> {
  code: number
  message?: string
  data?: T
  total?: number
  page?: number
  pageSize?: number
  // 分页查询是否还有下一页（getOrders 等分页接口返回；前端循环拉全量依赖它）
  hasMore?: boolean
}
