# -*- coding: utf-8 -*-
"""
验证 public/images/ 目录下所有商品图片的有效性。
检查：文件存在 + size > 10KB + 有效图片格式。
"""
import os
import re
from pathlib import Path

# ⚠️ 2026-09-23 修复（两处「判据自身坏了」的假失败，R263 同族）：
#  ① 路径漂移：原写死 r'C:\Users\37533\Desktop\超市web\supermarket-web\public\images'，
#     少了 `workspace` 一级；项目迁移后该目录不存在 → glob 永远 0 命中 →
#     脚本每次都报「缺失 49/49、覆盖率 0%」却仍 exit 0（静默的全面假失败），
#     任何人都可能据此误判「图片全丢了」。
#     改为从脚本自身位置推导，脚本在哪都不会再漂移。
#  ② 期望订单号写死 1–49，而实际商品已到 55（且图片也是 55 张）→ 口径过期。
#     改为从商品数据源 src/data/products-seed.ts 现场提取，新增商品自动跟上。
#
# ⚠️ 2026-09-28 第四十八轮（R48-H1）：**这条门禁的判据自己一直是永绿的**。
#  一手证据（本机 @15:3x）：合成面里 seed 有 3 个 order、images 只有 2 张合法 WebP，
#  脚本如实印出「缺失图片 (1/3)｜覆盖率 66%」，**退出码仍是 0** —— 因为 `main()` 从不返回、
#  `__main__` 也不 `sys.exit`。上面 ① 那次修复在注释里点名了"静默的全面假失败"，
#  但只修了路径漂移，**没修沉默本身**，于是它至今不在任何阻断链上（`verify` 与 CI 都不跑它）。
#  本轮改动：`main()` 返回缺陷数、`__main__` 用它 `sys.exit()`；"读不到数据源"不再兜底成 1–49
#  而是单独记 UNVERIFIED/rc=2（兜底会把"分母读不到"伪装成"有 49 件且都合格"）；图片目录失踪同样
#  记 rc=2 —— 空集不等于零覆盖，这是上一轮 G14 立下的户内口径。三档：0 全绿 / 1 真有缺失或无效 / 2 没有对象可判。
import sys

PROJECT_ROOT = Path(__file__).resolve().parent.parent
IMAGES_DIR = PROJECT_ROOT / 'public' / 'images'
SEED_FILE = PROJECT_ROOT / 'src' / 'data' / 'products-seed.ts'


def load_expected_orders():
    """从商品数据源提取应有的 order 集合。

    返回 (orders, err)：**读不到 / 零命中都返回 err**，不再退回 1–49 ——
    旧兜底的形状是"数据源坏了也照样能判"，而那正是把"没量到"当"量到了"的写法（第四十七轮 ④-b 同族）。
    """
    try:
        text = SEED_FILE.read_text(encoding='utf-8')
    except OSError as exc:
        return None, f'商品数据源读不到：{SEED_FILE}（{type(exc).__name__}: {exc}）'
    orders = {int(m) for m in re.findall(r'\border:\s*(\d+)', text)}
    if not orders:
        return None, f'商品数据源里 `order:` 零命中（{SEED_FILE}）⇒ 应有图片集为空，没有对象可判'
    return orders, None


EXPECTED_ORDERS, SEED_ERROR = load_expected_orders()
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


def main() -> int:
    print('=' * 70)
    print('商品图片验证报告')
    print('=' * 70)

    # 两条"没有对象可判"的出口先挡住：判据读不到输入时**不得**继续往下算，
    # 否则输出的会是一条长得像结论的假信号（rc 也必须是独立的 2，不与"判出违规"的 1 同形）。
    if SEED_ERROR:
        print(f'[verify-images] UNVERIFIED 应有图片集取不到：{SEED_ERROR}')
        return 2
    if not IMAGES_DIR.is_dir():
        print(f'[verify-images] UNVERIFIED 图片面不存在：{IMAGES_DIR} ⇒ 空集不等于零覆盖，不判"全缺"')
        return 2

    # 收集所有图片文件
    # ⚠️ 2026-09-23 修复：原扩展名白名单漏了 .webp —— 商品图早已全量转成 WebP
    # （本目录 55 张全是 {order}.webp），于是 glob 永远匹配不到任何文件，
    # 脚本每次输出「缺失 49/49、覆盖率 0%」且 exit 0（静默的全面假失败），
    # 而下方 detect_format() 其实早就实现了 WebP 魔数检测（RIFF....WEBP）。
    # 这是一个「判据自身坏了」的假失败（R263 同族），不是图片真的缺失。
    found_files = {}
    for ext in ('.webp', '.jpg', '.jpeg', '.png', '.svg', '.gif'):
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
    # ⚠️ 2026-09-23 修复：原四处分母写死 49，与实际期望数脱钩 ——
    # 输出会出现「54/49，覆盖率 110%」这类自相矛盾的报告，看起来像脚本坏了。
    total = len(EXPECTED_ORDERS)
    print(f'\n✅ 有效图片 ({len(valid)}/{total}):')
    for order, name, size, fmt in valid:
        print(f'  order {order:2d}: {name:20s} {size//1024:4d}KB  {fmt}')

    print(f'\n⚠️  无效/非真实图片 ({len(invalid)}/{total}):')
    for order, name, size, reason in invalid:
        print(f'  order {order:2d}: {name:20s} {size//1024:4d}KB  {reason}')

    print(f'\n❌ 缺失图片 ({len(missing)}/{total}):')
    if missing:
        print(f'  orders: {missing}')
    else:
        print('  (无缺失)')

    print('\n' + '=' * 70)
    real_photo_count = len(valid)
    pct = real_photo_count * 100 // total
    print(f'汇总：真实有效图片 {real_photo_count}/{total}，覆盖率 {pct}%')
    print('=' * 70)

    # 机器结论行（第四十七轮 G14 / 本轮 R48-H1 同一口径）：人读的报告文本一字未改，
    # 只在尾部追加一行**带退出码语义**的结论，让 `verify` 聚合链与 CI 能据此拦下来。
    problems = len(missing) + len(invalid)
    if problems:
        print(f'[verify-images] FAIL 缺失 {len(missing)} / 无效 {len(invalid)} / 应有 {total} ⇒ 合计 {problems} 件不可交付')
        return 1
    print(f'[verify-images] OK {len(valid)}/{total} 全部为有效图片')
    return 0


if __name__ == '__main__':
    sys.exit(main())
