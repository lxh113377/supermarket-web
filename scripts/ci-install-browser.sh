#!/usr/bin/env bash
# ci-install-browser.sh —— CI 侧 Playwright 浏览器安装（带重试、单次超时、产物自证）
#
# 为什么需要它（第七十二轮 G-72-1，一手证据）：
#   远端 CI run 37677572509 的 e2e 与 e2e-cloud-stub 两个 job 都卡死在 Install Chromium 这一步整整
#   6 小时（e2e 19:51:20Z→次日 01:51:45Z = 6h00m25s；e2e-cloud-stub 19:51:23Z→01:51:36Z = 6h00m13s），
#   被 GitHub 的 6 小时作业硬上限判 cancelled ⇒ deploy 因 needs 被掐掉 skipped
#   ⇒ CI 终态 cancelled ⇒ release-parity（只在 conclusion==success 时跑）也 skipped。
#   同一分钟起跑的第三个 job visual 的同一步花了 13m45s 成功 ⇒ 三路并发拉同一个 CDN，
#   一个过了、两个挂死。根因面只有一句：当时 ci.yml 里 timeout-minutes 出现次数为 0。
#
# 本脚本的三个动作（缺任一都还会重演）：
#   1) 单次有界：每次尝试套 timeout，慢在一处就断在一处，不占满整个作业预算；
#   2) 失败快红：重试耗尽即非 0 退出并打出归因行，让红灯落在十几分钟内而不是 6 小时。
#      安静地挂在 runner 上等到平台杀掉，那样的 step conclusion 只有 cancelled，一个字的归因都没有；
#   3) 产物自证：不信退出码，验浏览器目录真在盘上才算装好。本仓 R55 已记过
#      「6/6 份产物有效却全部 rc=1，崩在写盘之后」这条同族坑；方向相反，同一条教训：
#      rc 与产物是两件事，要判就判盘面。
#
# 用法（CI 侧，仓内只有这一处安装逻辑）：
#   bash scripts/ci-install-browser.sh
# 环境变量（都有默认值，CI 里不改也能跑）：
#   BROWSER=chromium              要装的浏览器
#   BROWSER_ATTEMPTS=2            最大尝试次数
#   BROWSER_ATTEMPT_TIMEOUT_S=900 单次尝试的墙上时钟上限（秒）
#     为什么是 900 而不是 300（2026-10-22 一手 run 39801611566）：本文件上面就记着
#     「冷下载实测 13m45s = 825s」，而单次上限只有 300s ⇒ 冷缓存下第 1 次**必然**被掐死，
#     且掐在 apt-get 事务中间，留下一个还在跑、还持有 dpkg 锁的孤儿进程（日志点名 PID 2788），
#     于是第 2、3 次在 2s / 49s 内以 rc=100 失败 —— 重试被自己的超时毒化，三次全废。
#     900 = 825s 实测 + 余量；配 BROWSER_ATTEMPTS=2 得最坏 2×(900+180)=2160s=36min，
#     故 ci.yml 里跑本脚本的四个 job 超时同步抬到 40 分钟（低于 40 会被平台 cancelled ⇒ 零归因）。
#   BROWSER_RETRY_BACKOFF_S=15    两次尝试之间的等待（秒）
#   BROWSER_LOCK_WAIT_S=180       每次尝试前最多等 dpkg/apt 锁释放多久（秒）
#   BROWSER_LOCK_PROBE=<命令>     锁占用探测面（自证注入用；缺省用 fuser/pgrep，
#                                 两者都不存在时探测返回非 0 ⇒ 视为未占用，退回旧行为不卡死）
# 退出码：0 = 装好且产物在盘 / 1 = 重试耗尽仍装不上（已打归因行）/ 2 = 前置不齐
#
# 自证：bash scripts/ci-install-browser.sh --selftest
#   用合成命令面跑四条腿，判的是行为不是自述。
set -euo pipefail

SELF="$(basename "$0")"
FAKE_STATE_DIR=""

log() { printf '[%s] %s\n' "$SELF" "$*"; }
err() { printf '[%s] ERROR: %s\n' "$SELF" "$*" >&2; }

