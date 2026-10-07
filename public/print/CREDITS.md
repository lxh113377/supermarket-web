# 「打印」页 3D 素材来源与许可登记

本目录下所有素材均来自 **Poly Haven**（https://polyhaven.com），全站许可为
**CC0 1.0 Universal（公有领域贡献）** —— 可商用、可修改、无需署名（署名仅为留痕）。
许可全文：https://polyhaven.com/license ｜ CC0 法律文本：https://creativecommons.org/publicdomain/zero/1.0/

下载日期：**2026-10-07** ｜ 下载变体：**1k**（移动端首帧与流量权衡后的最小可用分辨率）

## 模型（glTF 2.0，1k 变体）

| 目录 | 资产名 | 作者 | 来源页 | 许可 |
| --- | --- | --- | --- | --- |
| `models/SchoolDesk_01/` | School Desk 01 | Ethan Place | https://polyhaven.com/a/SchoolDesk_01 | CC0 |
| `models/SchoolChair_01/` | School Chair 01 | Ethan Place | https://polyhaven.com/a/SchoolChair_01 | CC0 |
| `models/Shelf_01/` | Shelf 01 | Gabriel Radić | https://polyhaven.com/a/Shelf_01 | CC0 |

每个模型目录内为 Poly Haven 原始 glTF 结构（`<name>_1k.gltf` + `<name>.bin` + `textures/*.jpg`），
**未做任何修改**，仅下载。

## 贴图（JPG，1k Diffuse）

| 文件 | 资产名 | 作者 | 来源页 | 许可 |
| --- | --- | --- | --- | --- |
| `textures/floor_diff.jpg` | Painted Concrete Floor | Rob Tuytel | https://polyhaven.com/a/concrete_floor_painted | CC0 |
| `textures/wall_diff.jpg` | Concrete Wall 001 | Dimitrios Savva, Rico Cilliers | https://polyhaven.com/a/concrete_wall_001 | CC0 |

## 体积

- 3 个模型合计约 **1.41 MB**，2 张贴图合计约 **0.73 MB**，总计约 **2.15 MB**（预算 ≤3 MB）。
- 只取 Diffuse 一张贴图：法线/粗糙度/AO 由场景灯光与材质参数补偿，避免为移动端多倍下载。

## 复取方式（体积或素材变更时使用）

```
GET https://api.polyhaven.com/files/<asset>        # 取各分辨率的直链与体积
GET https://api.polyhaven.com/info/<asset>         # 取作者与发布时间
```
