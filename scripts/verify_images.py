# -*- coding: utf-8 -*-
"""
验证 public/images/ 目录下所有商品图片的有效性。
检查：文件存在 + size > 10KB + 有效图片格式。
"""
import os
from pathlib import Path

IMAGES_DIR = Path(r'C:\Users\37533\Desktop\超市web\supermarket-web\public\images')
EXPECTED_ORDERS = set(range(1, 50))  # 1-49
MIN_SIZE = 10 * 1024  # 10KB

# 图片文件头签名
MAGIC_BYTES = {
    b'\xff\xd8\xff': 'jpg',
    b'\x89PNG\r\n\x1a\n': 'png',
    b'GIF87a': 'gif',
    b'GIF89a': 'gif',
    b'<svg': 'svg',
    b'<?xml': 'svg',  # SVG with XML declaration
}

# WebP 格式：RIFF....WEBP（前 4 字节 RIFF，第 8-12 字节 WEBP）
def detect_format(filepath: Path) -> str:
    """通过文件头检测图片格式"""
    try:
        with open(filepath, 'rb') as f:
            head = f.read(16)
        # WebP 检测（RIFF....WEBP）
        if head[:4] == b'RIFF' and head[8:12] == b'WEBP':
            return 'webp'
        for magic, fmt in MAGIC_BYTES.items():
            if head.startswith(magic):
                return fmt
        return 'unknown'
    except Exception:
        return 'error'


def main():
    print('=' * 70)
    print('商品图片验证报告')
    print('=' * 70)

    # 收集所有图片文件
    found_files = {}
    for ext in ('.jpg', '.jpeg', '.png', '.svg', '.gif'):
        for f in IMAGES_DIR.glob(f'*{ext}'):
            try:
                order = int(f.stem)
                found_files[order] = (f, ext)
            except ValueError:
                continue

    # 验证每个文件
    valid = []
    invalid = []
    missing = []

    for order in sorted(EXPECTED_ORDERS):
        if order not in found_files:
            missing.append(order)
            continue
        f, ext = found_files[order]
        size = f.stat().st_size
        fmt = detect_format(f)
        if size < MIN_SIZE:
            invalid.append((order, f.name, size, 'too small'))
        elif fmt == 'unknown':
            invalid.append((order, f.name, size, 'unknown format'))
        elif fmt == 'svg':
            invalid.append((order, f.name, size, 'svg (not real photo)'))
        elif fmt == 'webp':
            valid.append((order, f.name, size, fmt))  # WebP 现代浏览器都支持
        else:
            valid.append((order, f.name, size, fmt))

    # 输出报告
    print(f'\n✅ 有效图片 ({len(valid)}/49):')
    for order, name, size, fmt in valid:
        print(f'  order {order:2d}: {name:20s} {size//1024:4d}KB  {fmt}')

    print(f'\n⚠️  无效/非真实图片 ({len(invalid)}/49):')
    for order, name, size, reason in invalid:
        print(f'  order {order:2d}: {name:20s} {size//1024:4d}KB  {reason}')

    print(f'\n❌ 缺失图片 ({len(missing)}/49):')
    if missing:
        print(f'  orders: {missing}')
    else:
        print('  (无缺失)')

    print('\n' + '=' * 70)
    real_photo_count = len(valid)
    print(f'汇总：真实有效图片 {real_photo_count}/49，覆盖率 {real_photo_count*100//49}%')
    print('=' * 70)


if __name__ == '__main__':
    main()
