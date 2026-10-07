// 滚动驱动的相机推进（"在空间中行走"的核心）。
//
// 为什么不用 drei 的 ScrollControls：drei 会带进一批**未安装的可选 peer**
// （expo / react-native / vue / @nuxt/kit …），本仓 check-licenses 会把它们算进分母并判红；
// 而这里需要的只是"一个 0→1 的进度值 + 每帧插值"，十几行就能接完，不值得为它改门禁。
// 进度值由 PrintPage 的 Lenis 写入 progressRef（ref 而非 state：每帧读、不触发 React 重渲染）。

import { useRef, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { CAMERA_START_Z, CORRIDOR_LENGTH, EYE_HEIGHT } from './printTheme'

interface Props {
  /** 0 → 1 的滚动进度（由 PrintPage 单调化后写入）。 */
  progressRef: MutableRefObject<number>
  /** 降级：关掉摇摆（prefers-reduced-motion）。 */
  calm?: boolean
}

export default function PrintCameraRig({ progressRef, calm = false }: Props) {
  const cur = useRef(0)

  useFrame((state, dt) => {
    // camera 从 useFrame 的 state 上取，而不是在渲染期从 useThree() 解构出来：
    // 每帧写 position/rotation 属于渲染期之外的值变更，从渲染作用域捕获会被
    // react(immutability) 判为"渲染后修改值"（lint 是 `--max-warnings 0`，会直接红）。
    const camera = state.camera
    const target = Math.min(1, Math.max(0, progressRef.current))
    // 帧率无关的指数平滑：dt 变化时收敛速度不变（直接 lerp(a,b,0.1) 在高刷屏上会更快）
    const k = 1 - Math.exp(-dt * 6)
    cur.current += (target - cur.current) * k

    const p = cur.current
    const z = CAMERA_START_Z - p * CORRIDOR_LENGTH
    // 呼吸式摆动：横向 ±0.22、上下 ±0.05 —— 幅度刻意压小，视差眩晕阈值在视口高度的 12% 以内
    const swayX = calm ? 0 : Math.sin(p * 14) * 0.22
    const swayY = calm ? 0 : Math.sin(p * 21) * 0.05
    camera.position.set(swayX, EYE_HEIGHT + swayY, z)
    // 视线始终落在前方 9 个单位的走廊消失点，形成"往前走"的透视
    camera.lookAt(swayX * 0.4, EYE_HEIGHT - 0.06, z - 9)
    if (!calm) camera.rotation.z = Math.sin(p * 9) * 0.008
  })

  return null
}
