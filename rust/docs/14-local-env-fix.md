# rust/ 本机构建环境修复（2026-11-16 · goal-52b11071 r1 · 最终配方 V2）

> 目标：让 `cargo test / build（edge+host+wasm）` 在本机零 env 覆盖跑绿。
> 病根链（逐件实测定位）：
> 1. cargo/rustc 不在 PATH；工具链 junction C→D，gcc 驱动按 **D 真实路径**解析前缀。
> 2. crates.io 默认源停滞 ⇒ env 切 rsproxy sparse（仅下载期需要）。
> 3. gnu self-contained 缺 as.exe/运行时 DLL；gcc 驱动 14.2.0 缺同版 cc1/crtbegin/crtend/liblto_plugin；
>    14 cc1 需 gmp/isl/mpc/mpfr/winpthreads/zlib/zstd DLL（MSYS2 包补，放 cc1 同目录本地优先）；
>    驱动默认 ld 搜索目录（<rustlib>/lib 与 <rustlib>/x86_64-w64-mingw32/lib）缺 crt2.o/导入库 ⇒ 从 lib/self-contained 合并；
>    **crt-git 13 的新 crt2.o 与旧 msvcrt 导入库符号不兼容（__p___initenv/_crt_atexit undefined）⇒ 必须用 rustup 原装旧套，禁混 crt-git**。

## 最终落盘布局（幂等装配脚本见下）
- `<rb>/bin/self-contained/`：+binutils 2.47 exe（as/ld.bfd/ar…）+gettext/zlib-ng/zstd/libiconv/libstdc++16 DLL + lib/self-contained 全量合并（crt2.o/dllcrt2.o/旧 .a）。
- `<rb>/bin/lib/gcc/x86_64-w64-mingw32/14.2.0/`：gcc-14.2.0-3 包整目录（cc1/crtbegin.o/crtend.o/liblto_plugin）+ 旧 libgcc_s_seh-1/libwinpthread（工具链 bin）+ gmp/isl/mpc/mpfr/winpthreads/zlib/zstd/intl/iconv/charset/stdc++ DLL（mingw64/bin）。
- `<rb>/lib/` 与 `<rb>/x86_64-w64-mingw32/lib/`：lib/self-contained 原装旧套（crt2.o + 全部 .a）。
- `D:/app-cache/mingw64/`：独立 mingw（仅作 DLL 来源与兜底，**不进最终 PATH**，避免 16 驱动抢解析）。
其中 `<rb>=D:/app-cache/rustup-toolchains/stable-x86_64-pc-windows-gnu/lib/rustlib/x86_64-pc-windows-gnu`（C 视图同）。

## 复跑命令（已验证 wasm/edge/test 全 rc0）
```powershell
$rb = 'D:/app-cache/rustup-toolchains/stable-x86_64-pc-windows-gnu/lib/rustlib/x86_64-pc-windows-gnu'
$tc = 'C:/Users/37533/.rustup/toolchains/stable-x86_64-pc-windows-gnu'
$env:RUSTUP_HOME = 'C:/Users/37533/.rustup'; $env:CARGO_HOME = 'D:/app-cache/cargo'
$env:CARGO_REGISTRIES_CRATES_IO_INDEX = 'sparse+https://rsproxy.cn/index/'
$env:PATH = "$rb/bin/lib/gcc/x86_64-w64-mingw32/14.2.0;$rb/bin/self-contained;$tc/bin;" + $env:PATH
Set-Location D:/app-cache/chaoshi-web/supermarket-web/rust
& "$tc/bin/cargo.exe" test -p supermarket-core -p supermarket-edge
& "$tc/bin/cargo.exe" build -p supermarket-edge --release
& "$tc/bin/cargo.exe" build -p supermarket-wasm --profile release-wasm --target wasm32-unknown-unknown
node scripts/verify-all.mjs --cargo "$tc/bin/cargo.exe"
```

## 装配脚本（D:/app-cache/mingw-fix/，可复跑）
assemble.py/2/3（binutils+DLL→self-contained）；gcc14.py（14.2.0 布局）；crt.py（**仅 mingw64 侧可用 crt-git；rustlib 侧禁混**）；
最终合并与回滚旧套 = 本轮 pwsh 一步（Get-ChildItem lib/self-contained → 三目录 Copy-Item -Force）。

## 负控（有牙）
- 缺 as：dlltool CreateProcess / as status 53；14cc1 配 16libgcc：0xC0000139；
- 混 crt-git：undefined `__p___initenv`/`_crt_atexit`；回滚旧套即 rc0（本轮实测）。
