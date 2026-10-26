# 03 · 关键实现

> 代码路径都相对 `supermarket-web/rust/`。每处优化后面都跟一条**为什么**，以及它在指标上的落点。

## 1. 服务端渲染 / 流式输出

### 1.1 SSR 外壳（`crates/edge/src/shell.rs`）

外壳不是「把 React 渲染到服务端」（那需要 Node 侧 React SSR），而是**把首屏不等 JS 的那部分静态化、其余全部交给原前端**：

1. 读 `dist/index.html`（Vite 产物）；
2. 把外链样式表整份**内联**进 `<head>`；
3. 在 CSP 里只放宽**这一份样式的哈希**（不放 `unsafe-inline`）；
4. 把首屏路由 chunk（`HomePage-*.js`）提前 `modulepreload`；
5. 计算 ETag、预压缩 br/gz、生成 `Link` 头（供 CDN 转 103 Early Hints）；
6. 可选：`--boot-replica` 往 `#root` 注入 header + hero 的**同构静态复刻**。

关键片段（CSP 哈希式放宽，而不是 unsafe-inline）：

```rust
// crates/edge/src/shell.rs
let hash = base64_sha256(&css);              // 与浏览器同一套 sha256
let style = format!("<style>{}</style>", String::from_utf8_lossy(&css));
html.replace_range(tag.start..tag.end, &style);
html = relax_style_csp(&html, &hash);        // style-src 'self' → style-src 'self' 'sha256-…'
```

为什么用哈希而不是 nonce：nonce 每次响应都变 ⇒ HTML 永远不能命中 304，重复访问要多付一次整包。
哈希在**同一个构建产物内是常量** ⇒ ETag 稳定 ⇒ 重复访问是 0 字节 304（实测 0.71 ms）。

### 1.2 流式输出（`crates/edge/src/stream.rs`）

手写 `http_body::Body`，**每 poll 一次交一帧**，hyper 每帧独立写出（TCP_NODELAY 默认开）：

```rust
fn poll_frame(...) -> Poll<Option<Result<Frame<Bytes>, io::Error>>> {
    Poll::Ready(self.chunks.pop_front().map(|b| Ok(Frame::data(b))))
}
```

**诚实结论（实测）**：样式内联后，head 就是整包的大头（130,973 B 里的样式 + 2.6 KB 标记），
而浏览器**必须先拿到样式才能绘制**。所以在本项目的形态下，流式的收益只对
「identity 客户端」与「尾部可延后」成立，对 br/gz 客户端第一帧≈整包。
我们因此选了「整包预压缩」优先保字节（20,715 B 而不是 25,273 B gzip），
把分块保留在 identity 路径上 —— 这一条写在 docs/05 §3 的对照表里，不当作优点宣传。

## 2. 首屏关键资源体积控制与内联（`shell.rs` + `main.rs`）

| 手段 | 实现 | 落点指标 |
|---|---|---|
| 样式内联 | 外链 `<link rel=stylesheet>` → `<style>`；CSP 加 sha256 | 去掉 1 次渲染阻塞请求（首屏请求数 −1） |
| 首屏路由 preload | 扫 `assets/HomePage-*.js` 写 `modulepreload` | HomePage chunk 由 t≈1707ms 提前到与入口 chunk 并行（t≈1027ms） |
| 入口脚本 preload | `<Link>; rel=preload; as=script` 头（CDN 转 103） | 首字节之前就把入口拉起来 |
| 预压缩 | 构建期 br(q11)/gz(level 9)，运行时只读文件 | HTML 20,715 B（br）而不是 25,273 B（gzip） |
| 字体预载 | 保留产物里已有的两条 `preload as=font`，并进 `Link` | 展示体不参与 FOUT 关键路径 |

## 3. 非关键资源：按需与延迟加载

- **路由级**：沿用原有的 `lazy(routeLoaders.*)`，我们只把**首屏那一个** chunk 提到 preload；
  其余 13 个路由 chunk 保持按需（不做全量 preload —— 那会把 138 KB 的按需面变成 400 KB 的关键面）。
- **WASM 加速器**：`rust/web/wasm-loader.js` 默认 **不在首屏加载**：
  首屏渲染完成后经 `requestIdleCallback`（降级 `setTimeout 1200`）预热，或第一次真正调用时按需拉取。
  失败路径三级：网络失败 → 回落；ABI 版本不符 → 拒绝加载并回落；运行期错误码 → **永久回落**并告警。
  ```js
  const call = (method, args, jsFallback) => {
    if (instance) { try { return { value: instance[method](...args), via: 'wasm' } }
                    catch (e) { enabled = false; instance = null; console.warn(...) } }
    return { value: jsFallback?.(...args), via: 'js' }   // 加速器坏了只是「不快」，不是「不对」
  }
  ```
