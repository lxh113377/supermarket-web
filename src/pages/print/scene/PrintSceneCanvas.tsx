// 打印页的 3D 走廊：程序化几何体 + Poly Haven CC0 glTF 道具。
//
// 渲染层刻意不引入 drei：它带进一批未安装的可选 peer（expo / react-native / vue 等），
// 会被 check-licenses 算进分母判红。这里只用 three + @react-three/fiber：
//   · 贴图/模型用 R3F 的 useLoader（自带 suspense 缓存，同一 URL 只下载一次）
//   · 加载进度由 THREE.DefaultLoadingManager 交给 PrintSplash（见 hooks/useAssetProgress.ts）

import { Suspense, useMemo, type MutableRefObject } from 'react'
import { Canvas, useLoader } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { TextureLoader, RepeatWrapping, SRGBColorSpace, type Mesh } from 'three'
import PrintCameraRig from './PrintCameraRig'
import {
  CEILING_LIGHTS, CORRIDOR_HALF_W, CORRIDOR_HEIGHT, CORRIDOR_LENGTH,
  DOORS, MODEL_URLS, NEON, PROPS, TEXTURE_URLS,
} from './printTheme'

/** 贴图：重复铺满走廊，颜色空间必须是 sRGB，否则会发灰。 */
function useCorridorTexture(url: string, rx: number, ry: number) {
  const tex = useLoader(TextureLoader, url)
  return useMemo(() => {
    const t = tex.clone()
    t.wrapS = RepeatWrapping
    t.wrapT = RepeatWrapping
    t.repeat.set(rx, ry)
    t.colorSpace = SRGBColorSpace
    t.needsUpdate = true
    return t
  }, [tex, rx, ry])
}

/** 单个 glTF 道具：克隆后摆放（共享几何体，不重复下载）。 */
function GltfProp({ kind, x, z, ry, scale }: { kind: keyof typeof MODEL_URLS; x: number; z: number; ry: number; scale: number }) {
  const gltf = useLoader(GLTFLoader, MODEL_URLS[kind])
  const obj = useMemo(() => {
    const c = gltf.scene.clone(true)
    c.traverse((n) => {
      const m = n as Mesh
      if (m.isMesh) { m.castShadow = false; m.receiveShadow = false }
    })
    return c
  }, [gltf.scene])
  return <primitive object={obj} position={[x, 0, z]} rotation={[0, ry, 0]} scale={scale} />
}

