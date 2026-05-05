# WSL2: llvmpipe → D3D12 NVIDIA Hardware Rendering Fix

**System:** Ubuntu 24.04 on WSL2, NVIDIA RTX 500 Ada Generation Laptop GPU + Intel Graphics  
**Problem:** All GL apps fell back to `llvmpipe` (CPU software rendering) despite NVIDIA GPU being accessible for CUDA.  
**Result:** `OpenGL renderer string: D3D12 (NVIDIA RTX 500 Ada Generation Laptop GPU)` with ~1364 FPS in glxgears.

---

## Session 1 — Diagnosis & Mesa Downgrade
*Session: "Resolve Skiko Linux GL Context Error" (2026-04-15)*

### Initial Symptom
Skiko (Kotlin UI framework) threw:
```
[SKIKO] warn: Fallback to next API
org.jetbrains.skiko.RenderException: Cannot create Linux GL context
```

### Investigation
- `DISPLAY=:0`, `WAYLAND_DISPLAY=wayland-0` — WSLg running ✅
- `/dev/dxg` — exists ✅
- `/usr/lib/wsl/lib/` — CUDA + D3D12 libs present (libcuda.so, libd3d12.so, ...) ✅
- `nvidia-smi` — NVIDIA RTX 500 Ada (Driver 581.60) ✅
- `/dev/dri/` — **does not exist** ❌
- Mesa `d3d12_dri.so` — present but not being used ❌
- `glxinfo | grep renderer` → `llvmpipe (LLVM 20.1.8, 256 bits)` ❌
- `MESA_LOADER_DRIVER_OVERRIDE=d3d12 glxinfo` → still llvmpipe ❌
- `dmesg` → `dxgkio_query_adapter_info: Ioctl failed: -22` at every boot ❌
- `xdpyinfo` → **DRI3 extension not supported** ❌

### Root Cause
Two compounding issues:
1. **`dxgkrnl` ioctl errors** — the kernel GPU paravirt driver failed to initialize, so no `/dev/dri/` render nodes were created, preventing Mesa from using the D3D12 hardware path.
2. **Mesa 26.0.1 from `kisak-mesa` PPA** — bleeding-edge version incompatible with the current `dxgkrnl` interface.

### Fix Applied (in WSL)
Downgrade Mesa from the kisak PPA version back to stable Ubuntu 24.04:
```bash
# Check what's installed from the PPA
apt list --installed 2>/dev/null | grep kisak

# Downgrade these packages to stock versions
sudo apt install --allow-downgrades \
  libegl-mesa0=25.2.8-0ubuntu0.24.04.1 \
  libgbm1=25.2.8-0ubuntu0.24.04.1 \
  libgl1-mesa-dri=25.2.8-0ubuntu0.24.04.1 \
  libglx-mesa0=25.2.8-0ubuntu0.24.04.1 \
  mesa-libgallium=25.2.8-0ubuntu0.24.04.1 \
  mesa-vulkan-drivers=25.2.8-0ubuntu0.24.04.1

# Clean up orphaned PPA packages
sudo apt autoremove
```

Still showing `llvmpipe` — expected until WSL restarts and NVIDIA drivers are updated.

### Required Windows Steps
1. Update NVIDIA driver → https://www.nvidia.com/download/index.aspx (RTX 500 Ada, Laptop)
2. From PowerShell (Admin): `wsl --shutdown`, then reopen WSL

---

## Session 2 — Environment Variables Fix
*Session: "Continue Fixing WSL GPU Hardware Passthrough" (2026-04-15)*

### State After Driver Update + WSL Restart
- `nvidia-smi` now shows Driver **595.97** (upgraded from 581.60) ✅
- `/dev/dri/` — still doesn't exist ❌
- `glxinfo` → still `llvmpipe` ❌
- WSLg log: `glamor: 'wl_drm' not supported → Failed to initialize glamor, falling back to sw` ❌

