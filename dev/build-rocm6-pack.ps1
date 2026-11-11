# SLR Translator - ROCm 6 (HIP SDK 6.4.2) pack builder for Windows 10 compatibility.
#
# Rebuilds the Windows 10 ROCm pack against a chosen llama.cpp release. Transcribes the
# proven b10964/b11429 recipe from the ROCm 6 pack reports - same flags, same GPU targets,
# same pitfalls handled (clang lives in <sdk>\bin, the pip ninja stub is bypassed, the MSVC
# environment is imported because cmake/clang need it, amd_comgr_2.dll comes from the RTC
# package). Upstream publishes no HIP-6 Windows assets, so dev/update-llama-runtime.js
# cannot produce this pack; this script is the manual step its final message points at.
#
# Run it on the Windows build box (this exact invocation was run end to end for b11429 and
# the resulting archive independently re-verified: hashes, layout, manifest cross-check):
#
#   powershell -ExecutionPolicy Bypass -File dev\build-rocm6-pack.ps1 -Tag b<newtag> `
#       -HipPath "E:\Dev\rocm6-pack-b11429\hipsdk\Program Files 64\AMD\ROCm\6.4"
#
# Parameters:
#   -Tag      required, the llama.cpp build tag (bNNNNN) to build against
#   -HipPath  required, HIP SDK 6.4.2 root (installed, or extracted: the SDK is fully
#             relocatable - the report carved the MSIs out of the installer with
#             msiexec /a and built against that tree with no system install)
#   -OutDir   where the .7z lands (default: ..\..\Optional Runtime Packs)
#   -Ninja    optional, explicit path to a WORKING ninja.exe (default: Visual Studio's)
#
# Output: SLR-Translator-ROCm6-pack-<tag>-win-x64.7z in -OutDir, containing INSTALL.txt,
#   runtime/<tag>/packs/rocm.json and the three DLLs - the same shape as every other pack,
#   so it installs by extracting into the app folder.
#
# Requirements on the build box: VS 2022 with the C++ workload (imported below - it also
# supplies cmake on a default install) and the HIP SDK 6.4.2 tree. No AMD GPU is needed to
# BUILD; runtime verification on real RDNA hardware stays manual.
#
# The three things that must NOT be dropped from the cmake line, each of which broke the
# first draft of this script (see the b11429 report): the MSVC environment import (without
# it cmake is not even on PATH on a default box, and clang targeting x86_64-pc-windows-msvc
# has no headers or linker), CMAKE_PREFIX_PATH (find_package(hip) cannot see a carved SDK
# otherwise), and GGML_BACKEND_DL=ON (without it ggml-hip is a plain library linked into
# ggml, not the MODULE exporting ggml_backend_init that the app loads at runtime).

param(
    [Parameter(Mandatory = $true)][string]$Tag,
    [Parameter(Mandatory = $true)][string]$HipPath,
    [string]$OutDir = "",
    [string]$Ninja = ""
)
$ErrorActionPreference = "Stop"
# PS 5.1 does not always negotiate TLS 1.2 with api.github.com by default; without this the
# commit resolution quietly degrades to "unknown" and the manifest cross-check below fires.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

