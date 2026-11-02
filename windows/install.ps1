param([switch]$Launch)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$env:Path = $env:Path + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links')
foreach ($command in 'node.exe', 'npm.cmd', 'git.exe', 'rg.exe') {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Missing $command. Install Node.js 24+, Git for Windows, and ripgrep first." }
}
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework 4.8 is required for the Windows launcher.' }
if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules\node-pty\package.json'))) {
    & npm.cmd --prefix $root ci --no-fund --no-audit
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
$output = Join-Path $PSScriptRoot 'Nexus.exe'
& $compiler /nologo /target:winexe /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.Security.dll "/out:$output" (Join-Path $PSScriptRoot 'NexusLauncher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Windows launcher compilation failed. Close the launcher before rebuilding.' }
$shell = New-Object -ComObject WScript.Shell
$shortcut = $null
try {
    $shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Nexus.lnk'
    $shortcut = $shell.CreateShortcut($shortcutPath)
    if ((Test-Path -LiteralPath $shortcutPath) -and $shortcut.TargetPath -ne $output) { throw 'A different Nexus desktop shortcut already exists; it has not been changed.' }
    $shortcut.TargetPath = $output
    $shortcut.WorkingDirectory = $root
    $shortcut.Description = 'Nexus local coding workspace'
    $shortcut.Save()
} finally {
    if ($null -ne $shortcut) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) }
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
}
Write-Output "Installed launcher: $output"
Write-Output 'Desktop shortcut: Nexus'
if ($Launch) { Start-Process -FilePath $output -WorkingDirectory $root }