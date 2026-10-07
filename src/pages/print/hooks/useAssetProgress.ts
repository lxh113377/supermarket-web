// 3D 资源加载进度（替代 drei 的 useProgress）。
//
// three 的 DefaultLoadingManager 是所有 Loader 的默认管理器（GLTFLoader/TextureLoader 都走它），
// 挂上 onProgress 就能拿到「已加载 / 总数」。用它而不是自己数文件，是因为
// 一个 .gltf 会连带拉 .bin + 3 张贴图 —— 手数必然少算，进度条会提前跳到 100%。

import { useEffect, useState } from 'react'
import { DefaultLoadingManager } from 'three'

export interface AssetProgress {
  /** 0 → 1；没有任何资源开始加载时也是 1（由调用方的超时兜底处理）。 */
  ratio: number
  loaded: number
  total: number
}

export function useAssetProgress(): AssetProgress {
  const [p, setP] = useState<AssetProgress>({ ratio: 0, loaded: 0, total: 0 })

  useEffect(() => {
    const prev = {
      onStart: DefaultLoadingManager.onStart,
      onProgress: DefaultLoadingManager.onProgress,
      onLoad: DefaultLoadingManager.onLoad,
      onError: DefaultLoadingManager.onError,
    }
    DefaultLoadingManager.onProgress = (_url, loaded, total) => {
      setP({ ratio: total > 0 ? loaded / total : 0, loaded, total })
    }
    DefaultLoadingManager.onLoad = () => {
      setP((s) => ({ ratio: 1, loaded: s.total || s.loaded, total: s.total || s.loaded }))
    }
    // 单个资源失败不阻断：走廊本体是程序化的，缺一个道具只是少张桌子
    DefaultLoadingManager.onError = () => {}
    return () => {
      DefaultLoadingManager.onStart = prev.onStart
      DefaultLoadingManager.onProgress = prev.onProgress
      DefaultLoadingManager.onLoad = prev.onLoad
      DefaultLoadingManager.onError = prev.onError
    }
  }, [])

  return p
}