if (-not ($Tag -match '^b\d+$')) { throw "Tag must look like bNNNNN, got '$Tag'" }
if (-not (Test-Path (Join-Path $HipPath "bin\clang.exe"))) {
    throw "No clang.exe under $HipPath\bin - see the report: the Windows SDK has no lib\llvm tree, the compiler is at bin\clang.exe"
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path     # dev\
$appRoot = Split-Path -Parent $root
if (-not $OutDir) { $OutDir = Join-Path (Split-Path -Parent $appRoot) "Optional Runtime Packs" }
$work = Join-Path $env:TEMP "rocm6-pack-build-$Tag"
New-Item -ItemType Directory -Force -Path $work | Out-Null

# --- resolve the commit for the descriptor ---------------------------------------------
$commit = ""
try {
    $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/$Tag" `
        -Headers @{ "User-Agent" = "slr-rocm6-build" }
    $commit = ($rel.target_commitish).Substring(0, [Math]::Min(12, $rel.target_commitish.Length))
} catch { Write-Warning "Could not resolve the commit for $Tag; the descriptor will carry 'unknown'." }
if (-not $commit) { $commit = "unknown" }

# --- fetch the pinned source -------------------------------------------------------------
$src = Join-Path $work "llama.cpp-$Tag"
if (-not (Test-Path $src)) {
    $zip = Join-Path $work "$Tag.zip"
    Invoke-WebRequest -Uri "https://github.com/ggml-org/llama.cpp/archive/refs/tags/$Tag.zip" -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $work
}
Write-Host "[rocm6] source: $src ($Tag, commit $commit)"

# --- import the MSVC environment (cmake, clang's MSVC headers and linker) ----------------
# vcvarsall is what puts cmake on PATH on a default box and gives the SDK's clang, which
# targets x86_64-pc-windows-msvc, its headers and link.exe. Without it configure fails at
# the very first project() call.
$vcvars = $null
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) {
    $vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($vsPath) {
        $c = Join-Path $vsPath.Trim() "VC\Auxiliary\Build\vcvarsall.bat"
        if (Test-Path $c) { $vcvars = $c }
    }
}
if (-not $vcvars) {
    foreach ($ed in @("Community", "Professional", "BuildTools", "Enterprise")) {
        $c = Join-Path $env:ProgramFiles "Microsoft Visual Studio\2022\$ed\VC\Auxiliary\Build\vcvarsall.bat"
        if (Test-Path $c) { $vcvars = $c; break }
    }
}
if (-not $vcvars) { throw "No vcvarsall.bat found - install VS 2022 with the C++ desktop workload" }
Write-Host "[rocm6] MSVC environment: $vcvars"
foreach ($line in (cmd /c "`"$vcvars`" x64 >nul 2>&1 && set")) {
    if ($line -match '^([^=]+)=(.*)$') { Set-Item -LiteralPath ("Env:" + $Matches[1]) -Value $Matches[2] }
}
if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
    throw "cmake is still not on PATH after importing $vcvars - install the 'C++ CMake tools' VS component or a standalone CMake"
}

# --- locate a working ninja (the pip stub produces no --version output; see report) ------
if (-not $Ninja) {
    # @() must wrap the Where-Object call, not the literal list: a pipeline returns a scalar
    # when only one candidate matches, and $candidates[0] on a scalar string is its FIRST
    # CHARACTER ("C") - a bug the first end-to-end run of this script caught as cmake trying
    # to execute 'C' --version.
    $paths = @(
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Professional\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe"
    )
    $candidates = @($paths | Where-Object { Test-Path $_ })
    if (-not $candidates) { throw "No ninja found; pass -Ninja <path to a working ninja.exe>" }
    $Ninja = $candidates[0]
}
Write-Host "[rocm6] ninja: $Ninja"

# --- the two SDK companions, checked BEFORE the long build (fail fast) -------------------
# See the report: amd_comgr_2.dll ships in ROCm_RTC_RT.msi, not the Core/Libs packages - an
# MSI-carved SDK must include the RTC package or amdhip64_6.dll will not load at runtime.
$comgr = Join-Path $HipPath "bin\amd_comgr_2.dll"
$amdhip = Join-Path $HipPath "bin\amdhip64_6.dll"
foreach ($f in @($comgr, $amdhip)) {
    if (-not (Test-Path $f)) {
        throw "$f not found in the SDK. Note (report deviation 5): amd_comgr_2.dll ships in ROCm_RTC_RT.msi, not the Core/Libs packages - an MSI-carved SDK must include it."
    }
}

# --- configure + build ggml-hip (the report's exact flag set) ----------------------------
# Everything on this line was measured, not guessed: clang from the SDK's bin (there is no
# lib\llvm tree on Windows), CMAKE_PREFIX_PATH so find_package(hip) sees a carved SDK,
# GGML_BACKEND_DL so ggml-hip is a MODULE exporting ggml_backend_init, the CPU/server
# switches so only the backend builds, CMAKE_HIP_COMPILER inert but kept for parity.
$env:HIP_PATH = $HipPath
$env:ROCM_PATH = $HipPath
$env:PATH = "$(Join-Path $HipPath 'bin');$env:PATH"
$targets = "gfx1010;gfx1030;gfx1031;gfx1032;gfx1100;gfx1101;gfx1102;gfx1150;gfx1151"
$build = Join-Path $work "build"
& cmake -S $src -B $build -G Ninja `
    "-DCMAKE_MAKE_PROGRAM=$Ninja" `
    "-DCMAKE_PREFIX_PATH=$HipPath" `
    -DCMAKE_BUILD_TYPE=Release `
    -DGGML_BACKEND_DL=ON `
    -DGGML_NATIVE=OFF `
    -DGGML_CPU=OFF `
    -DGGML_HIP=ON `
    -DHIP_PLATFORM=amd `
    "-DAMDGPU_TARGETS=$targets" `
    "-DCMAKE_C_COMPILER=$(Join-Path $HipPath 'bin\clang.exe')" `
    "-DCMAKE_CXX_COMPILER=$(Join-Path $HipPath 'bin\clang++.exe')" `
    "-DCMAKE_HIP_COMPILER=$(Join-Path $HipPath 'bin\clang.exe')" `
    -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_TOOLS=OFF `
    -DLLAMA_BUILD_SERVER=OFF -DLLAMA_CURL=OFF
if ($LASTEXITCODE -ne 0) { throw "cmake configure failed" }
& cmake --build $build --target ggml-hip --parallel
if ($LASTEXITCODE -ne 0) { throw "cmake build failed" }

$hipDll = Get-ChildItem -Path $build -Recurse -Filter "ggml-hip.dll" | Select-Object -First 1
if (-not $hipDll) { throw "ggml-hip.dll not produced under $build" }
Write-Host "[rocm6] built: $($hipDll.FullName) ($([Math]::Round($hipDll.Length / 1MB)) MiB)"

# --- verify what is verifiable without an AMD GPU (the report's checks) -------------------
# One ASCII pass over the DLL, then substring checks: each gfx target's device code must be
# present (proves the multi-arch build took effect) and the dynamic-backend entry point and
# ggml-base import must both be there (proves GGML_BACKEND_DL did its job).
$bytes = [System.IO.File]::ReadAllBytes($hipDll.FullName)
$text = [System.Text.Encoding]::ASCII.GetString($bytes)
foreach ($gfx in $targets.Split(";")) {
    if (-not $text.Contains($gfx)) { throw "Device code for $gfx missing from ggml-hip.dll - the multi-arch build did not take effect" }
}
Write-Host "[rocm6] device code present for all $($targets.Split(';').Count) gfx targets"
if ($text -notmatch 'ggml_backend_init') { throw "ggml-hip.dll does not export ggml_backend_init - was GGML_BACKEND_DL=ON dropped from the cmake line?" }
if ($text -notmatch 'ggml-base\.dll') { throw "ggml-hip.dll does not import ggml-base.dll - unexpected link; the report measured it as a direct import" }
Write-Host "[rocm6] backend entry point and ggml-base import present"

# --- assemble the pack tree ----------------------------------------------------------------
$stage = Join-Path $work "pack"
$payload = Join-Path $stage "runtime\$Tag\win-x64"
$packsDir = Join-Path $stage "runtime\$Tag\packs"
New-Item -ItemType Directory -Force -Path $payload, $packsDir | Out-Null
Copy-Item $hipDll.FullName, $comgr, $amdhip -Destination $payload

function Sha256($file) { (Get-FileHash -Path $file -Algorithm SHA256).Hash.ToLower() }
$files = [ordered]@{
    "amd_comgr_2.dll" = (Sha256 $comgr)
    "amdhip64_6.dll"  = (Sha256 $amdhip)
    "ggml-hip.dll"    = (Sha256 ($hipDll.FullName))
}

# Hand-rolled JSON rather than ConvertTo-Json: the app's own descriptors are 2-space
# indented with lowercase hashes, and ConvertTo-Json's default -Depth 2 sits exactly on
# the edge of mangling the nested files object.
$fileLines = ($files.GetEnumerator() | Sort-Object Name | ForEach-Object { '    "{0}": "{1}"' -f $_.Key, $_.Value }) -join ",`n"
$descriptor = @"
{
  "backend": "rocm",
  "platformKey": "win-x64",
  "version": "$Tag",
  "commit": "$commit",
  "files": {
$fileLines
  }
}
"@
[System.IO.File]::WriteAllText((Join-Path $packsDir "rocm.json"), $descriptor, [System.Text.Encoding]::ASCII)

$install = @"
SLR Translator - ROCm 6 (HIP) runtime pack - llama.cpp $Tag - Windows x64
For AMD Radeon RX 5000 series and newer, on Windows 10 AND Windows 11.

WHAT THIS IS
  The HIP backend for the bundled local runtime, built against AMD HIP SDK 6.4.2.
  AMD's HIP SDK 7.x is Windows 11 only; the SDK line for Windows 10 stops at 6.4.2,
  which is what this pack uses. On Windows 11 the regular ROCm pack works too.

REQUIREMENTS - READ THIS FIRST
  - An SLR Translator version whose bundled runtime build matches this pack ($Tag).
  - The AMD HIP SDK 6.4.2 for Windows must be installed (a single offline installer
    from AMD's HIP SDK page). This pack is deliberately NOT self-contained: it bundles
    the HIP runtime and its compiler companion only; the BLAS libraries (hipblas,
    rocblas, hipblaslt) come from the SDK's own bin folder. Do not mix this pack with
    a HIP SDK of a different version.

HOW TO INSTALL
  Extract this archive into the SLR Translator folder, so the files land next to the
  existing runtime folder. It adds:
      runtime/$Tag/win-x64/ggml-hip.dll
      runtime/$Tag/win-x64/amdhip64_6.dll
      runtime/$Tag/win-x64/amd_comgr_2.dll
      runtime/$Tag/packs/rocm.json
  Nothing else is overwritten. Restart the app afterwards.

THIS PACK REPLACES THE REGULAR ROCm PACK - INSTALL ONE OR THE OTHER, NEVER BOTH
  Both use the same file names (ggml-hip.dll and packs/rocm.json), so extracting one
  over the other overwrites it. That is by design: only one ROCm backend can be
  registered at a time. After switching you may be left with one orphaned
  amdhip64_*.dll (and rocm_kpack.dll / amd_comgr.dll) that you can delete.

HOW TO USE
  Set "Local runtime backend" to auto or rocm, then press Start / Use Local Runtime.
  The HIP SDK's bin folder is not on the PATH on Windows by default; the app probes
  the SDK's standard install location on its own. If the SDK lives somewhere else,
  add its bin folder to the system PATH or set it as the app's "Local runtime extra
  library folder", and restart the app afterwards. In automatic mode a backend that
  cannot be loaded is skipped and another one runs; with rocm explicitly selected,
  the start fails and reports exactly why.

SUPPORTED GPUS
  gfx1010 (RX 5000), gfx1030/1031/1032 (RX 6000), gfx1100/1101/1102 (RX 7000),
  gfx1150/1151 (RX 600M/700M integrated and low-power), i.e. RX 5000 series and newer.

ABOUT THIS BUILD
  Built from the pinned llama.cpp source (tag $Tag, commit $commit) with the HIP SDK
  6.4.2 toolchain (clang from the SDK, target x86_64-pc-windows-msvc). AMD GPU targets:
  gfx1010 gfx1030 gfx1031 gfx1032 gfx1100 gfx1101 gfx1102 gfx1150 gfx1151.

HOW TO REMOVE
  Delete runtime/$Tag/packs/rocm.json and the three .dll files listed above.
"@
$install | Out-File (Join-Path $stage "INSTALL.txt") -Encoding ascii

# --- cross-check against the app's own payload for this tag, if it is present -------------
# The app merges this descriptor into its manifest and SHA-256-verifies every file, so a
# commit mismatch or a name collision with the base payload would only surface at install
# time on a user machine - check both here instead.
$appManifest = Join-Path $appRoot "runtime\$Tag\manifest.json"
if (Test-Path $appManifest) {
    $m = Get-Content $appManifest -Raw | ConvertFrom-Json
    if ($m.version -ne $Tag) { throw "app manifest for $Tag reports version $($m.version)" }
    if ($m.commit -and $m.commit -ne $commit) {
        throw "descriptor commit $commit does not match the app payload commit $($m.commit) for $Tag"
    }
    $baseFiles = @($m.platforms.'win-x64'.files.PSObject.Properties.Name)
    $overlap = @($files.Keys | Where-Object { $baseFiles -contains $_ })
    if ($overlap) { throw "pack would overwrite base payload files: $($overlap -join ', ')" }
    Write-Host "[rocm6] descriptor matches the app manifest (commit $commit); no base-payload collisions"
} else {
    Write-Warning "No app payload manifest at $appManifest - skipped the commit/overlap cross-check"
}

# --- pack the archive (bundled 7za from the app's node_modules, else 7z on PATH) ----------
$sevenZip = Join-Path $appRoot "node_modules\7zip-bin\win\x64\7za.exe"
if (-not (Test-Path $sevenZip)) { $sevenZip = "7z" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$archive = Join-Path $OutDir "SLR-Translator-ROCm6-pack-$Tag-win-x64.7z"
if (Test-Path $archive) { Remove-Item $archive }
Push-Location $stage
& $sevenZip a -t7z "-mmt=on" $archive "runtime\$Tag" "INSTALL.txt" | Out-Null
Pop-Location
if ($LASTEXITCODE -ne 0) { throw "7z packing failed" }

# --- verify the archive: extract it back and re-check every hash --------------------------
$vdir = Join-Path $work "verify"
if (Test-Path $vdir) { Remove-Item $vdir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $vdir | Out-Null
& $sevenZip x "-o$vdir" $archive | Out-Null
if ($LASTEXITCODE -ne 0) { throw "the archive did not extract cleanly" }
foreach ($rel in (@("INSTALL.txt", "runtime\$Tag\packs\rocm.json") + @($files.Keys | ForEach-Object { "runtime\$Tag\win-x64\$_" }))) {
    if (-not (Test-Path (Join-Path $vdir $rel))) { throw "archive is missing $rel" }
}
foreach ($name in @($files.Keys)) {
    $h = (Get-FileHash -Path (Join-Path $vdir "runtime\$Tag\win-x64\$name") -Algorithm SHA256).Hash.ToLower()
    if ($h -ne $files[$name]) { throw "$name came back with a different hash from the archive" }
}
$shipped = Get-Content (Join-Path $vdir "runtime\$Tag\packs\rocm.json") -Raw
if ($shipped -notmatch [regex]::Escape($files["ggml-hip.dll"])) { throw "the descriptor inside the archive does not carry the built DLL's hash" }
Write-Host "[rocm6] archive extracted and all $($files.Count) hashes re-verified"

Write-Host ""
Write-Host "[rocm6] wrote $archive ($([Math]::Round((Get-Item $archive).Length / 1MB)) MiB)"
Write-Host "[rocm6] descriptor: backend rocm, $Tag ($commit), files:"
$files.GetEnumerator() | Sort-Object Name | ForEach-Object { Write-Host "           $($_.Key)  $($_.Value)" }
Write-Host ""
Write-Host "[rocm6] Built and structurally verified; like the b10964/b11429 packs it was NOT"
Write-Host "[rocm6] run on AMD hardware (this recipe needs none to build). Confirm once on a real"
Write-Host "[rocm6] RX card via Runtime Status before shipping."
