# ADR-0153：未签名 macOS 包用内置安装器完成原地升级

## 状态

已接受。新增一条 macOS 专用的安装通道；Windows 的 Inno 通道、已签名 macOS 包的 Squirrel 通道、更新清单格式与 R2/官网发布链路都不变。

## 背景

客户端发布链路的更新安装依赖 electron-updater：下载 ZIP 后交给 Squirrel.Mac，由它校验签名、替换 bundle 并重启。校验用的是**当前包的指定要求**，因此要求新旧包签名一致。

这条要求对本地构建的包不成立。仓库没有 Apple 开发者证书（`gh secret list` 里没有任何 macOS 签名 Secret），`desktop-release.yml` 里那几步签名与公证被跳过，产物落成 adhoc 包：

```
$ codesign -dv --verbose=2 /Applications/Astravia.app
Identifier=Electron
flags=0x20002(adhoc,linker-signed)
$ codesign -v --verbose=2 /Applications/Astravia.app
code has no resources but signature indicates they must be present
```

`linker-signed` 意味着签名只是链接器留下的空壳，没有 `CodeResources`。Squirrel 的校验因此必然失败，用户看到的现象是：侧边栏与设置页都能检测到新版本（检查更新走的是 HTTP 与版本比较，与签名无关），点「更新」后进度走完，然后报错、版本不变。重试多少次都一样——这不是时序或网络问题。

可选方案只有三条：

| 方案 | 代价 |
| --- | --- |
| 补 Apple 开发者证书并公证 | 需要证书与 Apple ID 凭据，当前环境下不可得；且无法在本机验证 CI 签名产物 |
| 未签名时改为「下载 DMG，引导用户手动拖入应用目录」 | 可行但仍是手动，用户诉求是「点更新就完成」 |
| 内置安装器：自己解包并原地替换 bundle | 需要自己承担 Squirrel 原本负责的等待退出、去 quarantine、失败回滚 |

选第三条。它是唯一能在现有凭据条件下让「点击更新」真正完成升级的路径。

## 决策

新增 `apps/desktop/src/main/mac-unsigned-installer.ts`，并在 `ElectronUpdaterEngine` 上开一条并列通道。

### 判定

`isUnsignedMacBundle(bundlePath)` 跑 `codesign -dv --verbose=2`，命中任一条件即视为「不能交给 Squirrel」：

- 输出含 `code object is not signed`；
- 输出含 `linker-signed` 或 `adhoc`；
- 输出里没有 `Authority=Developer ID Application`。

`updater.ts` 在 `app.isPackaged` 且 `process.platform === "darwin"` 时判定一次，用 `dirname(dirname(dirname(app.getPath("exe"))))` 求 bundle 根（`getAppPath()` 在打包后指向 `Contents/Resources/app.asar`，不是 bundle）。判定为未签名时构造 `MacUnsignedInstallOptions` 传进引擎，引擎据此切换行为。已签名包完全走原路，本 ADR 对它们没有影响。

### 下载阶段

未签名通道下**不**等待 `nativeAutoUpdater` 的 `update-downloaded`——那个事件不会到来，等下去只会把「下载成功」判成超时失败。因此：

- `nativeMacReadiness` 只在没有走内置通道时创建；
- `autoInstallOnAppQuit` 置假，避免退出时 Squirrel 再试一次、再失败一次；
- 下载 promise **成功结算时也认领**：Squirrel 的拒绝有两种到达方式——`downloadUpdate` reject（reject 分支接），以及只发一个 `error` 事件、promise 照常 resolve。只处理前者时 ZIP 从未被认领，`quitAndInstall()` 就会退回那条对未签名包必然失败的 Squirrel 路径，表现为进度 100%、进程退出、重开仍旧版本且无报错。因此认领动作前移到成功分支首行（`macPendingArchive ??= await findPendingArchive()`）。
- reject 分支保留：ZIP 已在 electron-updater 的 `pending` 目录落盘（哈希已由 `executeDownload` 校验）时，把这次失败当作「暂存阶段失败」而不是「下载失败」，返回该 ZIP 路径。

pending 目录里先按清单资产名找；清单同时列出 x64 与 arm64 两个 ZIP 时 `files[0]` 未必是本机下载的那个，退到「目录里最新的 `.zip`」。

### 安装阶段

`quitAndInstall()` 先认领并校验待安装 ZIP，**校验通过后才**跑原有的 `prepare`（标记 isQuitting + 退出清理），随后写一个安装脚本并以 `detached` 方式启动，**不**调用 `updater.quitAndInstall`。校验必须排在 `prepare` 之前：`prepare` 已标记退出、写完重启标记并跑完退出清理，此时报错会把应用留在「清理已做、窗口已关、却还在运行」的半退出状态。未签名通道下找不到 ZIP 直接抛错，由 `UpdaterService.install()` 落成 `updater.errors.installFailed`——静默失败改为可见错误，**永不退回 Squirrel**。脚本五步，顺序即正确性：