- **图片**：沿用产物里的 `srcset` 小图与 `fetchPriority="high"`（未改）。

## 4. 缓存策略与压缩

### 4.1 缓存语义**同源**而不是另写一张表（`crates/edge/src/policy.rs`）

`dist/_headers` 是 Cloudflare Pages 的声明文件，仓里已有判据（`npm run verify:cache`）在对账它。
边缘侧直接**解析并应用**这份声明：

```rust
// assets.rs
policy_headers: policy.headers_for(&rel)   // /assets/* → max-age=31536000, immutable
                                           // /images/* → max-age=600, stale-while-revalidate=86400
                                           // /index.html、/sw.js → max-age=0, must-revalidate
```

于是「Rust 边缘发的头」与「Pages 发的头」在物理上同源，不会各改一半。

### 4.2 ETag：内容哈希（`assets.rs`）

```rust
let etag = if size <= 8 * 1024 * 1024 { hash_etag(&std::fs::read(&path)?) } else { meta_etag(size, mtime) };
```

- 小文件（首屏相关的一切）取**内容 sha256 前 16 位** —— 本项目有一族「同名换内容」的资产
  （`/images/{order}.webp`、`sw.js`），元数据 ETag 在换内容但 mtime 相同时会误判 304；
- 大图退化为「长度+mtime」，避免启动时为几张大图读满磁盘；部署产物每次是新目录，工程上足够。

### 4.3 压缩协商（`main.rs::pick_encoding`）

```rust
// 支持 q=0（显式拒绝）与通配；`br;q=0, gzip` 这类头在真实代理后面确实会出现
let br = has_br && value(br_q) > 0.0;
let gz = has_gz && value(gz_q) > 0.0;
```

用 `contains("br")` 会让「明确说不要 br」的客户端拿到无法解码的响应 —— 这类缺陷只在特定代理下暴露。
实测三态：`br, gzip` → 20,715 B（br）；`gzip` → 25,273 B；`br;q=0, gzip;q=0` → 133,702 B（identity，**不再压缩**）。

### 4.4 304

`If-None-Match` 逐项比较（含 `W/` 前缀与 `*`）：壳命中 → `304` 空体，实测 0.71 ms / 0 字节。

## 5. WASM 产物裁剪与初始化开销控制

| 措施 | 实现 | 实测 |
|---|---|---|
| LTO + codegen-units=1 | `[profile.release-wasm]` | — |
| `opt-level = "z"` | 同上 | 70,233 B 的基数 |
| `panic = "abort"` + `strip` | 同上 | 去掉 unwind 表与符号 |
| wasm-opt `-Oz` | 构建脚本（`--enable-bulk-memory` 等开关，见 docs/04） | 70,233 → **59,670 B raw**（brotli 22,243 B） |
| 无 wasm-bindgen | C ABI + 5 个导出（`sm_alloc/sm_free/sm_abi_version/sm_result_ptr/sm_result_len`） | 省掉一份 glue 运行时 + JS 胶水 |
| ABI 版本校验 | `sm_abi_version()` 必须等于胶水常量 | 版本不符**拒绝加载**（错位读出的「像数字的垃圾」比算不出来危险得多） |
| 初始化开销 | 懒加载（空闲预热）+ 单块结果缓冲 | Node 侧实测实例化含读盘 **1.28 ms** |
| 边界成本控制 | 常驻索引：商品表只传一次，之后每次按键只传查询串 | 常驻查询 **2.47× 快**于 JS 每次都重算的路径（docs/05 §4） |

错误码语义（协议层）：`-1` 截断、`-2` 非法 UTF-8、`-3` 形状不对（含「未加载就查询」）、
`-4` 超上限（24 MiB）。**未加载就查询不返回空列表** —— 空列表会被上层读成「这个分类没货」，
那是把状态错误显示成业务结论。

## 6. 接口网关（`crates/edge/src/api.rs`）

- **透传优先**：`/web`、`/pub` 默认把请求字节转发给现网 Functions，响应**原样回传**。
  这样「迁移当天接口契约 100% 不变」是结构保证，而不是「我们保证没改」。
- **原生只有三处**：
  1. `invalid_json` 分支（同判据、同文案、同状态）；
  2. `/_health`（db 三态 ok/error/unknown，不假装）；
  3. 公开读的**边缘微缓存**（只对 `docs/api-contract.json` 里已声明 `cacheKey` 的三个动作，
     60 s，键 = 动作 + 原样载荷字节，缓存的是**上游响应的原始字节**）。
- CORS 与 `functions/lib/security.js` 逐字对齐（白名单 + 本地开发 + `Vary: Origin` 常发）。
- 打印反代 `/api/{*rest}`：去掉 `origin`/`sec-fetch-site`（打印应用的同源守卫），
  未配置上游时回 `503 PRINT_APP_UNAVAILABLE`（不静默降级成空页）。