### Key Discovery
Testing with explicit env vars:
```bash
# D3D12 works! (but defaults to Intel)
GALLIUM_DRIVER=d3d12 glxinfo | grep renderer
# → OpenGL renderer string: D3D12 (Intel(R) Graphics)

# Force NVIDIA specifically:
GALLIUM_DRIVER=d3d12 MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA glxinfo | grep renderer
# → OpenGL renderer string: D3D12 (NVIDIA RTX 500 Ada Generation Laptop GPU)
```

This is a **dual-GPU laptop** (Intel + NVIDIA). Mesa selects Intel by default when using D3D12 passthrough, and further falls back to `llvmpipe` without the explicit `GALLIUM_DRIVER=d3d12` override.

### Performance Confirmation
```bash
GALLIUM_DRIVER=d3d12 MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA glxgears
# → 6819 frames in 5.0 seconds = 1363.778 FPS  ✅ (vs ~60 FPS with llvmpipe)
```

### Fix — Permanent Environment Variables

**`~/.zshenv`** (created, for all zsh sessions including non-interactive):
```bash
# WSL2 GPU hardware acceleration via D3D12
# Enables Mesa's D3D12 Gallium driver instead of software rendering (llvmpipe)
export GALLIUM_DRIVER=d3d12
export MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA
```

**`~/.profile`** (appended, for bash/login sessions):
```bash
# WSL2 GPU hardware acceleration via D3D12
export GALLIUM_DRIVER=d3d12
export MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA
```

**`C:\Users\<user>\.wslconfig`** (updated from Windows):
```ini
[wsl2]
nestedVirtualization=true
gpuSupport=true
guiApplications=true
```

### Verification
```
Before: OpenGL renderer string: llvmpipe (LLVM 20.1.2, 256 bits)
After:  OpenGL renderer string: D3D12 (NVIDIA RTX 500 Ada Generation Laptop GPU)
```

Both CUDA (`nvidia-smi` ✅) and GPU rendering (D3D12 @ 1364 FPS ✅) working.

---

## Side Effect — BCompare Cursor (D3D12 + WSLg Wayland Bug)
*Session: "Fix Mouse Cursor In BCompare" (2026-04-22)*

Once D3D12 was enabled globally, a side effect appeared: mouse cursor invisible in some apps (Beyond Compare, similar issue was in GoLand).

**Root cause:** WSLg's Wayland compositor + D3D12 GPU acceleration has a cursor rendering bug.

**Fix for affected apps** — force software rendering for just that app via `~/.zshrc` alias:
```bash
alias bcompare='LIBGL_ALWAYS_SOFTWARE=1 QT_SCALE_FACTOR=1.5 bcompare'
```

GoLand's equivalent fix (JVM app): `JDK_JAVA_OPTIONS="-Dcursor.renderer=software"`

---

## Summary of All Changes

| File | Change |
|------|--------|
| Mesa packages | Downgraded from 26.0.1 (kisak PPA) → 25.2.8 (stock Ubuntu 24.04) |
| `~/.zshenv` | Created with `GALLIUM_DRIVER=d3d12` + `MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA` |
| `~/.profile` | Appended same GPU env vars |
| `C:\Users\<user>\.wslconfig` | Added `gpuSupport=true`, `guiApplications=true` |
| `~/.zshrc` | Added `alias bcompare='LIBGL_ALWAYS_SOFTWARE=1 ...'` (cursor workaround) |
| NVIDIA driver (Windows) | Updated 581.60 → 595.97 |

## Key Insight

Without `/dev/dri/` render nodes (which `dxgkrnl` failed to create due to ioctl errors), Mesa **can still use D3D12** — but only when explicitly forced via `GALLIUM_DRIVER=d3d12`. Mesa does NOT auto-detect and use D3D12 passthrough without this env var; it falls back to `llvmpipe` instead. The env vars are the critical piece.
