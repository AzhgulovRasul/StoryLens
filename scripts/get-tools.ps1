$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$toolDir = Join-Path $root 'tools'
New-Item -ItemType Directory -Force (Join-Path $toolDir 'downloads'), (Join-Path $toolDir 'licenses') | Out-Null
$packages = @(
    @{ Name='pandoc'; Url='https://github.com/jgm/pandoc/releases/download/3.12.1/pandoc-3.12.1-windows-x86_64.zip'; Hash='6ef431cb20b2c24a0371fc19200dc49d452be54b1b5c9239f3462841ef53e587' },
    @{ Name='typst'; Url='https://github.com/typst/typst/releases/download/v0.15.1/typst-x86_64-pc-windows-msvc.zip'; Hash='19ce3551153c2fe7ee9fa2f95208310c8f4d3209fedb699e0333faf8913f6736' }
)
foreach ($package in $packages) {
    $zip = Join-Path $toolDir ('downloads/' + $package.Name + '.zip')
    if (!(Test-Path -LiteralPath $zip)) { Invoke-WebRequest $package.Url -OutFile $zip -UseBasicParsing }
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $package.Hash) { throw ('Checksum mismatch: ' + $package.Name) }
    $out = [IO.Path]::GetFullPath((Join-Path $toolDir ('downloads/' + $package.Name)))
    $downloadRoot = [IO.Path]::GetFullPath((Join-Path $toolDir 'downloads'))
    if (!$out.StartsWith($downloadRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid extraction destination' }
    if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Recurse -Force }
    Expand-Archive -LiteralPath $zip -DestinationPath $out -Force
    $exe = Get-ChildItem -LiteralPath $out -Recurse -Filter ($package.Name + '.exe') | Select-Object -First 1
    Copy-Item -LiteralPath $exe.FullName -Destination (Join-Path $toolDir ($package.Name + '.exe')) -Force
    Get-ChildItem -LiteralPath $out -Recurse -File | Where-Object { $_.Name -match '^(COPYING|COPYRIGHT|LICENSE|NOTICE)' } | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $toolDir ('licenses/' + $package.Name + '-' + $_.Name)) -Force
    }
}
Write-Host 'Local conversion tools ready.'
