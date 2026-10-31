package main

import (
	"os"
	"path/filepath"
	"testing"
)

func writeExecutable(t *testing.T, root string, version string) string {
	t.Helper()
	target := executableForVersion(root, version)
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("exe"), 0o755); err != nil {
		t.Fatal(err)
	}
	return target
}

func TestResolveLaunchTargetUsesActiveLocalVersion(t *testing.T) {
	installRoot := t.TempDir()
	localRoot := t.TempDir()
	writeExecutable(t, installRoot, "1.0.0")
	localTarget := writeExecutable(t, localRoot, "1.1.0")
	writePointer(filepath.Join(installRoot, "current.json"), versionPointer{Version: "1.0.0"})
	writePointer(filepath.Join(localRoot, "current.json"), versionPointer{Version: "1.1.0"})

	if target := resolveLaunchTarget(installRoot, localRoot); target != localTarget {
		t.Fatalf("expected %s, got %s", localTarget, target)
	}
}

// pending 只表示「刚切到新版本、还没报到健康」。这里必须启动新版本：旧实现直接在
// 第一次启动时回滚，正是「后台更新完成、重开仍是旧版本」的成因。
func TestResolveLaunchTargetLaunchesPendingVersionFirst(t *testing.T) {
	installRoot := t.TempDir()
	localRoot := t.TempDir()
	writeExecutable(t, installRoot, "1.0.0")
	writeExecutable(t, localRoot, "1.1.0")
	pendingTarget := writeExecutable(t, localRoot, "1.2.0")
	writePointer(filepath.Join(installRoot, "current.json"), versionPointer{Version: "1.0.0"})
	pointerPath := filepath.Join(localRoot, "current.json")
	writePointer(pointerPath, versionPointer{
		Version:         "1.2.0",
		PreviousVersion: "1.1.0",
		Pending:         true,
	})

	if target := resolveLaunchTarget(installRoot, localRoot); target != pendingTarget {
		t.Fatalf("expected %s, got %s", pendingTarget, target)
	}
	pointer, err := readPointer(pointerPath)
	if err != nil {
		t.Fatal(err)
	}
	if pointer.Version != "1.2.0" || pointer.Attempts != 1 || !pointer.Pending {
		t.Fatalf("expected pending 1.2.0 with 1 attempt, got %+v", pointer)
	}
}

func TestResolveLaunchTargetRollsBackAfterRepeatedPendingLaunches(t *testing.T) {
	installRoot := t.TempDir()
	localRoot := t.TempDir()
	writeExecutable(t, installRoot, "1.0.0")
	previousTarget := writeExecutable(t, localRoot, "1.1.0")
	writeExecutable(t, localRoot, "1.2.0")
	writePointer(filepath.Join(installRoot, "current.json"), versionPointer{Version: "1.0.0"})
	pointerPath := filepath.Join(localRoot, "current.json")
	writePointer(pointerPath, versionPointer{
		Version:         "1.2.0",
		PreviousVersion: "1.1.0",
		Pending:         true,
		Attempts:        maxLaunchAttempts,
	})

	if target := resolveLaunchTarget(installRoot, localRoot); target != previousTarget {
		t.Fatalf("expected %s, got %s", previousTarget, target)
	}
	pointer, err := readPointer(pointerPath)
	if err != nil {
		t.Fatal(err)
	}
	if pointer.Version != "1.1.0" || pointer.Pending {
		t.Fatalf("expected a clean 1.1.0 pointer, got %+v", pointer)
	}
}

// 版本目录不完整说明这次升级根本没装成，必须立刻回退而不是重试。
func TestResolveLaunchTargetRollsBackWhenPendingVersionIsMissing(t *testing.T) {
	installRoot := t.TempDir()
	localRoot := t.TempDir()
	writeExecutable(t, installRoot, "1.0.0")
	previousTarget := writeExecutable(t, localRoot, "1.1.0")
	writePointer(filepath.Join(installRoot, "current.json"), versionPointer{Version: "1.0.0"})
	writePointer(filepath.Join(localRoot, "current.json"), versionPointer{
		Version:         "1.2.0",
		PreviousVersion: "1.1.0",
		Pending:         true,
	})

	if target := resolveLaunchTarget(installRoot, localRoot); target != previousTarget {
		t.Fatalf("expected %s, got %s", previousTarget, target)
	}
}

func TestResolveLaunchTargetFallsBackToBundledVersion(t *testing.T) {
	installRoot := t.TempDir()
	localRoot := t.TempDir()
	bundledTarget := writeExecutable(t, installRoot, "1.0.0")
	writePointer(filepath.Join(installRoot, "current.json"), versionPointer{Version: "1.0.0"})
	writePointer(filepath.Join(localRoot, "current.json"), versionPointer{
		Version:         "1.1.0",
		PreviousVersion: "1.0.0",
		Pending:         true,
	})

	if target := resolveLaunchTarget(installRoot, localRoot); target != bundledTarget {
		t.Fatalf("expected %s, got %s", bundledTarget, target)
	}
}

func TestReadPointerRejectsNegativeAttempts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "current.json")
	writePointer(path, versionPointer{Version: "1.2.0", Pending: true, Attempts: -1})

	if _, err := readPointer(path); err == nil {
		t.Fatal("expected negative attempts to be rejected")
	}
}
