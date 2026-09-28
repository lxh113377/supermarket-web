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
import json
import urllib.error
import urllib.request

PROJECT_ROOT = Path(__file__).resolve().parent.parent
IMAGES_DIR = PROJECT_ROOT / 'public' / 'images'
# sm/ 是 400w 缩略图面（第五十一轮 R51-H3）。它不是"可选优化"：src/utils/images.ts:29 的
# productSrcSet 把 `sm/{order}.webp 400w` 和 `{order}.webp 800w` 一起交给浏览器，
# 缺一张就是"浏览器选中了不存在的候选图" ⇒ 与主图同分母、不同目录，必须并判。
SM_DIR = IMAGES_DIR / 'sm'
SEED_FILE = PROJECT_ROOT / 'src' / 'data' / 'products-seed.ts'

# ── 现网面（第五十轮 R50-H1）────────────────────────────────────────────────
# 一手实测 @2026-09-28 17:3x：`POST /pub {action:getPublicProducts}` 返回在售 25 条，
# order 集含 **55**；而 `src/data/products-seed.ts`（products 段去重 1..54）与 `db/seed.sql`
# （`parseSeedProducts` 解出 54 行、号集与前者逐号相等）**都没有 55** ⇒ "应有 = seed 的 order"这个
# 分母天生残缺：线上真在卖的商品缺图，这条门禁**永远看不见**。上一轮它把 `55.webp` 报成"无主图"，
# 归因也是假的 —— 55 有主，主在 D1，缺的是 seed 条目。
# 对照上游：`sqlalchemy/alembic` 的 `check` 命令把 metadata 与**运行中的库**做 diff
# （`lib`→`alembic/command.py:320` 起，`script_directory.run_env()` 绑连接后再取 diffs），
# 而不是与一份手抄清单比；`django/django makemigrations --check` 同理（模型 vs 迁移文件）。
# 盲区（本轮同样实测出来的，不得假装没有）：/pub **只回 enabled**，下架项要 ADMIN_KEY ⇒
# 密钥绝不进门禁/日志/CI，所以下架商品的图至今不在任何可判面内，这一条必须印出来而不是沉默。
# 取数失败 ⇒ 现网面记 UNVERIFIED 且**不并入分母**（seed 面的结论与 rc 不受影响），
# 否则这条门禁就变成"取决于这一刻 pages.dev 通不通"，CI 会因网络翻红。
LIVE_URL_DEFAULT = 'https://supermarket-web.pages.dev/pub'
LIVE_TIMEOUT_DEFAULT = 8.0


def load_expected_orders():
    """从商品数据源提取应有的 order 集合。

    返回 (orders, err)：**读不到 / 零命中 / 段锚点丢失都返回 err**，不再退回 1–49 ——
    旧兜底的形状是"数据源坏了也照样能判"，而那正是把"没量到"当"量到了"的写法（第四十七轮 ④-b 同族）。

    第四十九轮再修一处更隐蔽的：`order:` 这个键名在本文件里**有两个语义** —— `categories` 用它排分类顺序
    （实测 11 处），`products` 用它当图片文件名（实测 54 处）。整文件扫描今天靠"去重后仍是 54"侥幸不错
    （两拨号段重叠），但只要有人给分类加一个超出商品最大号的 `order`，判据就会报出一条从未发生过的"缺图"。
    ⇒ 取数面必须**按数据流划**（只扫 products 段），不按字段名划。
    """
    try:
        text = SEED_FILE.read_text(encoding='utf-8')
    except OSError as exc:
        return None, f'商品数据源读不到：{SEED_FILE}（{type(exc).__name__}: {exc}）'
    at = text.find('export const products')
    if at == -1:
        return None, (f'分面锚点丢失：{SEED_FILE} 里找不到 `export const products`'
                      ' ⇒ 拒绝退回整文件扫描（那会把 categories 的 order 也算成商品）')
    orders = {int(m) for m in re.findall(r'\border:\s*(\d+)', text[at:])}
    if not orders:
        return None, f'products 段里 `order:` 零命中（{SEED_FILE}）⇒ 应有图片集为空，没有对象可判'
    return orders, None


EXPECTED_ORDERS, SEED_ERROR = load_expected_orders()
MIN_SIZE = 10 * 1024  # 10KB

