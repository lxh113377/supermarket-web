#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""中文展示体分包生成器（首屏包 + 码点切片 + 缺字补包）。

第 92 轮：把 `display-serif-cjk.source.woff2`（932 字形，从思源宋体切出）切成
A 包（首屏 + 首屏路由整页）+ s1..s6（按需）。

第 93 轮加了第二件事：**补 557 个缺字**。
  实测：站内用到的 CJK 面 1,486 种，原分包只覆盖 922 ⇒ 564 种走系统回退（字体风格不一致）。
  其中 562 种能在全字库里找到（另 2 个是变体选择符/BOM，不是字形需求）。
  处置 = 用一个**补包** `display-serif-cjk-ext.woff2` 填上：它与现有 7 个包的 unicode-range
  **不重叠**，现有包一个字节都不动 ⇒ 已覆盖字形的渲染逐像素不变（风险最小的填法）。

为什么补包的源要 vendor 进仓：全字库（思源宋体 CN Heavy，14.85 MB）是本机外部资产。
  `--vendor-ext --ttf <路径>` 一次性把它按「用到且可补」的字形集切成
  `rust/fonts/display-serif-cjk-ext.source.woff2`（1,494 字形 / 270,312 B）入仓，
  之后所有构建都从仓内源复现，不依赖那台机器上的字体文件。

用法：
  python rust/scripts/split-display-font.py                       # 现状的 7 个包
  python rust/scripts/split-display-font.py --with-ext             # 7 个包 + 补包（含 manifest/CSS）
  python rust/scripts/split-display-font.py --vendor-ext --ttf <全字库路径>
