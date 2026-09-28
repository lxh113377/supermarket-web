# -*- coding: utf-8 -*-
"""
为缺失的 36 个商品生成 SVG 占位图（按分类着色 + 商品名 + 规格 + order 编号）。
已有 13 张 jpg 的 order：1,5,6,8,14,18,22,24,32,33,38,46,49
"""
import os
from pathlib import Path

# 49 个商品（从 products-seed.js 复制）
PRODUCTS = [
    ('康师傅冰糖雪梨', '1L', 1, 'sweet'),
    ('康师傅青梅绿茶', '1L', 2, 'sweet'),
    ('康师傅金桔柠檬', '1L', 3, 'sweet'),
    ('康师傅冰糖红西柚', '1L', 4, 'sweet'),
    ('康师傅绿茶', '1L', 5, 'tea'),
    ('康师傅冰红茶', '1L', 6, 'tea'),
    ('和其正凉茶', '1L', 7, 'tea'),
    ('东方树叶青柑普洱', '900ml', 8, 'tea'),
    ('茶π', '500ml', 9, 'tea'),
    ('统一阿萨姆奶茶', '', 10, 'tea'),
    ('0糖康师傅茉莉龙井', '500ml', 11, 'low_sugar'),
    ('0糖康师傅茉莉花茶', '500ml', 12, 'low_sugar'),
    ('低糖元气森林冰茶', '900ml', 13, 'low_sugar'),
    ('水溶c100', '', 14, 'vitamin'),
    ('维他命', '农夫山泉500ml', 15, 'vitamin'),
    ('盒装东鹏特饮', '250ml', 16, 'energy'),
    ('瓶装东鹏特饮', '250ml', 17, 'energy'),
    ('东鹏特饮', '500ml', 18, 'energy'),
    ('罐装魔爪', '330ml', 19, 'energy'),
    ('猎兽功能饮料', '500ml', 20, 'energy'),
    ('外星人补水电解质专业版', '500ml', 21, 'energy'),
    ('有糖可乐', '罐装330ml', 22, 'soda'),
    ('景田饮用水', '1.5L', 23, 'water'),
    ('农夫山泉矿泉水', '1.5L', 24, 'water'),
    ('怡宝矿泉水', '2.08L', 25, 'water'),
    ('冰露饮用水', '550ml', 26, 'water'),
    ('农夫山泉矿泉水', '550ml', 27, 'water'),
    ('哇哈哈矿泉水', '550ml', 28, 'water'),
    ('怡宝矿泉水', '550ml', 29, 'water'),
    ('百岁山矿泉水', '570ml', 30, 'water'),
    ('熊博士软糖', '22g', 31, 'snacks'),
    ('士力架', '两条装', 32, 'snacks'),
    ('乐事薯片', '40g', 33, 'snacks'),
    ('呀土豆薯条', '40g', 34, 'snacks'),
    ('彩虹糖', '30g', 35, 'snacks'),
    ('好多鱼', '', 36, 'snacks'),
    ('旺旺小小酥', '18g', 37, 'snacks'),
    ('卫龙大面筋辣条', '', 38, 'snacks'),
    ('仔仔棒', '', 39, 'snacks'),
    ('好丽友好有趣薯片', '40g', 40, 'snacks'),
    ('光头哇一根葱', '', 41, 'snacks'),
    ('纳宝帝nabati威化饼干', '16g', 42, 'snacks'),
    ('脆脆鲨', '', 43, 'snacks'),
    ('山椒猪皮', '', 44, 'snacks'),
    ('乌梅干', '', 45, 'snacks'),
    ('白象方便面', '帮泡+可选十三香/麻辣香/山西老陈醋', 46, 'filling'),
    ('白象方便面', '零售', 47, 'filling'),
    ('乡巴佬卤蛋', '', 48, 'filling'),
    ('双汇火腿肠', '', 49, 'filling'),
]

# 分类配色（主色 + 浅背景 + 中文名）
CATEGORY_STYLE = {
    'sweet':      ('#DB2777', '#FDF2F8', '甜口饮品'),
    'tea':        ('#16A34A', '#F0FDF4', '茶饮'),
    'low_sugar':  ('#2563EB', '#EFF6FF', '低糖饮品'),
    'vitamin':    ('#CA8A04', '#FEFCE8', '维生素'),
    'energy':     ('#DC2626', '#FEF2F2', '提神饮料'),
    'soda':       ('#4B5563', '#F9FAFB', '碳酸'),
    'water':      ('#0891B2', '#ECFEFF', '矿泉水'),
    'snacks':     ('#EA580C', '#FFF7ED', '零食'),
    'filling':    ('#D97706', '#FEF3C7', '垫腹'),
}

# 已有真实 jpg 的 order
HAS_JPG = {1, 5, 6, 8, 14, 18, 22, 24, 32, 33, 38, 46, 49}

OUTPUT_DIR = Path(r'C:\Users\37533\Desktop\超市web\supermarket-web\public\images')


def escape_xml(s: str) -> str:
    return (s.replace('&', '&amp;')
             .replace('<', '&lt;')
             .replace('>', '&gt;')
             .replace('"', '&quot;')
             .replace("'", '&apos;'))


def make_svg(name: str, spec: str, order: int, cat: str) -> str:
    main_color, bg_color, cat_name = CATEGORY_STYLE.get(cat, ('#4B5563', '#F9FAFB', '商品'))
    # 截断过长名称
    display_name = name if len(name) <= 12 else name[:11] + '…'
    display_spec = spec if len(spec) <= 20 else spec[:19] + '…'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <rect width="400" height="400" fill="{bg_color}"/>
  <rect x="0" y="0" width="400" height="60" fill="{main_color}"/>
  <text x="20" y="38" font-family="-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif" font-size="22" font-weight="700" fill="white">{escape_xml(cat_name)}</text>
  <text x="380" y="38" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif" font-size="18" font-weight="600" fill="white" fill-opacity="0.9">#{order:02d}</text>
  <text x="200" y="200" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif" font-size="72" font-weight="800" fill="{main_color}" fill-opacity="0.25">{order}</text>
  <text x="200" y="280" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif" font-size="26" font-weight="700" fill="#1F2937">{escape_xml(display_name)}</text>
  {f'<text x="200" y="318" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, \'PingFang SC\', \'Microsoft YaHei\', sans-serif" font-size="16" font-weight="500" fill="#6B7280">{escape_xml(display_spec)}</text>' if display_spec else ''}
  <text x="200" y="370" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif" font-size="12" font-weight="400" fill="#9CA3AF">超柿 · chaoshi</text>
</svg>'''


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    generated = 0
    skipped = 0
    for name, spec, order, cat in PRODUCTS:
        if order in HAS_JPG:
            skipped += 1
            continue
        svg_path = OUTPUT_DIR / f'{order}.svg'
        svg_content = make_svg(name, spec, order, cat)
        svg_path.write_text(svg_content, encoding='utf-8')
        generated += 1
        print(f'  generated {order}.svg  ({cat})  {name}')
    print(f'\n✅ 生成 {generated} 张 SVG 占位图，跳过 {skipped} 个已有 jpg 的商品')


if __name__ == '__main__':
    main()
