package main

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
)

const executableName = "Astravia.exe"

// maxLaunchAttempts 是 pending 版本允许的启动次数。后台更新写下的 pending 只代表
// 「刚切到新版本、还没报到健康」，不是「已经失败」；连续这么多次启动后仍没有应用
// 回写健康，才认为新版本起不来并回滚。
const maxLaunchAttempts = 2

var versionPattern = regexp.MustCompile(`^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$`)

type versionPointer struct {
	Version         string `json:"version"`
	PreviousVersion string `json:"previousVersion,omitempty"`
	Pending         bool   `json:"pending,omitempty"`
	Attempts        int    `json:"attempts,omitempty"`
}

func isValidVersion(version string) bool {
	return version != "." && version != ".." && versionPattern.MatchString(version)
}

func readPointer(path string) (versionPointer, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return versionPointer{}, err
	}
	var pointer versionPointer
	if err := json.Unmarshal(data, &pointer); err != nil {
		return versionPointer{}, err
	}
	if !isValidVersion(pointer.Version) {
		return versionPointer{}, errors.New("invalid version pointer")
	}
	if pointer.PreviousVersion != "" && !isValidVersion(pointer.PreviousVersion) {
		return versionPointer{}, errors.New("invalid previous version pointer")
	}
	if pointer.Attempts < 0 {
		return versionPointer{}, errors.New("invalid launch attempts")
	}
	return pointer, nil
}

func executableForVersion(root string, version string) string {
	return filepath.Join(root, "versions", version, executableName)
}

func existingExecutable(root string, version string) string {
	if !isValidVersion(version) {
		return ""
	}
	target := executableForVersion(root, version)
	info, err := os.Stat(target)
	if err != nil || info.IsDir() {
		return ""
	}
	return target
}

func writePointer(path string, pointer versionPointer) {
	data, err := json.Marshal(pointer)
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	_ = os.WriteFile(path, append(data, '\n'), 0o644)
}

// rollbackPointer 退回上一个可用版本；没有就删掉本地指针，交给内置版本兜底。
func rollbackPointer(localPointerPath string, localRoot string, pointer versionPointer) string {
	if previous := existingExecutable(localRoot, pointer.PreviousVersion); previous != "" {
		writePointer(localPointerPath, versionPointer{Version: pointer.PreviousVersion})
		return previous
	}
	_ = os.Remove(localPointerPath)
	return ""
}

// resolvePendingTarget 处理「刚切换过来的版本」。
//
// 旧实现直接在第一次启动时回滚到 previousVersion，于是后台更新写完指针就退出、
// 新版本从未启动的场景被固化成「永久降级」：用户重开多少次都停在旧版本。现在只有
// 版本目录不完整、或连续 maxLaunchAttempts 次启动都没报到健康时才回滚，正常启动
// 则累加尝试次数并跑新版本；应用 ready 后会把 pending 清掉（见 markCurrentVersionHealthy）。
func resolvePendingTarget(localPointerPath string, localRoot string, pointer versionPointer) string {
	candidate := existingExecutable(localRoot, pointer.Version)
	if candidate == "" || pointer.Attempts >= maxLaunchAttempts {
		return rollbackPointer(localPointerPath, localRoot, pointer)
	}
	pointer.Attempts++
	writePointer(localPointerPath, pointer)
	return candidate
}

func resolveLaunchTarget(installRoot string, localRoot string) string {
	localPointerPath := filepath.Join(localRoot, "current.json")
	if pointer, err := readPointer(localPointerPath); err == nil {
		if pointer.Pending {
			if target := resolvePendingTarget(localPointerPath, localRoot, pointer); target != "" {
				return target
			}
		} else if target := existingExecutable(localRoot, pointer.Version); target != "" {
			return target
		}
	}

	bundledPointer, err := readPointer(filepath.Join(installRoot, "current.json"))
	if err != nil {
		return ""
	}
	return existingExecutable(installRoot, bundledPointer.Version)
}

func startDetached(target string, args []string) error {
	command := exec.Command(target, args...)
	command.Dir = filepath.Dir(target)
	// Do NOT set HideWindow / STARTF_USESHOWWINDOW+SW_HIDE.
	// That overrides the child GUI process's first ShowWindow and leaves the
	// Electron main window with WS_VISIBLE cleared (tray-only, no UI).
	// Launcher itself is built with -H=windowsgui so no console flashes.
	if err := command.Start(); err != nil {
		return err
	}
	return command.Process.Release()
}

func main() {
	launcherPath, err := os.Executable()
	if err != nil {
		return
	}
	localAppData, err := os.UserCacheDir()
	if err != nil {
		return
	}
	installRoot := filepath.Dir(launcherPath)
	localRoot := filepath.Join(localAppData, "Astravia")
	target := resolveLaunchTarget(installRoot, localRoot)
	if target == "" {
		return
	}
	_ = startDetached(target, os.Args[1:])
}