function Corridor() {
  const floorTex = useCorridorTexture(TEXTURE_URLS.floor, 2, CORRIDOR_LENGTH / 6)
  const wallTex = useCorridorTexture(TEXTURE_URLS.wall, CORRIDOR_LENGTH / 5, 1.4)

  return (
    <group>
      {/* 地面 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -CORRIDOR_LENGTH / 2]}>
        <planeGeometry args={[CORRIDOR_HALF_W * 2, CORRIDOR_LENGTH + 40]} />
        <meshStandardMaterial map={floorTex} roughness={0.55} metalness={0.25} color="#8b93ad" />
      </mesh>
      {/* 两侧墙 */}
      {[1, -1].map((s) => (
        <mesh key={s} rotation={[0, s > 0 ? -Math.PI / 2 : Math.PI / 2, 0]} position={[s * CORRIDOR_HALF_W, CORRIDOR_HEIGHT / 2, -CORRIDOR_LENGTH / 2]}>
          <planeGeometry args={[CORRIDOR_LENGTH + 40, CORRIDOR_HEIGHT]} />
          <meshStandardMaterial map={wallTex} roughness={0.9} color="#4b5573" />
        </mesh>
      ))}
      {/* 天花板 */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, CORRIDOR_HEIGHT, -CORRIDOR_LENGTH / 2]}>
        <planeGeometry args={[CORRIDOR_HALF_W * 2, CORRIDOR_LENGTH + 40]} />
        <meshStandardMaterial color="#141b33" roughness={1} />
      </mesh>

      {/* 顶灯：冷白与暖黄交替，走到近处会有一明一暗的节奏 */}
      {CEILING_LIGHTS.map((l, i) => (
        <group key={i} position={[0, CORRIDOR_HEIGHT - 0.12, l.z]}>
          <mesh>
            <boxGeometry args={[1.5, 0.06, 0.5]} />
            <meshStandardMaterial
              color={l.warm ? '#fff6e0' : '#dff6ff'}
              emissive={l.warm ? '#ffb020' : NEON.cyan}
              emissiveIntensity={2.4}
            />
          </mesh>
          <pointLight color={l.warm ? '#ffb020' : NEON.cyan} intensity={9} distance={16} decay={2} />
        </group>
      ))}

      {/* 门：门缝透暖光，是"有人在里面"的生活感来源 */}
      {DOORS.map((d, i) => (
        <group key={i} position={[d.side * (CORRIDOR_HALF_W - 0.03), 0, d.z]}>
          <mesh position={[0, 1.05, 0]}>
            <boxGeometry args={[0.06, 2.1, 0.95]} />
            <meshStandardMaterial color="#1b2340" roughness={0.6} metalness={0.3} />
          </mesh>
          <mesh position={[-d.side * 0.04, 0.9, 0]}>
            <boxGeometry args={[0.02, 1.7, 0.06]} />
            <meshStandardMaterial color="#ffb020" emissive="#ffb020" emissiveIntensity={1.6} />
          </mesh>
        </group>
      ))}

      {/* 地面两侧的霓虹光带：整条走廊的视觉骨架 */}
      {[1, -1].map((s) => (
        <mesh key={`neon-${s}`} rotation={[-Math.PI / 2, 0, 0]} position={[s * (CORRIDOR_HALF_W - 0.12), 0.015, -CORRIDOR_LENGTH / 2]}>
          <planeGeometry args={[0.07, CORRIDOR_LENGTH + 40]} />
          <meshStandardMaterial
            color={s > 0 ? NEON.cyan : NEON.violet}
            emissive={s > 0 ? NEON.cyan : NEON.violet}
            emissiveIntensity={3.2}
          />
        </mesh>
      ))}

      {/* 尽头：打印店的门头，相机走到最后停在这里 */}
      <group position={[0, 0, -CORRIDOR_LENGTH - 2]}>
        <mesh position={[0, 2.0, 0.05]}>
          <boxGeometry args={[3.2, 1.1, 0.1]} />
          <meshStandardMaterial color="#0b1020" emissive={NEON.pink} emissiveIntensity={0.9} />
        </mesh>
        <pointLight color={NEON.pink} intensity={14} distance={22} decay={2} position={[0, 2, 1.5]} />
      </group>

      {PROPS.map((p, i) => (
        <GltfProp key={i} kind={p.kind} x={p.x} z={p.z} ry={p.ry} scale={p.scale} />
      ))}
    </group>
  )
}

interface Props {
  progressRef: MutableRefObject<number>
  calm?: boolean
}

export default function PrintSceneCanvas({ progressRef, calm = false }: Props) {
  return (
    <Canvas
      // dpr 上限 1.8：手机上 3x 屏按 3 渲染会让这条走廊直接掉到 20fps 以下
      dpr={[1, 1.8]}
      gl={{ antialias: true, powerPreference: 'high-performance', alpha: true }}
      camera={{ fov: 62, near: 0.1, far: 260, position: [0, 1.62, 6] }}
      style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}
    >
      <fogExp2 attach="fog" args={[NEON.ink, 0.028]} />
      <ambientLight intensity={0.35} color="#8fa3c8" />
      <hemisphereLight args={['#6ee7ff', '#05070d', 0.5]} />
      <PrintCameraRig progressRef={progressRef} calm={calm} />
      <Suspense fallback={null}>
        <Corridor />
      </Suspense>
    </Canvas>
  )
}
