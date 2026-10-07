// 打印页 3D 场景的配色与几何常量（纯数据，无副作用）。
//
// 素材为 Poly Haven 的 CC0 glTF（1k 变体），来源与许可见 public/print/CREDITS.md。
// 走廊本体是程序化几何体（墙/地/天花/灯带/门），模型只作点缀 —— 这样体积可控
// （3 个模型合计 1.41MB），又能在相机推进时有真实的近景掠过感。

export const NEON = {
  cyan: '#6ee7ff',
  violet: '#a855f7',
  pink: '#ff3d9a',
  ink: '#05070d',
} as const

/** 走廊总长（相机沿 -Z 前进的行程）。 */
export const CORRIDOR_LENGTH = 150
/** 走廊半宽 / 净高。 */
export const CORRIDOR_HALF_W = 3
export const CORRIDOR_HEIGHT = 4
/** 相机眼高与起点。 */
export const EYE_HEIGHT = 1.62
export const CAMERA_START_Z = 6

/** 站点根绝对路径（与 src/utils/images.ts 的 /images 同口径）。 */
export const MODEL_URLS = {
  desk: '/print/models/SchoolDesk_01/SchoolDesk_01_1k.gltf',
  chair: '/print/models/SchoolChair_01/SchoolChair_01_1k.gltf',
  shelf: '/print/models/Shelf_01/Shelf_01_1k.gltf',
} as const

export const TEXTURE_URLS = {
  floor: '/print/textures/floor_diff.jpg',
  wall: '/print/textures/wall_diff.jpg',
} as const

/** 顶灯：沿走廊每 9 个单位一盏，明暗交替（走过去有节奏感）。 */
export const CEILING_LIGHTS = Array.from({ length: 18 }, (_, i) => ({
  z: -i * 9 + 4,
  warm: i % 2 === 0,
}))

/** 两侧门：交替左右，门缝里透出暖光。 */
export const DOORS = Array.from({ length: 14 }, (_, i) => ({
  z: -i * 11 - 2,
  side: i % 2 === 0 ? 1 : -1,
}))

/** 道具摆放（z 越负越深）。scale 是实测调出来的：Poly Haven 模型单位≈米，课桌略偏大。 */
export const PROPS: { kind: keyof typeof MODEL_URLS; x: number; z: number; ry: number; scale: number }[] = [
  { kind: 'desk', x: -1.9, z: -6, ry: Math.PI / 2, scale: 0.62 },
  { kind: 'chair', x: -1.7, z: -9.2, ry: -Math.PI / 2, scale: 0.62 },
  { kind: 'shelf', x: 2.35, z: -16, ry: -Math.PI / 2, scale: 0.9 },
  { kind: 'desk', x: 2.0, z: -25, ry: -Math.PI / 2, scale: 0.62 },
  { kind: 'chair', x: 1.8, z: -28.4, ry: Math.PI / 2, scale: 0.62 },
  { kind: 'shelf', x: -2.4, z: -38, ry: Math.PI / 2, scale: 0.9 },
  { kind: 'desk', x: -1.9, z: -49, ry: Math.PI / 2, scale: 0.62 },
  { kind: 'shelf', x: 2.35, z: -60, ry: -Math.PI / 2, scale: 0.9 },
  { kind: 'chair', x: -1.7, z: -70, ry: -Math.PI / 2, scale: 0.62 },
  { kind: 'desk', x: 2.0, z: -82, ry: -Math.PI / 2, scale: 0.62 },
  { kind: 'shelf', x: -2.4, z: -95, ry: Math.PI / 2, scale: 0.9 },
  { kind: 'chair', x: 1.8, z: -108, ry: Math.PI / 2, scale: 0.62 },
  { kind: 'desk', x: -1.9, z: -120, ry: Math.PI / 2, scale: 0.62 },
  { kind: 'shelf', x: 2.35, z: -132, ry: -Math.PI / 2, scale: 0.9 },
]

/** 章节停靠点（与 PrintPage 的分段一一对应）：相机走到这里时该段文案揭晓。 */
export const CHAPTER_STOPS = [0, 0.26, 0.52, 0.76, 1] as const
