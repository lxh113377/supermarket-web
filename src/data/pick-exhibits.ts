import type { SeedProduct } from '../types'

/**
 * 首页展台「今日三件」随机挑选（2026-10-25 目标：开屏三个零食每次随机）。
 *
 * 纯函数：从零食池抽 3 件不重复商品，配一组风格化文案（动词短语 + 场景短语，
 * 与 v3 的「解馋/咔滋/清爽」同语言）。random 由调用方注入（默认 Math.random），
 * 单测喂 0/0.5 可复算结果；组件按模块加载时抽一次（每次开屏=一次页面会话新随机）。
 *
 * 边界：池子 < 3 时按池子大小给（不硬凑）；抽到的顺序固定为 back/front/side 三档位。
 */

const LABELS = ['解馋', '咔滋', '快乐补给', '打牙祭', '今天想吃', '来一份', '解压', '能量条', '课后甜头', '好柿发生']
const SUBS = ['香辣一口', '快乐开袋', '课间补水', '晚自习搭子', '宿舍夜宵', '追剧标配', '下课就来', '分量扎实', '甜咸都行', '口碑老客']

export interface ExhibitItem {
  /** 商品序号（决定 /images/N.webp 实拍图） */
  order: number
  name: string
  label: string
  sub: string
  className: 'exhibit-back' | 'exhibit-front' | 'exhibit-side'
}

const CLASSES: ExhibitItem['className'][] = ['exhibit-back', 'exhibit-front', 'exhibit-side']

export function pickExhibits(
  pool: Pick<SeedProduct, 'name' | 'order'>[],
  random: () => number = Math.random,
): ExhibitItem[] {
  const usable = pool.filter((p) => typeof p.order === 'number')
  const n = Math.min(3, usable.length)
  const picked: ExhibitItem[] = []
  const used = new Set<number>()
  for (let i = 0; i < n; i++) {
    let idx = Math.floor(random() * usable.length)
    let guard = 0
    while (used.has(idx) && guard < usable.length * 4) { idx = Math.floor(random() * usable.length); guard++ }
    if (used.has(idx)) idx = usable.findIndex((_, k) => !used.has(k))
    used.add(idx)
    const product = usable[idx]
    picked.push({
      order: product.order as number,
      name: product.name,
      label: LABELS[(Math.floor(random() * LABELS.length) + i) % LABELS.length],
      sub: SUBS[(Math.floor(random() * SUBS.length) + i * 3) % SUBS.length],
      className: CLASSES[i],
    })
  }
  return picked
}