# 浏览器缓存根。显式读 PLAYWRIGHT_BROWSERS_PATH，是为了让本脚本与 ci.yml 里
# actions/cache 的 path 共用同一处真相源 —— 两处各写一遍就是第二真相源。
browsers_root() {
  if [ -n "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
    printf '%s' "$PLAYWRIGHT_BROWSERS_PATH"
  else
    printf '%s' "${HOME:-/tmp}/.cache/ms-playwright"
  fi
}

# 该浏览器是否真在盘上。目录名随 playwright 版本变（chromium-1234），故按前缀匹配目录，
# 不去猜版本号：猜版本号属于「判据里写死实现细节」那一族，升一次 Playwright 就假红。
# 空目录不算装好（半途中断的残留就是这么留下的）。
browser_present() {
  local root d hit
  root="$(browsers_root)"
  [ -d "$root" ] || return 1
  for d in "$root"/"$1"-*; do
    [ -d "$d" ] || continue
    hit="$(find "$d" -maxdepth 3 -type f \( -name chrome -o -name headless_shell \) 2>/dev/null | head -n 1)"
    if [ -n "$hit" ]; then return 0; fi
  done
  return 1
}

require_prereqs() {
  local missing=0 c
  for c in node npx timeout; do
    command -v "$c" >/dev/null 2>&1 || { err "$c 不在前置面上"; missing=1; }
  done
  command -v timeout >/dev/null 2>&1 || err "本脚本的「单次有界」完全依赖 timeout（GNU coreutils）"
  [ "$missing" -eq 0 ] || return 2
  return 0
}

# 等 dpkg/apt 锁释放。存在的理由（2026-10-22 一手 run 39801611566）：上一轮尝试被超时
# 掐死后，apt-get 事务并不会跟着消失 —— 它成了孤儿进程继续持有 /var/lib/dpkg/lock-frontend，
# 于是下一轮一进去就撞 "E: Could not get lock ... held by process 2788 (apt-get)" 并以
# rc=100 秒失败。**不等锁的重试等于白重试**（三次里有两次是这么废掉的）。
# 探测面可注入（BROWSER_LOCK_PROBE）：本机 Git Bash 没有 fuser/pgrep，自证要能跑就必须可换。
# 缺省探测：fuser 优先（精确到文件），退化到 pgrep -x apt-get；两者都没有 ⇒ 返回非 0
# 视为「未占用」，退回旧行为，绝不因为探测不了而卡死安装。
lock_held() {
  if [ -n "${BROWSER_LOCK_PROBE:-}" ]; then
    bash -c "$BROWSER_LOCK_PROBE" >/dev/null 2>&1
    return $?
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 && return 0
  fi
  if command -v pgrep >/dev/null 2>&1; then
    pgrep -x apt-get >/dev/null 2>&1 && return 0
    pgrep -x apt >/dev/null 2>&1 && return 0
  fi
  return 1
}

# 返回 0=锁已空（含本来就是空）/ 1=等到上限仍被占（调用方照样继续试，只是多一条日志）
wait_for_lock() {
  local budget="${1:-0}" waited=0
  [ "$budget" -eq 0 ] && return 0
  lock_held || return 0
  log "检测到 dpkg/apt 锁被占用 ⇒ 最多等 ${budget}s 让它释放（不等就是拿一次注定 rc=100 的失败去填空）"
  while [ "$waited" -lt "$budget" ]; do
    sleep 5
    waited=$((waited + 5))
    lock_held || { log "锁已释放（等了 ${waited}s）"; return 0; }
  done
  log "等满 ${budget}s 锁仍在 ⇒ 仍继续尝试（把决定权交给安装命令自己，别在这里静默放弃）"
  return 1
}

# 装一轮。返回 0=装好 / 124=单次超时 / 143=被 TERM 收掉（也算超时）/ 其他=命令自身报错
try_install() {
  local browser="$1" limit="$2" rc=0
  set +e
  timeout --signal=TERM --kill-after=15s "$limit" npx playwright install --with-deps "$browser"
  rc=$?
  set -e
  return "$rc"
}

install() {
  local browser attempts limit backoff lockwait i rc timed_out=0
  browser="${BROWSER:-chromium}"
  attempts="${BROWSER_ATTEMPTS:-2}"
  limit="${BROWSER_ATTEMPT_TIMEOUT_S:-900}"
  backoff="${BROWSER_RETRY_BACKOFF_S:-15}"
  lockwait="${BROWSER_LOCK_WAIT_S:-180}"

  case "$attempts" in ''|*[!0-9]*) err "BROWSER_ATTEMPTS 必须是正整数，实得 '$attempts'"; return 2 ;; esac
  case "$limit" in ''|*[!0-9]*) err "BROWSER_ATTEMPT_TIMEOUT_S 必须是正整数秒，实得 '$limit'"; return 2 ;; esac

  require_prereqs || return 2

  log "浏览器=$browser 尝试上限=${attempts}次 单次上限=${limit}s 缓存根=$(browsers_root)"

  i=1
  while [ "$i" -le "$attempts" ]; do
    log "第 ${i}/${attempts} 次尝试（单次上限 ${limit}s，锁等待上限 ${lockwait}s）"
    # 必须 || true：wait_for_lock 用返回 1 表达「锁仍被占」这个**信息**，而本脚本开着 set -e，
    # 不吞掉它就会在这里直接中止整个安装 —— 一手实测（自证腿6）：日志连「重试耗尽」的归因行
    # 都没走到就 rc=1 退出，等于把「等不到锁」伪装成「装不上」，正是本文件反对的那种假信号。
    wait_for_lock "$lockwait" || true
    rc=0
    try_install "$browser" "$limit" || rc=$?
    case "$rc" in
      124|143) timed_out=$((timed_out + 1)); log "本次尝试超时（${limit}s 到点，已在一步之内断开）" ;;
      0) : ;;
      *) log "本次尝试安装命令报错 rc=${rc}" ;;
    esac

    # 产物自证优先于 rc：命令说成功但盘上无货，同样当没装好。
    if [ "$rc" -eq 0 ] && browser_present "$browser"; then
      log "装好且产物在盘 ⇒ 第 ${i}/${attempts} 次成功（超时次数 ${timed_out}）"
      return 0
    fi
    if [ "$rc" -eq 0 ]; then
      log "命令 rc=0 但盘上找不到 $browser 可执行文件 ⇒ 不认这次成功（rc 与产物是两件事）"
    fi

    [ "$i" -lt "$attempts" ] || break
    log "等待 ${backoff}s 后重试"
    sleep "$backoff"
    i=$((i + 1))
  done

  err "重试耗尽：${attempts} 次 x ${limit}s 都拿不到 $browser（其中超时 ${timed_out} 次）"
  err "归因（按顺序自查，不要改判据来求绿）："
  err "  1) 缓存面：本仓 actions/cache 的 key = ms-playwright-<package-lock 哈希>，升 Playwright 必换键"
  err "     ⇒ 首跑必然冷下载。确认 cache 的 path 与本脚本的 $(browsers_root) 是同一处。"
  err "  2) 并发面：三个 Playwright job 同时拉同一 CDN 会互相拖（37677572509 一手：一路 13m45s 成功、两路 6h 挂死）。"
  err "     处置是让一路装好、其余命中缓存，别三路同时起跑。"
  err "  3) 供应链面：npx playwright 会现拉版本；镜像源不通时先 npm ci 再跑本脚本。"
  err "  4) 上游面：Playwright CDN 抖动。调大 BROWSER_ATTEMPTS / BROWSER_ATTEMPT_TIMEOUT_S 是有据的调法；"
  err "     无据地删掉本脚本回到裸 npx，等于把 6 小时挂死请回来。"
  return 1
}

