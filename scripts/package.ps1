$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
& node scripts/third-party-notices.mjs
if ($LASTEXITCODE -ne 0) { throw 'License collection failed' }
& npm.cmd run tauri -- build --no-bundle
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $root 'release'))
$dest = [IO.Path]::GetFullPath((Join-Path $releaseRoot 'StoryLens'))
if ($dest -ne (Join-Path $releaseRoot 'StoryLens') -or !$dest.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid packaging destination' }
if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
New-Item -ItemType Directory -Force $dest, (Join-Path $dest 'scripts') | Out-Null
New-Item -ItemType Directory -Force (Join-Path $dest 'docs') | Out-Null
Copy-Item -LiteralPath 'src-tauri/target/release/storylens.exe' -Destination (Join-Path $dest 'StoryLens.exe')
Copy-Item -LiteralPath 'README.md','README.en.md','LICENSE','THIRD_PARTY.md','THIRD_PARTY_NOTICES.txt','Prepare-converters.cmd','ARCHITECTURE.md','DECISIONS.md','PLAN.md','QA_RESULTS.md','QA_MANUAL.md' -Destination $dest
Copy-Item -LiteralPath 'docs/editor.png' -Destination (Join-Path $dest 'docs')
Copy-Item -LiteralPath 'scripts/get-tools.ps1' -Destination (Join-Path $dest 'scripts')
# Converters are obtained directly from upstream by the user, not redistributed.
$archive = Join-Path $releaseRoot "StoryLens-$version-windows-x64.zip"
Compress-Archive -LiteralPath $dest -DestinationPath $archive -Force
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($archive))" | Set-Content -Encoding ascii (Join-Path $releaseRoot 'SHA256SUMS.txt')
Write-Host "$archive`nSHA256: $hash"