1. 等 PID 消失（`kill -0` 轮询，默认上限 120s，超时放弃）。运行中的 Mach-O 被覆盖会 `ETXTBSY`。
2. `ditto -x -k --sequesterRsrc` 解包到 `mktemp -d` 的暂存目录，确认里面有 `.app`；归档根直接是 bundle 内容时（`ditto -c -k` 对 `.app` 的行为）把暂存目录本身当 bundle。
3. `xattr -dr com.apple.quarantine`——否则首次启动弹「无法验证开发者」，用户点取消就退回旧版。
4. 旧包改名 `.old` → `ditto` 新包进原位 → 失败则还原。替换失败绝不留半个包。
5. 重启。

路径一律过 `shellQuote`（单引号转义），`/Applications` 下的包名可能带空格。脚本与日志落在 `~/Library/Caches/astravia-updater/install-<资产名>.{sh,log}`，脚本执行完由 `trap` 清暂存目录。

## 后果

- 未签名本机现在能真正完成升级；已签名渠道包的行为不变。
- 这条通道没有差分更新：Squirrel 的 blockmap 复用失效，每次都是整包 ZIP。可接受——未签名包本来就是开发/自建场景。
- 替换发生在应用退出之后，失败只留下日志，无法在界面上回滚提示。第 4 步的「失败即还原」是唯一兜底，因此那一步必须是可逆的。
- 判定依赖 `codesign` 输出文本。Apple 若改变措辞，会退化成「按已签名处理」→ 回到 Squirrel 失败的老症状；因此判定同时检查「没有 `Authority=Developer ID Application`」这条正向条件，不只看负面标记。
- 仍然**不**解决「未签名包在别人机器上首次打开被 Gatekeeper 拦截」——那是分发侧问题（需要公证），与升级路径无关。

## 备选方案

- **只做检测不做安装**：即当前行为，用户诉求未解决。
- **改成 `dmg` 分发 + 引导手动拖拽**：不满足「点更新就完成」。
- **自签名证书（self-signed code signing identity）**：Squirrel 校验依赖当前包的指定要求，自签名证书在用户机器上不被信任，校验照样失败；只有在所有目标机器都手动信任该证书时才成立。

## 迁移与验证

无数据迁移。更新清单、R2 布局、官网下载页、Windows 通道均不变。

新增 `mac-unsigned-installer.test.ts` 七例：

- 脚本五步存在且顺序正确（等退出 → 解包 → 换包 → 去 quarantine → 重启）；
- 带空格与单引号的路径被正确转义；
- **端到端**：临时目录造 `Astravia.app`（0.5.80）+ 用 `ditto` 打真 ZIP（0.5.81，归档根为 `Astravia.app/`），跑脚本后版本文件变成 0.5.81、`.old` 备份已清理；
- 旧进程不退出时以 1 退出且 bundle 未动；
- 归档损坏时以 1 退出且 bundle 仍是 0.5.80；
- `isUnsignedMacBundle` 对不存在的路径按平台判定；
- 日志与脚本同目录。

`updater-engine.test.ts` 补四例：Squirrel 拒绝未签名包时下载 promise 以 pending ZIP 结算、`quitAndInstall` 交给内置脚本而不是 `updater.quitAndInstall`；清单先列另一种架构时仍能定位到本机下载的 ZIP；**Squirrel 只发 `error` 事件、promise 照常 resolve 时依然交给内置脚本**；**无待安装 ZIP 时 `quitAndInstall` 拒绝而不是退回 Squirrel**。红绿确认：把 reject 分支改回直接抛出，前一例必红（实测 `1 failed | 9 passed`）；去掉认领前的 `??=` 与判空抛错，新增的第二例必红（实测 `promise resolved "undefined" instead of rejecting`）。

自动化只能覆盖到「脚本在临时目录里正确换包」。真实替换 `/Applications/Astravia.app` 属破坏性操作且会动到正在运行的应用，本轮**未**在本机执行；实机升级效果待下一次发版由用户确认。若失败，唯一证据是 `~/Library/Caches/astravia-updater/install-*.log`。

参考：[ADR-0124](../adr/0124-remote-project-ssh-helper.md)（另一条跨进程交棒链路）、`apps/desktop/src/main/mac-installer-handoff.ts`（Squirrel 通道的 launchd 交棒细节）。