# ── 自证面 ─────────────────────────────────────────────────────────────
# 合成命令面：FAKE_MODE 决定假 npx 的行为，FAKE_COUNTER 记录被调了几次。
# 四条腿各自只断言一件事；断言对象是 rc 与计数，不是日志文本。
write_fake_npx() {
  cat >"$FAKE_STATE_DIR/npx" <<'FAKE'
#!/usr/bin/env bash
n=$(($(cat "$FAKE_COUNTER" 2>/dev/null || echo 0) + 1))
printf '%s' "$n" >"$FAKE_COUNTER"
mkdir -p "$FAKE_ROOT"
case "${FAKE_MODE:-ok}" in
  ok)          mkdir -p "$FAKE_ROOT/chromium-$n"; : >"$FAKE_ROOT/chromium-$n/chrome"; exit 0 ;;
  timeout)     sleep 86400 ;;
  fail)        exit 7 ;;
  # rc=0 但只造空目录（半途中断的残留形态）：用来证明脚本不信 rc
  rcfalse)     mkdir -p "$FAKE_ROOT/chromium-9999"; exit 0 ;;
  # 前 N-1 次失败，第 N 次成功且把产物放上盘：用来证明重试真在跑
  failthen)    if [ "$n" -ge "${FAKE_SUCCEED_AT:-3}" ]; then
                  mkdir -p "$FAKE_ROOT/chromium-$n"
                  : >"$FAKE_ROOT/chromium-$n/chrome"
                  exit 0
                fi
                exit 7 ;;
