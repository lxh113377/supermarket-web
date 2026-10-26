#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把「中文展示体」按用量切成「首屏包 A + N 个按码点切片的懒加载包」。

为什么需要它（一手读数，见 rust/docs/07-font-governance.md）：
  原文件 215,580 B / 932 字形，而**首屏真正用到的展示体字符只有 12~30 种**
  （hero 标题「把日常，过得有滋味。」+ 刊头「超柿」等，由 extract-display-chars.mjs
   在浏览器里按「计算样式 = CS Display Serif」抽取）。其余 900 来种字形服务的是
  其它路由的标题，却因为「一个文件 + 一条宽 unicode-range」被迫在首屏一起下载 ——
  它是首屏传输里 47% 的那一项。

切法（并保证渲染逐像素不变）：
  1. **A 包**：首屏并集 + 全站展示体并集 + 数字/中文标点安全集（实测 24 字形 → 2,992 B）；
  2. **s1..sN**：其余字形按码点顺序等量切片，各自带精确 unicode-range；
  3. 同一个 font-family / font-weight / font-display，只是把「一个文件」换成
     「一组互相不重叠的 unicode-range」——浏览器只下载页面上真正出现字符的那些包。

选项（都为了不改渲染结果）：
  layout_features=['*']           保留全部 GSUB/GPOS（默认只留常用集，中文标点字距会变）；
  drop_tables=BASE/VORG/vhea/vmtx 这四张只服务竖排，本站无竖排文本；
  不开 desubroutinize             CFF 子程序复用是体积优势，展开反而更大。

用法：
  python rust/scripts/split-display-font.py \
      --source rust/fonts/display-serif-cjk.source.woff2 \
      --charset rust/fonts/display-charset.json \
      --out public/fonts --slices 6 \
      --manifest rust/fonts/display-font-manifest.json \
      --css rust/fonts/font-face.generated.css
"""

import argparse
import hashlib
import json
import os
import sys

from fontTools.ttLib import TTFont
from fontTools import subset


def ranges_of(codepoints):
    """把码点列表压成 unicode-range 文本（连续段用 a-b，单点用 a）。"""
    out = []
    start = prev = None
    for cp in sorted(codepoints):
        if start is None:
            start = prev = cp
            continue
        if cp == prev + 1:
            prev = cp
            continue
        out.append((start, prev))
        start = prev = cp
    if start is not None:
        out.append((start, prev))
    return ", ".join(("U+%04X" % a) if a == b else ("U+%04X-%04X" % (a, b)) for a, b in out)


def subset_font(source, out_path, codepoints):
    font = TTFont(source)
    opts = subset.Options()
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.name_legacy = True
    opts.notdef_outline = True
    opts.drop_tables = ["BASE", "VORG", "vhea", "vmtx"]
    opts.recalc_bounds = False
    subsetter = subset.Subsetter(options=opts)
    subsetter.populate(unicodes=sorted(codepoints))
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(out_path)
    with open(out_path, "rb") as fh:
        digest = hashlib.sha256(fh.read()).hexdigest()
    return {"file": os.path.basename(out_path), "glyphs": len(codepoints),
            "bytes": os.path.getsize(out_path), "sha256": digest,
            "unicodeRange": ranges_of(codepoints), "codepoints": sorted(codepoints)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="rust/fonts/display-serif-cjk.source.woff2")
    ap.add_argument("--charset", default="rust/fonts/display-charset.json")
    ap.add_argument("--out", default="public/fonts")
    ap.add_argument("--slices", type=int, default=6)
    ap.add_argument("--prefix", default="display-serif-cjk")
    ap.add_argument("--manifest", default="rust/fonts/display-font-manifest.json")
    ap.add_argument("--css", default="rust/fonts/font-face.generated.css")
    args = ap.parse_args()

    cmap = set(TTFont(args.source).getBestCmap().keys())
    charset = json.load(open(args.charset, encoding="utf-8"))
    first = set(ord(c) for c in charset["firstScreenUnion"])
    whole = set(ord(c) for c in charset["wholePageUnion"])
    safety = set(map(ord, "0123456789。，、！？：；（）「」『』【】…—～·./×+-:：%¥"))
    pkg_a = (first | whole | safety) & cmap
    rest = sorted(cmap - pkg_a)
    per = -(-len(rest) // args.slices)

    os.makedirs(args.out, exist_ok=True)
    packages = []
    a = subset_font(args.source, os.path.join(args.out, args.prefix + "-a.woff2"), pkg_a)
    a["name"] = "a"
    packages.append(a)
    for i in range(args.slices):
        part = rest[i * per:(i + 1) * per]
        if not part:
            continue
        s = subset_font(args.source, os.path.join(args.out, "%s-s%d.woff2" % (args.prefix, i + 1)), part)
        s["name"] = "s%d" % (i + 1)
        packages.append(s)

    total = sum(p["bytes"] for p in packages)
    manifest = {
        "source": os.path.basename(args.source),
        "sourceBytes": os.path.getsize(args.source),
        "sourceGlyphs": len(cmap),
        "firstScreenUnion": sorted(first),
        "sliceCount": args.slices,
        "packages": packages,
        "totalBytes": total,
    }
    with open(args.manifest, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    css_lines = []
    for p in packages:
        css_lines.append("@font-face {")
        css_lines.append("  font-family: 'CS Display Serif';")
        css_lines.append("  font-style: normal;")
        css_lines.append("  font-display: swap;")
        css_lines.append("  font-weight: 900;")
        css_lines.append("  src: url('/fonts/%s') format('woff2');" % p["file"])
        css_lines.append("  unicode-range: %s;" % p["unicodeRange"])
        css_lines.append("}")
    with open(args.css, "w", encoding="utf-8") as fh:
        fh.write("\n".join(css_lines) + "\n")

    print("源：%s（%d 字形 / %d B）" % (os.path.basename(args.source), len(cmap), manifest["sourceBytes"]))
    for p in packages:
        print("  %-4s %4d 字形 %7d B  %s" % (p["name"], p["glyphs"], p["bytes"], p["file"]))
    print("A 包 %d B（首屏要下的就是它）；全部 %d 个包合计 %d B（懒加载面）" % (packages[0]["bytes"], len(packages), total))
    print("已写 %s 与 %s" % (args.manifest, args.css))
    return 0


if __name__ == "__main__":
    sys.exit(main())