"""

import argparse
import hashlib
import json
import os
import sys

from fontTools.ttLib import TTFont
from fontTools import subset


def ranges_of(codepoints):
    """码点列表 → unicode-range 文本（连续段 a-b，单点 a）。"""
    out, start, prev = [], None, None
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
    """按码点集合产出 woff2 子集；选项都以「不改渲染」为准（见文件头与 docs/07）。"""
    font = TTFont(source)
    opts = subset.Options()
    opts.layout_features = ["*"]        # 保留全部排版特性（默认只留常用集，中文标点字距会变）
    opts.name_IDs = ["*"]
    opts.name_legacy = True
    opts.notdef_outline = True
    opts.recalc_bounds = False
    opts.drop_tables = ["BASE", "VORG", "vhea", "vmtx"]   # 只服务竖排；本站无竖排文本
    subsetter = subset.Subsetter(options=opts)
    subsetter.populate(unicodes=sorted(codepoints))
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(out_path)
    with open(out_path, "rb") as fh:
        digest = hashlib.sha256(fh.read()).hexdigest()
    return {
        "file": os.path.basename(out_path),
        "glyphs": len(codepoints),
        "bytes": os.path.getsize(out_path),
        "sha256": digest,
        "unicodeRange": ranges_of(codepoints),
        "codepoints": sorted(codepoints),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="rust/fonts/display-serif-cjk.source.woff2")
    ap.add_argument("--charset", default="rust/fonts/display-charset.json")
    ap.add_argument("--ext-source", default="rust/fonts/display-serif-cjk-ext.source.woff2")
    ap.add_argument("--ext-charset", default="rust/fonts/display-charset-ext.json")
    ap.add_argument("--out", default="public/fonts")
    ap.add_argument("--slices", type=int, default=6)
    ap.add_argument("--prefix", default="display-serif-cjk")
    ap.add_argument("--manifest", default="rust/fonts/display-font-manifest.json")
    ap.add_argument("--css", default="rust/fonts/font-face.generated.css")
    ap.add_argument("--with-ext", action="store_true", help="同时生成缺字补包（写进 manifest/CSS）")
    ap.add_argument("--vendor-ext", action="store_true", help="从外部全字库切出仓内 vendor 源（一次性）")
    ap.add_argument("--ttf", default="", help="--vendor-ext 时的全字库路径")
    ap.add_argument("--css-only", action="store_true",
                    help="只按 **manifest 的权威值** 重出 CSS 片段（不重切）——见下面 why 注释")
    ap.add_argument("--sync-manifest", action="store_true",
                    help="只把 manifest 的 sha/体积按**盘上现有分包**同步（不重切）—— 见下面 why 注释")
    args = ap.parse_args()

    # ── css 模式：只按 manifest 重出 CSS ──
    # 为什么要有它：第一版里 CSS 与 manifest 是**两条独立产出路径**（前者用生成时的 fill 集合，
    # 后者可被 --sync-manifest 按盘上文件校准），于是 ext 包的 unicode-range 两边差了几个码点
    # —— 判据当场判红。修法不是「再仔细点」，而是让 CSS **从 manifest 生成**：一份事实一个出口。
    if args.css_only:
        manifest = json.load(open(args.manifest, encoding="utf-8"))
        ordered = list(manifest["packages"]) + ([manifest["ext"]] if "ext" in manifest else [])
        lines = []
        for p in ordered:
            lines += ["@font-face {", "  font-family: 'CS Display Serif';", "  font-style: normal;",
                      "  font-display: swap;", "  font-weight: 900;",
                      "  src: url('/fonts/%s') format('woff2');" % p["file"],
                      "  unicode-range: %s;" % p["unicodeRange"], "}"]
        with open(args.css, "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
        print("已按 manifest 重出 %s（%d 条 @font-face）" % (args.css, len(ordered)))
        return 0

    # ── sync 模式：只校 manifest，不重切 ──
    # 为什么需要它：fontTools 的 CFF 子集化**不保证字节可复现**（实测同一输入两次产出差 12~36 B，
    # 字形集完全相同）。若每次生成都重切，7 个已上线包会无意义地churn（二进制 diff 看不出差异、
    # 却让「这一笔到底改了什么」无法一眼看清）。所以常规流程是：新增/改动包才重切，
    # 改完用 --sync-manifest 把尺寸/sha 校回真实值（判据 check-font-split 只认 manifest ⇄ 盘上文件）。
    if args.sync_manifest:
        manifest = json.load(open(args.manifest, encoding="utf-8"))
        entries = list(manifest["packages"]) + ([manifest["ext"]] if "ext" in manifest else [])
        for e in entries:
            p = os.path.join(args.out, e["file"])
            if not os.path.exists(p):
                print("缺文件 " + p, file=sys.stderr)
                return 2
            cps = sorted(TTFont(p).getBestCmap().keys())
            with open(p, "rb") as fh:
                raw = fh.read()
            e["bytes"] = len(raw)
            e["sha256"] = hashlib.sha256(raw).hexdigest()
            e["glyphs"] = len(cps)
            e["codepoints"] = cps
            e["unicodeRange"] = ranges_of(cps)
        manifest["totalBytes"] = sum(e["bytes"] for e in manifest["packages"])
        if "ext" in manifest:
            manifest["totalWithExtBytes"] = manifest["totalBytes"] + manifest["ext"]["bytes"]
        with open(args.manifest, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        print("manifest 已按盘上现有文件校准：%d 个包" % len(entries))
        return 0

    cmap = set(TTFont(args.source).getBestCmap().keys())
    charset = json.load(open(args.charset, encoding="utf-8"))
    first = set(ord(c) for c in charset["firstScreenUnion"])
    whole = set(ord(c) for c in charset["wholePageUnion"])
    safety = set(map(ord, "0123456789。，、！？：；（）「」『』【】…—～·./×+-:：%¥"))

    # ── vendor 模式：从外部全字库切出「用到且可补」的字形集入仓（一次性）──
    if args.vendor_ext:
        if not args.ttf or not os.path.exists(args.ttf):
            print("--vendor-ext 需要 --ttf <全字库路径>", file=sys.stderr)
            return 2
        ext = json.load(open(args.ext_charset, encoding="utf-8"))
        fill = set(ext["fillable"])
        cur = set()
        for name in ["a"] + ["s%d" % i for i in range(1, args.slices + 1)]:
            p = os.path.join(args.out, "%s-%s.woff2" % (args.prefix, name))
            if os.path.exists(p):
                cur |= set(TTFont(p).getBestCmap().keys())
        info = subset_font(args.ttf, args.ext_source, fill | cur)
        print("vendored 源已落 %s（%d 字形 / %d B）" % (args.ext_source, info["glyphs"], info["bytes"]))
        return 0

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

    manifest = {
        "source": os.path.basename(args.source),
        "sourceBytes": os.path.getsize(args.source),
        "sourceGlyphs": len(cmap),
        "firstScreenUnion": sorted(first),
        "sliceCount": args.slices,
        "packages": packages,
        "totalBytes": sum(p["bytes"] for p in packages),
    }

    if args.with_ext:
        ext_charset = json.load(open(args.ext_charset, encoding="utf-8"))
        have = set()
        for p in packages:
            have |= set(p["codepoints"])
        # 补包只装「用到、全字库有、且现有分包没有」的字形：重叠会让 @font-face 的选择变成顺序赌博
        fill = sorted(set(ext_charset["fillable"]) - have)
        ext_info = subset_font(args.ext_source, os.path.join(args.out, args.prefix + "-ext.woff2"), fill)
        ext_info["name"] = "ext"
        manifest["ext"] = ext_info
        manifest["extSourceBytes"] = os.path.getsize(args.ext_source)
        used = set(ext_charset["usedCjk"])
        manifest["coverage"] = {
            "usedCjk": len(used),
            "coveredBefore": len(ext_charset["covered"]),
            "coveredNow": len(used & (have | set(fill))),
            "stillUncovered": sorted(used - (have | set(fill))),
        }
        manifest["totalWithExtBytes"] = manifest["totalBytes"] + ext_info["bytes"]

    with open(args.manifest, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    ordered = manifest["packages"] + ([manifest["ext"]] if args.with_ext else [])
    css_lines = []
    for p in ordered:
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
    for p in manifest["packages"]:
        print("  %-4s %4d 字形 %7d B  %s" % (p["name"], p["glyphs"], p["bytes"], p["file"]))
    if args.with_ext:
        e = manifest["ext"]
        c = manifest["coverage"]
        print("  ext  %4d 字形 %7d B  %s（补缺字；懒加载）" % (e["glyphs"], e["bytes"], e["file"]))
        print("覆盖：用到 %d｜补前 %d｜补后 %d｜仍缺 %d" % (c["usedCjk"], c["coveredBefore"], c["coveredNow"], len(c["stillUncovered"])))
        print("全部包合计 %d B（补前 %d）" % (manifest["totalWithExtBytes"], manifest["totalBytes"]))
    print("已写 %s 与 %s" % (args.manifest, args.css))
    return 0


if __name__ == "__main__":
    sys.exit(main())
