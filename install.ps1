# Install Commander into a Herdr app configuration on Windows.
# Run with Windows PowerShell 5.1 or newer; no package manager is used.
[CmdletBinding()]
param(
    [string] $ConfigDir = $(if ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $HOME '.config\herdr-app' }),
    [switch] $SwitchLayout
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$configRoot = [System.IO.Path]::GetFullPath($ConfigDir)
$backupRoot = $null
$copied = 0
$unchanged = 0
$addedKeys = 0
$conflicts = New-Object 'System.Collections.Generic.List[string]'

function Get-BackupPath([string] $relativePath) {
    if (-not $script:backupRoot) {
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $suffix = [guid]::NewGuid().ToString('N').Substring(0, 8)
        $script:backupRoot = Join-Path $script:configRoot ('.commander-backups\{0}-{1}' -f $stamp, $suffix)
    }
    $destination = Join-Path $script:backupRoot $relativePath
    $parent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    return $destination
}

function Copy-CommanderFile([string] $relativePath) {
    $source = Join-Path $script:sourceRoot $relativePath
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Missing Commander source file: $source"
    }
    $destination = Join-Path $script:configRoot $relativePath
    $parent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Path $parent -Force | Out-Null

    if (Test-Path -LiteralPath $destination) {
        if (-not (Test-Path -LiteralPath $destination -PathType Leaf)) {
            throw "Destination is not a file: $destination"
        }
        $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
        $targetHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
        if ($sourceHash -eq $targetHash) {
            $script:unchanged++
            return
        }
        Copy-Item -LiteralPath $destination -Destination (Get-BackupPath $relativePath) -ErrorAction Stop
    }
    Copy-Item -LiteralPath $source -Destination $destination -ErrorAction Stop
    $script:copied++
}

function Read-JsonObject([string] $path) {
    $value = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($null -eq $value -or $value -isnot [pscustomobject]) {
        throw "Expected a JSON object in $path"
    }
    return $value
}

function Get-JsonProperty([psobject] $object, [string] $name) {
    return $object.PSObject.Properties[$name]
}

if (-not (Test-Path -LiteralPath $configRoot -PathType Container)) {
    throw "Herdr configuration folder does not exist: $configRoot"
}
if (-not (Test-Path -LiteralPath (Join-Path $configRoot 'AGENTS.md') -PathType Leaf)) {
    Write-Warning "No Herdr AGENTS.md found in $configRoot; check that this is the correct configuration folder."
}

