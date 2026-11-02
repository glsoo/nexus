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
# The logo goes into the exe, so the taskbar, Start, Explorer and the desktop shortcut show it instead of a blank program icon.
# Frames at 256 (PNG), 48, 32 and 16 pixels (32-bit bitmaps, which every reader of .ico files handles), from the web app's icon.
$icon = Join-Path $PSScriptRoot 'Nexus.ico'
Add-Type -AssemblyName System.Drawing
$logo = [System.Drawing.Image]::FromFile((Join-Path $root 'public\icon-180.png'))
try {
    $frames = foreach ($size in 256, 48, 32, 16) {
        $bitmap = New-Object System.Drawing.Bitmap $size, $size
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.DrawImage($logo, 0, 0, $size, $size)
        $graphics.Dispose()
        $stream = New-Object System.IO.MemoryStream
        if ($size -eq 256) { $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png) }
        else {
            # BITMAPINFOHEADER (height doubled for the mask), bottom-up BGRA rows, then an all-zero AND mask; alpha does the masking.
            $dib = New-Object System.IO.BinaryWriter $stream
            $dib.Write([uint32]40); $dib.Write([int32]$size); $dib.Write([int32]($size * 2)); $dib.Write([uint16]1); $dib.Write([uint16]32)
            $dib.Write([uint32]0); $dib.Write([uint32]0); $dib.Write([int32]0); $dib.Write([int32]0); $dib.Write([uint32]0); $dib.Write([uint32]0)
            for ($y = $size - 1; $y -ge 0; $y--) {
                for ($x = 0; $x -lt $size; $x++) { $c = $bitmap.GetPixel($x, $y); $dib.Write([byte[]]@($c.B, $c.G, $c.R, $c.A)) }
            }
            $dib.Write((New-Object byte[] ([int]([math]::Ceiling($size / 32) * 4 * $size))))
            $dib.Flush()
        }
        $bitmap.Dispose()
        , @($size, $stream.ToArray())
    }
} finally { $logo.Dispose() }
$writer = New-Object System.IO.BinaryWriter ([System.IO.File]::Create($icon))
try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$frames.Count)
    $offset = 6 + 16 * $frames.Count
    foreach ($frame in $frames) {
        $side = [byte]($frame[0] % 256)  # 0 means 256
        $writer.Write($side); $writer.Write($side); $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$frame[1].Length); $writer.Write([uint32]$offset)
        $offset += $frame[1].Length
    }
    foreach ($frame in $frames) { $writer.Write([byte[]]$frame[1]) }
} finally { $writer.Dispose() }
& $compiler /nologo /target:winexe /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.Security.dll "/win32icon:$icon" "/out:$output" (Join-Path $PSScriptRoot 'NexusLauncher.cs')
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