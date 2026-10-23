import { useState, useEffect } from 'react'
import { isBusinessHours } from '../utils/businessHours'

/**
 * 营业状态**跟着时间走**，而不是只在挂载时算一次。
 *
 * 一手（2026-10-23，老大报「营业时间显示已打烊」）：五个消费点原本都写成
 * `const open = isBusinessHours()` —— 在组件体里一次性求值。于是：
 *   · HomePage 的封面走钟每秒 setState，但那只重渲染 CoverClock 自己，open 不会重算；
 *   · 其余四处连定时器都没有。
 * 后果实测坐实（tests/zzProbeHours 的探针改写成正式用例后见 tests/businessHoursHook.test.tsx）：
 * 17:36 打开首页、一直不刷新的人，到 17:37 之后仍看到「已打烊」，直到手动刷新。
 * 营业起点/终点都是**时间点**，界面却把它当**常量** ⇒ 这是状态与真相源脱钩，不是样式问题。
 *
 * 口径：
 *   · 每 30 秒重算一次（营业区间的最小粒度是分钟，30s 足够准，且比 1s 省）。
 *   · 对齐到「下一个整分钟」再起跳：避免 17:36:59 挂载 + 30s 心跳 ⇒ 17:37:29 才翻牌，
 *     让翻牌最多晚 1 分钟而不是 30 秒。
 *   · 只在跨区间时才 setState（比较布尔值本身，React 对同值 bail out）⇒ 不制造无谓重渲染。
 *   · visibilitychange 时立即重算：手机锁屏/切后台期间定时器会被节流甚至暂停，
 *     回到前台必须马上以真实时间纠正，否则又回到「冻结」的老毛病。
 */
export function useBusinessHours(): boolean {
  const [open, setOpen] = useState(() => isBusinessHours())

  useEffect(() => {
    let timer: number | undefined

    const sync = () => setOpen(isBusinessHours())

    const schedule = () => {
      const now = new Date()
      // 距离下一个整分钟的毫秒数（+50ms 余量，确保跨过分钟边界）
      const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50
      timer = window.setTimeout(() => {
        sync()
        schedule()
      }, msToNextMinute)
    }

    schedule()

    // 切后台回来立即纠正（定时器在后台可能被节流/暂停）
    const onVisible = () => { if (document.visibilityState === 'visible') sync() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return open
}