esac
FAKE
  chmod +x "$FAKE_STATE_DIR/npx"
}

# 假锁探测面：FAKE_LOCK_HELD_TIMES 次内报「占用」（exit 0），之后报「空闲」（exit 1）。
# 为什么要单独落成脚本而不是把命令串塞进 BROWSER_LOCK_PROBE：命令串里带路径就要引号，
# 而它会被 bash -c 二次解析 —— 一手踩过（转义引号变成字面文件名，计数永远写不到目标路径，
# 于是那条腿以完全错误的理由变绿/变红）。脚本面没有这层引号问题。
write_fake_probe() {
  cat >"$FAKE_STATE_DIR/probe" <<'PROBE'
#!/usr/bin/env bash
n=$(($(cat "$FAKE_LOCK_COUNTER" 2>/dev/null || echo 0) + 1))
printf '%s' "$n" >"$FAKE_LOCK_COUNTER"
if [ "$n" -le "${FAKE_LOCK_HELD_TIMES:-0}" ]; then exit 0; fi
exit 1
PROBE
  chmod +x "$FAKE_STATE_DIR/probe"
}

run_fake() { # run_fake <mode> <root> <counter> <attempts> <limit> [succeed_at] [lock_probe] [lock_wait]
  local mode="$1" root="$2" counter="$3" attempts="$4" limit="$5" at="${6:-3}" \
    probe="${7:-exit 1}" wait="${8:-0}"
  mkdir -p "$root"
  : >"$counter"
  rm -f "$root.lockcount"
  set +e
  FAKE_MODE="$mode" FAKE_ROOT="$root" FAKE_COUNTER="$counter" FAKE_SUCCEED_AT="$at" \
    FAKE_STATE_DIR="$FAKE_STATE_DIR" FAKE_LOCK_COUNTER="$root.lockcount" \
    FAKE_LOCK_HELD_TIMES="${FAKE_LOCK_HELD_TIMES:-0}" \
    BROWSER=chromium BROWSER_ATTEMPTS="$attempts" BROWSER_ATTEMPT_TIMEOUT_S="$limit" \
    BROWSER_RETRY_BACKOFF_S=0 BROWSER_LOCK_PROBE="$probe" BROWSER_LOCK_WAIT_S="$wait" \
    PLAYWRIGHT_BROWSERS_PATH="$root" \
    PATH="$FAKE_STATE_DIR:$PATH" bash "$0"
  local rc=$?
  set -e
  return "$rc"
}

