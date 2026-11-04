# Restarts Nexus once an update has gone in. The server starts this so it runs outside the launcher's process tree, then stops
# itself gracefully. This waits for that, closes the launcher, rebuilds it from the updated source and opens it again, minimized
# and without a new browser tab: the open page reconnects by itself.
param([int]$ServerPid, [int]$LauncherPid)
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $PSScriptRoot 'Nexus.exe'
$log = Join-Path $root 'data\update-restart.log'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $log) | Out-Null
function Log([string]$m) { Add-Content -LiteralPath $log -Value ('{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $m) -Encoding UTF8 }

Log "Restarting after an update (server $ServerPid, launcher $LauncherPid)."
Wait-Process -Id $ServerPid -Timeout 20 -ErrorAction SilentlyContinue
$launcher = Get-Process -Id $LauncherPid -ErrorAction SilentlyContinue
if ($launcher -and $launcher.Path -eq $exe) {
    [void]$launcher.CloseMainWindow()
    if (-not $launcher.WaitForExit(25000)) { Log 'The launcher did not close in 25 s, so stopping it.'; Stop-Process -Id $LauncherPid -Force; [void]$launcher.WaitForExit(5000) }
}
try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'install.ps1') 2>&1 | ForEach-Object { Log "  $_" }
    if ($LASTEXITCODE -ne 0) { Log "install.ps1 exited with $LASTEXITCODE; starting the launcher that is there." }
} catch { Log "Rebuilding the launcher failed: $($_.Exception.Message). Starting the one that is there." }
Start-Process -FilePath $exe -ArgumentList '--updated' -WorkingDirectory $root -WindowStyle Minimized
Log 'Started the launcher.'
