# One-line install for Windows, in PowerShell:
#   irm https://raw.githubusercontent.com/glsoo/nexus/main/scripts/get-nexus.ps1 | iex
# Installs Git, Node.js and ripgrep with winget if they're missing, clones Nexus (or updates a clone already there),
# then builds the launcher, adds a desktop shortcut and opens it. NEXUS_DIR picks the folder (default ~\nexus); NEXUS_REPO a fork.
$ErrorActionPreference = 'Stop'
$dir = if ($env:NEXUS_DIR) { $env:NEXUS_DIR } else { Join-Path $HOME 'nexus' }
$repo = if ($env:NEXUS_REPO) { $env:NEXUS_REPO } else { 'https://github.com/glsoo/nexus.git' }
$refresh = { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links') }
foreach ($tool in @(@('git.exe', 'Git.Git'), @('node.exe', 'OpenJS.NodeJS'), @('rg.exe', 'BurntSushi.ripgrep.MSVC'))) {
    if (Get-Command $tool[0] -ErrorAction SilentlyContinue) { continue }
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw "Install $($tool[1]) first (winget isn't available here)." }
    Write-Host "Installing $($tool[1]) with winget..."
    & winget.exe install --id $tool[1] -e --silent --accept-source-agreements --accept-package-agreements
    & $refresh
    if (-not (Get-Command $tool[0] -ErrorAction SilentlyContinue)) { throw "$($tool[1]) didn't install. Install it, then run this again." }
}
$major = [int]((& node.exe -v).TrimStart('v').Split('.')[0])
if ($major -lt 24) { throw "Nexus needs Node.js 24 or newer, and this is $(& node.exe -v). Run: winget upgrade OpenJS.NodeJS" }

if (Test-Path -LiteralPath (Join-Path $dir '.git')) {
    Write-Host "Updating Nexus in $dir"
    & git.exe -C $dir pull -q --ff-only
} else {
    Write-Host "Installing Nexus into $dir"
    & git.exe clone -q $repo $dir
}
if ($LASTEXITCODE -ne 0) { throw 'Git could not get Nexus. Check your connection and try again.' }
# The first time it opens, the launcher makes a login (Copy Password copies it). Its Settings set API keys and the port.
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir 'windows\install.ps1') -Launch
if ($LASTEXITCODE -ne 0) { throw 'Building the launcher failed; see the message above.' }
