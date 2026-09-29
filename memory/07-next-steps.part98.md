# 07 分卷 98 —— 第五十四轮登记的 R55 四项（自主卷分卷 97 逐字迁出）

## 下一轮（R55）登记

- **R55-H1（高）**：运行时性能维度**本轮仍无基准**，且这已是连续第五轮挂着同一句「不可比」。禁止再用免责声明结案：
  现网跑一次 Lighthouse（`pages.dev` 管理页 + `github.io` 顾客页各一次）+ `check:live-shape` 读数；取不到就写
  「未实测 + 取证路径」。前提=产出 `lighthouse-*.json` 且其中能 grep 到 `first-contentful-paint` 键。
- **R55-H2（中）**：未登记尾部仍有 39 件（最大 `installDataZoomInside 2.9KB／localStore 2.7KB／OrderConfirmPage 2.7KB`）。
  下一档门槛 ≥2,500B 约可再收数件；**登记与降地板仍须同一笔**，件数一律由枚举腿现算（禁手抄清单）。
- **R55-H3（中）**：`assertCliRan` 只接了 4 个测试文件；`tests/` 里还有大量裸 `spawnSync` 把 `status` 直接喂给断言
  （分母由 grep 现算）。要么逐件接入、要么做成共享 run 包装——**先量分母再动**，禁未经分母装闸。
- **R55-H4（低）**：`.editorconfig` 现在只被 E5 判「与 .gitattributes 同向」，**没判过它自己被编辑器遵守**；真要闭环要靠
  格式化器当唯一写手（biome/prettier），那是另一件事，本轮不做。