# sm/ 的地板是**量出来的**，不是抄主图的：本轮实测 `public/images/sm` 55 件，
# 体积 min=4,392B / p10=6,176B / max=39,072B；主图 min=11,994B（对 10,240B 地板余 1,754B）。
# 把主图的 10KB 直接套到缩略图上会一次红掉 44 件 —— 那是判据错，不是资产错。
# 取 2,048B：下界离真实最小值留 2,344B 余量，上界足以抓住"空壳/占位/截断"这类坏件
# （12B 的裸 RIFF 头过不了这里，也过不了魔数）。
# 反过来"缩略图比某些主图还大"（实测 max 39,072 > 主图 min 11,994）**只报不判**：
# 两侧区间重叠 ⇒ 没有可分的阈值 ⇒ 按既有规「改机制而非调参」，这里先不下判。
SM_MIN_SIZE = 2 * 1024  # 2KB


def fetch_live_orders(url: str, timeout: float):
    """取现网在售商品里**依赖本地图**的 order 集，返回 `(orders|None, err|None, notes)`。

    与 `load_expected_orders()` 同形：**取不到就返回 err**，绝不返回空集冒充"线上没货"
    （④-b「读不动不得写成结论为否」）。

    为什么只收"`image` 字段为空"的那些：前端取图的唯一真相源是
    `src/utils/images.ts:21` 的 `productImageUrl(order) ⇒ /images/{order}.webp`，
    而四个调用点（`ProductCard.tsx:35`、`ProductGallery.tsx:57`、`ProductDetailPage.tsx:71`、
    `admin/ProductRow.tsx:25`）都是 `product.image || productImageUrl(order)` ——
    带自定义 `image` 的商品根本不碰本地件，把它算进分母就是凭空造红。
    实测 @2026-09-28 17:3x：现网在售 25 条的 `image` **全为空串** ⇒ 本轮 25 条全部入分母。
    """
    body = json.dumps({'action': 'getPublicProducts', 'payload': {}}).encode('utf-8')
    req = urllib.request.Request(url, data=body, method='POST',
                                headers={'content-type': 'application/json',
                                         'user-agent': 'supermarket-web-verify-images/1.0 (gate)'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read()
    except urllib.error.HTTPError as exc:
        return None, f'现网返回 HTTP {exc.code}（{url}）', []
    except (urllib.error.URLError, OSError) as exc:
        return None, f'现网取不到：{type(exc).__name__}: {getattr(exc, "reason", exc)}（{url}，超时 {timeout}s）', []
    try:
        parsed = json.loads(raw.decode('utf-8'))
    except (ValueError, UnicodeDecodeError) as exc:
        return None, f'现网响应不是合法 JSON：{type(exc).__name__}: {exc}', []
    if not isinstance(parsed, dict) or parsed.get('code') != 0 or not isinstance(parsed.get('data'), list):
        code = parsed.get('code') if isinstance(parsed, dict) else type(parsed).__name__
        return None, f'现网响应形状不对：code={code} data={type(parsed.get("data")).__name__ if isinstance(parsed, dict) else "-"} ⇒ 不判"线上没货"', []
    orders, no_order, custom_image = set(), [], 0
    for item in parsed['data']:
        if not isinstance(item, dict):
            no_order.append(str(item)[:24])
            continue
        if str(item.get('image') or '').strip():
            custom_image += 1
            continue
        order = item.get('order')
        if isinstance(order, bool) or not isinstance(order, (int, float)) or int(order) != order:
            no_order.append(str(item.get('_id') or item.get('name') or '?')[:24])
            continue
        orders.add(int(order))
    notes = []
    if custom_image:
        notes.append(f'另 {custom_image} 条带自定义 image 字段 ⇒ 不依赖本地件，不入分母（其 URL 可达性本门禁不判）')
    if no_order:
        notes.append(f'{len(no_order)} 条在售商品没有可用 order ⇒ 无图可判，请人看一眼（{", ".join(no_order[:5])}）')
    return orders, None, notes



def fetch_live_catalog(url: str, timeout: float):
    """取商品**全集**（含下架）的 `{order, needsLocalImage}`，返回 `(entries|None, err|None, notes)`。

    第五十一轮 R51-H1。与 `fetch_live_orders` 同形：**取不到就返回 err**，绝不返回空集冒充
    "目录里没东西"。为什么在售面不够：`getPublicProducts` 的 SQL 带 `WHERE enabled = 1`，
    下架商品在**任何不带密钥的面上都不可见**，而密钥按 AGENTS.md 红线绝不进 CI/日志 ⇒
    "下架项缺一张图"这件事，上一轮只在输出里点了名，从没被判过。

    该 action 未部署时（本轮 push 之前必然如此）线上按 `action_not_public` 回 code=-1，
    本函数如实返回 err ⇒ 全集面记 UNVERIFIED、不并入分母。这条腿在部署完成后自动开始生效。
    """
    body = json.dumps({'action': 'getCatalogOrders', 'payload': {}}).encode('utf-8')
    req = urllib.request.Request(url, data=body, method='POST',
                                headers={'content-type': 'application/json',
                                         'user-agent': 'supermarket-web-verify-images/1.0 (gate)'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read()
    except urllib.error.HTTPError as exc:
        return None, f'现网全集面返回 HTTP {exc.code}（{url}）', []
    except (urllib.error.URLError, OSError) as exc:
        return None, (f'现网全集面取不到：{type(exc).__name__}: {getattr(exc, "reason", exc)}'
                      f'（{url}，超时 {timeout}s）'), []
    try:
        parsed = json.loads(raw.decode('utf-8'))
    except (ValueError, UnicodeDecodeError) as exc:
        return None, f'现网全集面响应不是合法 JSON：{type(exc).__name__}: {exc}', []
    if not isinstance(parsed, dict) or parsed.get('code') != 0 or not isinstance(parsed.get('data'), list):
        code = parsed.get('code') if isinstance(parsed, dict) else type(parsed).__name__
        return None, (f'现网全集面形状不对：code={code}（多半是该 action 还没上线 ⇒ 记未验证，'
                      '不读成"目录里没商品"）'), []
    entries, bad = {}, []
    for item in parsed['data']:
        if not isinstance(item, dict):
            bad.append(str(item)[:24])
            continue
        order = item.get('order')
        need = item.get('needsLocalImage')
        if isinstance(order, bool) or not isinstance(order, (int, float)) or int(order) != order \
                or not isinstance(need, bool):
            bad.append(str(item)[:24])
            continue
        entries[int(order)] = need
    notes = []
    if bad:
        notes.append(f'{len(bad)} 条目录项没有可用的 order/needsLocalImage 对 ⇒ 无图可判，请人看一眼'
                     f'（{", ".join(str(b) for b in bad[:5])}）')
    # 全量形状不合 ⇒ **未验证**，不是"目录里 0 件"。一手：本轮第一版让线上 403 走空集出口，
    # 输出印成"现网目录全集需本地件 0 号"—— 一条从没量到的面被写成量到了且没问题，
    # 与户内「盲区不得复用成零」同族；被自家夹具（桩把两个 action 答成同一份）当场抓到。
    if parsed['data'] and not entries:
        return None, (f'现网全集面 {len(parsed["data"])} 条里**零条**可用'
                      f'（形状不合 ⇒ 服务端返回的不是 {{order, needsLocalImage}}）'
                      '⇒ 该面未验证，不读成"目录里没商品"'), notes
    return entries, None, notes


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

    # 现网面解析（R50-H1）。三种结果分开走：取到 ⇒ 并入分母；显式关闭 ⇒ 说明是被关的；
    # 取不到 ⇒ **只声明盲区**，seed 面的结论与 rc 一律不变（禁把"没量到"并进分母，也禁并进"全绿"措辞）。
    seed_orders = set(EXPECTED_ORDERS)
    live_mode = (os.environ.get('VERIFY_IMAGES_LIVE') or 'on').strip().lower()
    live_url = (os.environ.get('VERIFY_IMAGES_LIVE_URL') or LIVE_URL_DEFAULT).strip()
    timeout_raw = (os.environ.get('VERIFY_IMAGES_LIVE_TIMEOUT') or '').strip()
    live_notes = []
    if timeout_raw:
        try:
            live_timeout = float(timeout_raw)
        except ValueError:
            live_timeout = LIVE_TIMEOUT_DEFAULT
            live_notes.append(f'超时入参非法（{timeout_raw!r}）⇒ 用默认 {LIVE_TIMEOUT_DEFAULT}s')
    else:
        live_timeout = LIVE_TIMEOUT_DEFAULT
    if live_mode == 'off':
        live_orders, live_err = None, '现网面被显式关闭（`VERIFY_IMAGES_LIVE=off`）'
        catalog_orders, catalog_err = None, '同上（现网面整体关闭）'
    else:
        live_orders, live_err, live_notes = fetch_live_orders(live_url, live_timeout)
        # 全集面（R51-H1）：同一个 URL、另一个 action。取不到只让**这一面**记未验证。
        catalog_entries, catalog_err, catalog_notes = fetch_live_catalog(live_url, live_timeout)
        live_notes = live_notes + catalog_notes
        # 取不到 ⇒ 必须是 None，**不能**是空集：空集会被读成「目录里 0 件要本地图」，
        # 而真相是「这一面根本没量到」。本轮第一版就在这里把线上 403 咽成了 0 号（实测），
        # 正是户内「盲区不得复用成零」那条规的又一次复发。
        catalog_orders = ({o for o, need in catalog_entries.items() if need}
                          if catalog_entries is not None else None)
    # 只收 needsLocalImage=true 的号：带自定义 image 的商品根本不碰本地件，算进来就是凭空造红。
    expected = seed_orders | (live_orders or set()) | (catalog_orders or set())
    live_extra = sorted((live_orders or set()) - seed_orders)
    catalog_extra = sorted((catalog_orders or set()) - seed_orders - (live_orders or set()))
    # 自证（第五十轮）：结论行会印"seed N ∪ 现网 M ⇒ 并集 T"，那就必须真的相等。
    # 这条守卫让"把 expected 改成别的来源"这类改动**当场失效**，而不是印出一行自相矛盾的覆盖面读数
    # （②-d：变异腿要能在守卫正常时被咬住；否则覆盖面那行只是装饰，谁改分母都不会红）。
    union_now = seed_orders | (live_orders or set()) | (catalog_orders or set())
    if expected != union_now:
        print(f'[verify-images] UNVERIFIED 覆盖面自相矛盾：应有集 {len(expected)} 号 ≠ seed ∪ 现网 = {len(union_now)} 号'
              ' ⇒ 判据自己的取数被改坏了，不据它下任何结论')
        return 2


    # 收集所有图片文件
    # ⚠️ 2026-09-23 修复：原扩展名白名单漏了 .webp —— 商品图早已全量转成 WebP
    # （本目录 55 张全是 {order}.webp），于是 glob 永远匹配不到任何文件，
    # 脚本每次输出「缺失 49/49、覆盖率 0%」且 exit 0（静默的全面假失败），
    # 而下方 detect_format() 其实早就实现了 WebP 魔数检测（RIFF....WEBP）。
    # 这是一个「判据自身坏了」的假失败（R263 同族），不是图片真的缺失。
    IMAGE_EXTS = ('.webp', '.jpg', '.jpeg', '.png', '.svg', '.gif')

    def collect_numeric(dir_path):
        found = {}
        for ext in IMAGE_EXTS:
            for f in dir_path.glob(f'*{ext}'):
                try:
                    order = int(f.stem)
                except ValueError:
                    continue
                found[order] = (f, ext)
        return found

    found_files = collect_numeric(IMAGES_DIR)
    # sm/ 面（R51-H3）：目录不存在 ⇒ 该面 UNVERIFIED（空集 ≠ 全缺），与主图面的处理同形。
    sm_found = collect_numeric(SM_DIR) if SM_DIR.is_dir() else None

    # 验证每个文件
    valid = []
    invalid = []
    missing = []

    for order in sorted(expected):
        if order not in found_files:
            missing.append(order)
            continue
        f, ext = found_files[order]
        size = f.stat().st_size
        fmt = detect_format(f)
        if size < MIN_SIZE:
            invalid.append((order, f.name, size, 'too small'))
        elif fmt in ('unknown', 'error'):
            # 'error' = detect_format 读文件时抛了异常。旧代码只拦 'unknown'，于是"读不动的件"
            # 会掉进末尾的 else 分支被记成**有效**（静态读到，本轮未造出实测红样本 ⇒ 记为未验证的加固）。
            invalid.append((order, f.name, size, 'unknown/unreadable format'))
        elif fmt == 'svg':
            invalid.append((order, f.name, size, 'svg (not real photo)'))
        elif fmt == 'webp':
            valid.append((order, f.name, size, fmt))  # WebP 现代浏览器都支持
        else:
            valid.append((order, f.name, size, fmt))

    # 输出报告
    # ⚠️ 2026-09-23 修复：原四处分母写死 49，与实际期望数脱钩 ——
    # 输出会出现「54/49，覆盖率 110%」这类自相矛盾的报告，看起来像脚本坏了。
    total = len(expected)
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

    # ── sm/ 缩略图面（第五十一轮 R51-H3）：与主图**同分母、不同目录**，各出一行分母 ──
    # 两个计数器各自独立：写成 `sm_missing = sm_invalid = []` 会让它们指向同一个列表，于是
    # 「缺 1 张」被同时记进缺失与无效（合计翻倍），且下面按元组解包 invalid 时直接崩（第五十二轮实测）。
    sm_missing = []
    sm_invalid = []
    # 未量到的面**不许**有一行「没多余」的读数（盲区 ≠ 零，户内 G14 同口径），所以初值取 None 而不是空串。
    sm_orphan_line = None
    if sm_found is None:
        sm_note = f'sm 面 UNVERIFIED：目录不存在（{SM_DIR}）⇒ 空集不等于零覆盖，不判"全缺"'
    else:
        sm_note = None
        for order in sorted(expected):
            if order not in sm_found:
                sm_missing.append(order)
                continue
            f, ext = sm_found[order]
            size = f.stat().st_size
            fmt = detect_format(f)
            if fmt in ('unknown', 'error'):
                sm_invalid.append((order, f.name, size, 'unknown/unreadable format'))
            elif size < SM_MIN_SIZE:
                sm_invalid.append((order, f.name, size, f'too small (<{SM_MIN_SIZE}B)'))
        # 反向半边（第五十二轮 R52-H3）：sm/ 里"应有集之外"的件。与主图 orphan 同族 ⇒
        # **只点名不判红**（删资产是归属决定，判等于逼运营回滚），但必须先能看见 ——
        # 上一轮这一面完全没有反向腿，于是"sm 里堆了一堆没人引用的旧缩略图"在输出上与"没堆"同形。
        sm_orphans = sorted(set(sm_found) - set(expected))
        sm_orphan_line = ('  sm 反向半边：{} 件缩略图不在应有集内（{}）⇒ 请确认是谁在用，或随 seed 一起清'
                          .format(len(sm_orphans), ', '.join(str(o) for o in sm_orphans[:12]))
                          if sm_orphans else '  sm 反向半边：无多余缩略图')
        sm_sizes = sorted(p.stat().st_size for p, _ in sm_found.values()) if sm_found else []
        if sm_sizes:
            sm_note = (f'sm 面：{len(sm_found)} 件，实测体积 min={sm_sizes[0]}B '
                       f'对地板 {SM_MIN_SIZE}B 余 {sm_sizes[0] - SM_MIN_SIZE}B'
                       f'（上限只报不判：max={sm_sizes[-1]}B 与主图 min 区间重叠 ⇒ 无可分阈值）')
    sm_problems = len(sm_missing) + len(sm_invalid)

    # 反向半边（第四十九轮立，第五十轮**改判归因**）：图有、应有集里没有。
    # 上一轮把这一类统一叫"无主图"，实测是**假归因**：`55.webp` 有主 —— 主人是现网在售的
    # 「润田矿泉水」（`_id: p_mtsp7bx9t0nn3f`，`image` 为空 ⇒ 前端按 `utils/images.ts:21` 回落到
    # `/images/55.webp`），缺的是 **seed 条目**，不是"没人用的资产"。
    # ⇒ 孤儿按归属拆开说；且现网面没量到时**不得**断言"无主"，只能说"seed 不要它"。
    # 仍**只点名不判红**：补 seed 还是删图是归属决定（第十一轮 R11-H3 同口径 —— 判红等于逼运营回滚）。
    orphans = sorted(set(found_files) - expected)
    orphan_qualifier = '' if live_orders is not None else '（现网面未量到 ⇒ 这里只说明 seed 不要它，不足证无主）'
    face_parts = [f'seed {len(seed_orders)}']
    face_parts.append(f'现网在售依赖本地件 {len(live_orders)} 号' if live_orders is not None
                      else f'现网在售 UNVERIFIED：{live_err}')
    face_parts.append(f'现网目录全集需本地件 {len(catalog_orders)} 号' if catalog_orders is not None
                      else f'现网目录全集 UNVERIFIED：{catalog_err}')
    print('\n🧭 覆盖面：' + ' · '.join(face_parts) + f' ⇒ 并集 {total} 号')
    for note in live_notes:
        print(f'  · {note}')
    if live_extra:
        print(f'  ⚠️ seed 落后于现网：{live_extra} 这些号现网在售而 seed 里没有 ⇒ 应有集本轮靠现网面兜住')
    if catalog_extra:
        print(f'  ⚠️ seed 与在售都不要、但目录里出现过：{catalog_extra} ⇒ 这些是**下架项**，'
              '它们的图本轮起进分母（R51-H1 前的盲区）')
    if sm_note:
        print(f'  · {sm_note}')
    if sm_orphan_line:
        print(sm_orphan_line)
    print(f'\n⚠️  无主图片 ({len(orphans)}){orphan_qualifier}:')
    for order in orphans:
        print(f'  order {order:2d}: {found_files[order][0].name:20s}（seed 与现网在售都不要它 ⇒ 请确认是谁在用，或改名进 seed）')
    if not orphans:
        print('  (无孤儿图)')
    if catalog_orders is None:
        print('  盲区（不得当成已判）：下架商品的图仍未判 —— 全集面取不到（多半是 /pub 的 '
              'getCatalogOrders 还没部署）。该 action 上线后本行自动消失。')
    print('  仍未判的盲区：现网带自定义 image 的条目其 URL 可达性（本门禁只判本地件，不判外链）。')

    print('\n' + '=' * 70)
    real_photo_count = len(valid)
    pct = real_photo_count * 100 // total
    print(f'汇总：真实有效图片 {real_photo_count}/{total}，覆盖率 {pct}%')
    print('=' * 70)

    # 机器结论行（第四十七轮 G14 / 第四十八轮 R48-H1 同一口径）：人读的报告文本不改语义，
    # 尾部的结论行**必须点名判的是哪个面** —— 上一轮这行只印裸分母，于是"现网面根本没量"与
    # "两个面都量过"在输出上长得一模一样（分母 54 vs 55 是唯一线索，而没人会去数）。
    face_line = (f'面=seed {len(seed_orders)} ∪ 在售 {len(live_orders) if live_orders is not None else "UNVERIFIED"}'
                 f' ∪ 目录 {len(catalog_orders) if catalog_orders is not None else "UNVERIFIED"}')
    problems = len(missing) + len(invalid)
    if problems:
        print(f'[verify-images] FAIL 缺失 {len(missing)} / 无效 {len(invalid)} / 应有 {total}'
              f' ⇒ 合计 {problems} 件不可交付（{face_line}）')
        return 1
    if sm_found is None:
        # 主图面全绿、缩略图面整个取不到 ⇒ 不许印 OK：这是"半边没量"，不是"两半都过"。
        print(f'[verify-images] UNVERIFIED 主图 {len(valid)}/{total} 全绿，但缩略图面没量到（{sm_note}）')
        return 2
    if sm_problems:
        print(f'[verify-images] FAIL 主图齐 {len(valid)}/{total}，但 sm 缩略图 缺失 {len(sm_missing)}'
              f' / 无效 {len(sm_invalid)} ⇒ 合计 {sm_problems} 件 srcSet 候选图不可交付（目录={SM_DIR.name}/，{face_line}）')
        if sm_missing:
            print(f'  sm 缺失 orders: {sm_missing}')
        for order, name, size, reason in sm_invalid:
            print(f'  sm order {order}: {name} {size}B  {reason}')
        return 1
    print(f'[verify-images] OK 主图 {len(valid)}/{total} + 缩略图 {total}/{total} 全部有效'
          f'（{face_line}）'
          + (f'（另有 {len(orphans)} 张无主图，见上：不拦，但请有人认领）' if orphans else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