selftest() {
  FAKE_STATE_DIR="$(mktemp -d)"
  trap 'rm -rf "$FAKE_STATE_DIR"' EXIT
  write_fake_npx
  local bad=0 attempts_seen spent

  # 腿1 首轮即成 ⇒ rc=0 且恰好调了 1 次（证明不 needless 重试）
  if run_fake ok "$FAKE_STATE_DIR/r1" "$FAKE_STATE_DIR/c1" 3 5 && [ "$(cat "$FAKE_STATE_DIR/c1")" = "1" ]; then
    log "PASS  腿1 首轮即成 ⇒ rc=0 且尝试 1 次"
  else
    log "FAIL  腿1 首轮即成（rc 或调用次数不符，计数=$(cat "$FAKE_STATE_DIR/c1")）"; bad=$((bad + 1))
  fi

  # 腿2 前两轮失败第三轮成功 ⇒ rc=0 且恰好调了 3 次（证明重试真在跑）
  if run_fake failthen "$FAKE_STATE_DIR/r2" "$FAKE_STATE_DIR/c2" 3 5 3 \
     && [ "$(cat "$FAKE_STATE_DIR/c2")" = "3" ]; then
    log "PASS  腿2 前两轮失败第三轮成功 ⇒ rc=0 且尝试 3 次"
  else
    log "FAIL  腿2 重试语义（计数=$(cat "$FAKE_STATE_DIR/c2")）"; bad=$((bad + 1))
  fi

  # 腿3 全部超时 ⇒ rc=1 且总耗时远小于 尝试数 x 单次上限（证明快红，不是挂满预算）
  local t0 rc3=0
  t0=$(date +%s)
  run_fake timeout "$FAKE_STATE_DIR/r3" "$FAKE_STATE_DIR/c3" 2 3 || rc3=$?
  spent=$(( $(date +%s) - t0 ))
  if [ "$rc3" -eq 1 ] && [ "$spent" -lt 20 ]; then
    log "PASS  腿3 充次设时超时 ⇒ rc=1 且快红，实测耗时 ${spent}s（单次上限 3s x 2 次 = 6s，20s 是松量）"
  else
    log "FAIL  腿3 充次超时 rc=${rc3}（期望 1）耗时 ${spent}s（期望 <20s ⇒ 它在挂满预算）"; bad=$((bad + 1))
  fi

  # 腿4 命令 rc=0 但产物不在 ⇒ 仍判红（证明不信 rc，只信盘面）
  if run_fake rcfalse "$FAKE_STATE_DIR/r4" "$FAKE_STATE_DIR/c4" 1 5; then
    log "FAIL  腿4 rc=0 但产物不在仍判绿 ⇒ 这一版在拿 rc 当证据"; bad=$((bad + 1))
  else
    log "PASS  腿4 rc=0 但产物不在 ⇒ 仍判红（只认盘面）"
  fi

  # 腿5 锁被占 ⇒ 真的等过再装（证明 wait_for_lock 接在尝试之前，不是写了没接线）。
  # 注入面：假探测前 2 次报「占用」、第 3 次起报「空闲」；断言三件事：安装只跑 1 次、
  # 锁被探测 >=3 次、且确实花时间等过（>=9s）—— 少一条都不算咬住。
  write_fake_probe
  local t5 rc5=0 polls5
  t5=$(date +%s)
  FAKE_LOCK_HELD_TIMES=2 run_fake ok "$FAKE_STATE_DIR/r5" "$FAKE_STATE_DIR/c5" 2 5 3 "$FAKE_STATE_DIR/probe" 20 || rc5=$?
  polls5=$(cat "$FAKE_STATE_DIR/r5.lockcount" 2>/dev/null || echo 0)
  spent=$(( $(date +%s) - t5 ))
  if [ "$rc5" -eq 0 ] && [ "$(cat "$FAKE_STATE_DIR/c5")" = "1" ] && [ "$polls5" -ge 3 ] && [ "$spent" -ge 9 ]; then
    log "PASS  腿5 锁占用 ⇒ 探测 ${polls5} 次、等 ${spent}s 直到放开才装（rc=0、安装只跑 1 次）"
  else
    log "FAIL  腿5 锁等待未生效 rc=${rc5} 探测=${polls5}（期望>=3）耗时=${spent}s（期望>=9）安装次数=$(cat "$FAKE_STATE_DIR/c5")（期望 1）"; bad=$((bad + 1))
  fi

  # 腿6 锁始终占用 ⇒ 等满预算后仍继续装并如实判红（不许在这里静默放弃，那会把「装不上」
  # 伪装成「没试」；也不能因为等不到锁就 rc=0，那是假绿）
  local t6 rc6=0
  t6=$(date +%s)
  FAKE_LOCK_HELD_TIMES=99 run_fake fail "$FAKE_STATE_DIR/r6" "$FAKE_STATE_DIR/c6" 1 5 3 "$FAKE_STATE_DIR/probe" 6 || rc6=$?
  spent=$(( $(date +%s) - t6 ))
  if [ "$rc6" -eq 1 ] && [ "$spent" -ge 6 ] && [ "$(cat "$FAKE_STATE_DIR/c6")" = "1" ]; then
    log "PASS  腿6 锁不放 ⇒ 等满 ${spent}s 仍继续安装并如实判红（rc=1、装了 1 次）"
  else
    log "FAIL  腿6 rc=${rc6} 耗时=${spent}s 次数=$(cat "$FAKE_STATE_DIR/c6")（期望 rc=1、>=6s、1 次）"; bad=$((bad + 1))
  fi

  log "自证 $((6 - bad))/6$([ "$bad" -gt 0 ] && printf ' ⇒ 有腿没咬住')" 
  return "$bad"
}

if [ "${1:-}" = "--selftest" ]; then
  selftest
  exit $?
fi

install