# Keep the installed file list explicit for layouts/themes. Walk only Commander's
# own mod and background folders; this leaves shipped and other custom files alone.
$files = New-Object 'System.Collections.Generic.List[string]'
foreach ($relative in @('layouts\commander.json', 'layouts\commander.svg',
                         'themes\commander.json', 'themes\commander-navy.json')) {
    $files.Add($relative)
}
foreach ($folder in @(Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'mods') -Directory -Filter 'cmdr-*') +
                   @(Get-Item -LiteralPath (Join-Path $sourceRoot 'backgrounds\commander-earth'))) {
    foreach ($file in Get-ChildItem -LiteralPath $folder.FullName -File -Recurse) {
        $relative = $file.FullName.Substring($sourceRoot.Length).TrimStart('\', '/')
        # Herdr checks and Python tests can create local artifacts beside source
        # files. They are never part of the Commander install payload.
        if ($relative -match '(^|[\\/])(__pycache__|node_modules|\.git)([\\/]|$)' -or
            $file.Name -in @('jsconfig.json', 'gpui-kit.d.ts', 'herdr.d.ts') -or
            $file.Name -match '(\.d\.ts|\.pyc|\.error)$') { continue }
        $files.Add($relative)
    }
}
# Validate the entire source and both JSON documents before changing the app.
foreach ($relative in $files) {
    if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot $relative) -PathType Leaf)) {
        throw "Missing Commander source file: $relative"
    }
}
$sourceKeys = Read-JsonObject (Join-Path $sourceRoot 'keys.json')
$targetKeysPath = Join-Path $configRoot 'keys.json'
if (Test-Path -LiteralPath $targetKeysPath) {
    $targetKeys = Read-JsonObject $targetKeysPath
} else {
    $targetKeys = [pscustomobject]@{}
}
# The app owns keys.json. Add only missing Commander bindings. A different value
# for the same shortcut is a conflict: retain the user's binding and report it.
foreach ($layoutProperty in $sourceKeys.PSObject.Properties) {
    $layoutName = $layoutProperty.Name
    if ($layoutProperty.Value -isnot [pscustomobject]) {
        throw "Expected a shortcut object for $layoutName in source keys.json"
    }
    $targetLayoutProperty = Get-JsonProperty $targetKeys $layoutName
    if ($null -eq $targetLayoutProperty) {
        $targetKeys | Add-Member -NotePropertyName $layoutName -NotePropertyValue ([pscustomobject]@{})
        $targetLayoutProperty = Get-JsonProperty $targetKeys $layoutName
    } elseif ($targetLayoutProperty.Value -isnot [pscustomobject]) {
        throw "Expected a shortcut object for $layoutName in $targetKeysPath"
    }
    foreach ($binding in $layoutProperty.Value.PSObject.Properties) {
        $existing = Get-JsonProperty $targetLayoutProperty.Value $binding.Name
        if ($null -eq $existing) {
            $targetLayoutProperty.Value | Add-Member -NotePropertyName $binding.Name -NotePropertyValue $binding.Value
            $addedKeys++
        } elseif ($existing.Value -cne $binding.Value) {
            $conflicts.Add(('{0} / {1}: kept {2}; Commander requests {3}' -f
                $layoutName, $binding.Name, ($existing.Value | ConvertTo-Json -Compress -Depth 100),
                ($binding.Value | ConvertTo-Json -Compress -Depth 100)))
        }
    }
}
foreach ($relative in $files) { Copy-CommanderFile $relative }
if ($addedKeys -gt 0 -or -not (Test-Path -LiteralPath $targetKeysPath)) {
    if (Test-Path -LiteralPath $targetKeysPath) {
        Copy-Item -LiteralPath $targetKeysPath -Destination (Get-BackupPath 'keys.json') -ErrorAction Stop
    }
    $json = $targetKeys | ConvertTo-Json -Depth 100
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $temp = Join-Path $configRoot ('.keys.commander-{0}.tmp' -f [guid]::NewGuid().ToString('N'))
    try {
        [System.IO.File]::WriteAllText($temp, ($json + [Environment]::NewLine), $utf8)
        Move-Item -LiteralPath $temp -Destination $targetKeysPath -Force
    } finally {
        if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp }
    }
}

Write-Host ("Commander: copied {0} files, left {1} identical files, added {2} shortcuts." -f $copied, $unchanged, $addedKeys)
if ($backupRoot) { Write-Host "Backups: $backupRoot" }
if ($conflicts.Count -gt 0) {
    Write-Warning ("Kept {0} existing shortcut binding(s):" -f $conflicts.Count)
    foreach ($conflict in $conflicts) { Write-Warning $conflict }
}

if ($SwitchLayout) {
    $app = Get-Command 'herdr-app' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $app) { throw 'herdr-app is not on PATH. Commander files are installed; switch layouts from Herdr when available.' }
    # The Windows app is a GUI executable; direct invocation can return before
    # its helper command finishes and leave LASTEXITCODE stale. Wait explicitly.
    $previousHome = [Environment]::GetEnvironmentVariable('HERDR_APP_HOME', 'Process')
    try {
        [Environment]::SetEnvironmentVariable('HERDR_APP_HOME', $configRoot, 'Process')
        $process = Start-Process -FilePath $app.Source -ArgumentList @('do', 'layout.switch', '--name', 'commander') -Wait -PassThru -WindowStyle Hidden
        if ($process.ExitCode -ne 0) { throw "herdr-app could not switch to Commander (exit $($process.ExitCode))." }
    } finally {
        [Environment]::SetEnvironmentVariable('HERDR_APP_HOME', $previousHome, 'Process')
    }
}
