# Native Windows PowerShell regression checks. No Pester or live Herdr install.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$installer = Join-Path $repoRoot 'install.ps1'
$tempParent = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$tempRoot = Join-Path $tempParent ('commander-install-test-' + [guid]::NewGuid().ToString('N'))

function Assert([bool] $condition, [string] $message) {
    if (-not $condition) { throw $message }
}

try {
    $config = Join-Path $tempRoot 'Herdr config with spaces'
    New-Item -ItemType Directory -Path (Join-Path $config 'layouts') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $config 'AGENTS.md') -Value 'Fake Herdr config for tests' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $config 'layouts\commander.json') -Value 'old commander file' -Encoding UTF8
    $oldKeys = @'
{
  "global": { "ctrl-k": "other.command" },
  "layout:commander": {
    "ctrl-shift-r": "my.reply",
    "ctrl-q": "my.custom"
  }
}
'@
    Set-Content -LiteralPath (Join-Path $config 'keys.json') -Value $oldKeys -Encoding UTF8

    & $installer -ConfigDir $config
    $keys = Get-Content -LiteralPath (Join-Path $config 'keys.json') -Raw | ConvertFrom-Json
    Assert ($keys.global.'ctrl-k' -eq 'other.command') 'Unrelated layout key was changed.'
    Assert ($keys.'layout:commander'.'ctrl-shift-r' -eq 'my.reply') 'Conflicting shortcut was overwritten.'
    Assert ($keys.'layout:commander'.'ctrl-q' -eq 'my.custom') 'Custom Commander shortcut was lost.'
    Assert ($keys.'layout:commander'.'ctrl-shift-j' -eq 'cmdr-tree.project') 'New Commander shortcut was not added.'
    Assert ((Get-FileHash -LiteralPath (Join-Path $config 'layouts\commander.json') -Algorithm SHA256).Hash -eq
            (Get-FileHash -LiteralPath (Join-Path $repoRoot 'layouts\commander.json') -Algorithm SHA256).Hash) 'Commander layout was not installed.'
    Assert (Test-Path -LiteralPath (Join-Path $config 'mods\cmdr-todo\runtime.js') -PathType Leaf) 'Runtime helper was not copied.'
    Assert (-not (Test-Path -LiteralPath (Join-Path $config 'mods\cmdr-tree\gpui-kit.d.ts'))) 'Generated type file was copied.'
    Assert (-not (Test-Path -LiteralPath (Join-Path $config 'mods\cmdr-tree\jsconfig.json'))) 'Generated jsconfig was copied.'
    Assert (-not (Test-Path -LiteralPath (Join-Path $config 'mods\cmdr-todo\__pycache__'))) 'Python cache was copied.'
    $backups = @(Get-ChildItem -LiteralPath (Join-Path $config '.commander-backups') -Directory)
    Assert ($backups.Count -eq 1) 'Expected one backup set.'
    Assert ((Get-Content -LiteralPath (Join-Path $backups[0].FullName 'layouts\commander.json') -Raw).Trim() -eq 'old commander file') 'Replaced layout was not backed up.'
    $backedKeys = Get-Content -LiteralPath (Join-Path $backups[0].FullName 'keys.json') -Raw | ConvertFrom-Json
    Assert ($backedKeys.'layout:commander'.'ctrl-shift-r' -eq 'my.reply') 'Original keys were not backed up.'

    $keysHash = (Get-FileHash -LiteralPath (Join-Path $config 'keys.json') -Algorithm SHA256).Hash
    & $installer -ConfigDir $config
    Assert ((Get-FileHash -LiteralPath (Join-Path $config 'keys.json') -Algorithm SHA256).Hash -eq $keysHash) 'Repeat install rewrote keys.json.'
    Assert (@(Get-ChildItem -LiteralPath (Join-Path $config '.commander-backups') -Directory).Count -eq 1) 'Repeat install made an unnecessary backup.'

    # A harmless command fixture checks that GUI command switching waits for
    # completion, receives the target config, and restores the caller's env.
    $bin = Join-Path $tempRoot 'fake bin with spaces'
    New-Item -ItemType Directory -Path $bin -Force | Out-Null
    $fakeApp = Join-Path $bin 'herdr-app.cmd'
    $marker = Join-Path $bin 'switch-result.txt'
    Set-Content -LiteralPath $fakeApp -Encoding ASCII -Value @'
@echo off
echo %HERDR_APP_HOME% ^| %* > "%~dp0switch-result.txt"
exit /b 0
'@
    $oldPath = [Environment]::GetEnvironmentVariable('PATH', 'Process')
    $oldHome = [Environment]::GetEnvironmentVariable('HERDR_APP_HOME', 'Process')
    try {
        [Environment]::SetEnvironmentVariable('PATH', ($bin + ';' + $oldPath), 'Process')
        [Environment]::SetEnvironmentVariable('HERDR_APP_HOME', $config, 'Process')
        & $installer -SwitchLayout
        Assert ([Environment]::GetEnvironmentVariable('HERDR_APP_HOME', 'Process') -eq $config) 'Installer did not restore HERDR_APP_HOME.'
        $result = (Get-Content -LiteralPath $marker -Raw).Trim()
        Assert ($result -eq "$config | do layout.switch --name commander") 'Switch command did not receive selected config and arguments.'
        Assert (@(Get-ChildItem -LiteralPath (Join-Path $config '.commander-backups') -Directory).Count -eq 1) 'Env-based default install created an unnecessary backup.'
        Set-Content -LiteralPath $fakeApp -Encoding ASCII -Value '@echo off', 'exit /b 7'
        $failedSwitch = $false
        try { & $installer -SwitchLayout | Out-Null } catch { $failedSwitch = ($_.Exception.Message -match 'exit 7') }
        Assert $failedSwitch 'A failed app command was not reported by exit code.'
        Assert ([Environment]::GetEnvironmentVariable('HERDR_APP_HOME', 'Process') -eq $config) 'Failed switch did not restore HERDR_APP_HOME.'
    } finally {
        [Environment]::SetEnvironmentVariable('PATH', $oldPath, 'Process')
        [Environment]::SetEnvironmentVariable('HERDR_APP_HOME', $oldHome, 'Process')
    }

    $invalid = Join-Path $tempRoot 'Invalid config'
    New-Item -ItemType Directory -Path (Join-Path $invalid 'layouts') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $invalid 'AGENTS.md') -Value 'Fake Herdr config for tests' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $invalid 'layouts\commander.json') -Value 'must stay' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $invalid 'keys.json') -Value '{ invalid' -Encoding UTF8
    $failed = $false
    try { & $installer -ConfigDir $invalid | Out-Null } catch { $failed = $true }
    Assert $failed 'Malformed keys.json should fail.'
    Assert ((Get-Content -LiteralPath (Join-Path $invalid 'layouts\commander.json') -Raw).Trim() -eq 'must stay') 'Malformed JSON caused a partial install.'
    Assert (-not (Test-Path -LiteralPath (Join-Path $invalid '.commander-backups'))) 'Malformed JSON created a backup set.'
    Write-Host 'Windows installer checks passed.'
} finally {
    # The only recursive deletion is this uniquely named temporary fixture.
    $resolved = [System.IO.Path]::GetFullPath($tempRoot)
    Assert ($resolved.StartsWith($tempParent, [System.StringComparison]::OrdinalIgnoreCase) -and
            $resolved -ne $tempParent -and (Split-Path -Leaf $resolved) -like 'commander-install-test-*') 'Unsafe test cleanup path.'
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
