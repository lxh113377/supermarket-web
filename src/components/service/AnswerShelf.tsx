import { Link } from 'react-router-dom'
import { productThumbUrl, productSrcSet } from '../../utils/images'
import { formatPrice } from '../../utils/format'
import { products } from '../../data/products-seed'

interface Hit {
  id: string
  order: number
  name: string
  price: number
}

/**
 * 答案里长出货架（第 91 轮）：AI 回一段文字，顾客还得自己去商城找它说的那件东西 ——
 * 这条链在导购页断掉了。本件把断掉的半截接上：答案里**提到**的商品，当场在气泡下方
 * 立成一小排货架（暖台 + 价签，与首页第四带、详情页灯箱同一套台面语言）。
 *
 * 口径（这条决定了它是不是一个诚实的组件）：
 *  - **只上架答案原文里出现过商品名的那几件**。不做「猜他想买什么」的联想推荐 ——
 *    AI 说「东方树叶不错」我就摆东方树叶，AI 没提的我一件都不摆。理由与本仓
 *    「屏上每个数字都要有出处」同族：这里的要求是**屏上每件商品都要在答案里被点名**，
 *    否则就是拿一个算法的偏好冒充导购员的话。
 *  - 取数用 seed 目录（与首页货架同一份静态在售面）⇒ 零请求、零新接口；
 *    匹配前把全角/空白归一，因为模型回的文里商品名常被引号或空格打断。
 *  - 命中 0 件 ⇒ 整块不渲染（不摆空货架，也不摆「没有找到相关商品」这种噪音）。
 *  - 上限 3 件：聊天气泡里排一排卡片，超过三件就把对话本身挤没了。
 */
const MAX_HITS = 3

/** 归一：全角转半角、去掉空白与常见标点，让「东方树叶 青柑普洱」也能对上目录里的名字 */
function norm(s: string): string {
  return s
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s·，。、！？；：「」『』“”()（）\-_/]/g, '')
    .toLowerCase()
}

const CATALOG: Hit[] = products
  .filter((p) => p.enabled !== false && typeof p.order === 'number' && p.name.length >= 3)
  .map((p) => ({ id: 'p_' + (p.order as number), order: p.order as number, name: p.name, price: p.price }))

/** 答案文本 → 命中的在售商品（按目录顺序，最多 3 件） */
export function matchShelf(answer: string): Hit[] {
  const hay = norm(answer)
  if (!hay) return []
  const hits: Hit[] = []
  for (const p of CATALOG) {
    if (hay.includes(norm(p.name))) hits.push(p)
    if (hits.length >= MAX_HITS) break
  }
  return hits
}

export default function AnswerShelf({ answer }: { answer: string }) {
  const hits = matchShelf(answer)
  if (hits.length === 0) return null
  return (
    <div className="answer-shelf">
      <p className="answer-shelf-cap">
        <span aria-hidden="true" className="counter-no">SHELF</span>
        刚才说到这几件，架上就有
      </p>
      <ul className="answer-shelf-rail">
        {hits.map((h) => (
          <li key={h.id}>
            <Link to={'/product/' + h.id} className="answer-shelf-item" aria-label={'看 ' + h.name + ' 详情'}>
              {/* 价签必须挂在**照片内部**：第一版把它写成照片的兄弟节点，而
                  .answer-shelf-item 没有 position: relative ⇒ 绝对定位一路逃逸到祖先，
                  三个价签全叠在同一坐标（目检截图实测只剩一个 ¥5.66，另两个看不见）。
                  探针当时也没抓到 —— 它比的是 tag 与 name 的矩形是否相交，三个叠在一起的
                  tag 与 name 都不相交，于是报了 overlap:false 的假结论。
                  ⇒ 几何断言必须比「每件各有一个、且落在自己照片内」，不能只比不重叠。 */}
              <span className="answer-shelf-photo">
                <img
                  src={productThumbUrl(h.order) ?? ''}
                  srcSet={productSrcSet(h.order)}
                  sizes="72px"
                  width={400}
                  height={400}
                  loading="lazy"
                  decoding="async"
                  alt=""
                />
                <span className="answer-shelf-tag price-num">
                  <span className="home-shelf-yuan" aria-hidden="true">¥</span>{formatPrice(h.price)}
                </span>
              </span>
              <span className="answer-shelf-name">{h.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
