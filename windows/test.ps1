param([int]$LauncherId = 0, [int]$Port = 7711)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
if (-not ('NexusNativeWindow' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class NexusNativeWindow {
    private delegate bool Visitor(IntPtr window, IntPtr context);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, Visitor visitor, IntPtr context);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int length);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder text, int length);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    public static string[] Buttons(IntPtr parent) {
        var names = new List<string>();
        EnumChildWindows(parent, delegate(IntPtr window, IntPtr context) {
            var type = new StringBuilder(256);
            GetClassName(window, type, type.Capacity);
            if (type.ToString().StartsWith("WindowsForms10.BUTTON") && IsWindowVisible(window)) {
                var text = new StringBuilder(256);
                GetWindowText(window, text, text.Capacity);
                names.Add(text.ToString());
            }
            return true;
        }, IntPtr.Zero);
        return names.ToArray();
    }
}
'@
}
$root = Split-Path -Parent $PSScriptRoot
if ($LauncherId -eq 0) {
    $candidates = @(Get-Process -Name Nexus -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $PSScriptRoot 'Nexus.exe') })
    if ($candidates.Count -ne 1) { throw 'Start this checkout with its Nexus desktop shortcut first.' }
    $LauncherId = $candidates[0].Id
}
$launcher = Get-Process -Id $LauncherId
$launcher.Refresh()
if ($launcher.MainWindowTitle -ne 'Nexus Launcher') { throw 'The native launcher window is not ready.' }
$names = [NexusNativeWindow]::Buttons($launcher.MainWindowHandle)
foreach ($name in 'Open Nexus', 'Settings', 'Copy Password', 'Stop', 'Server Log') {
    if ($names -notcontains $name) { throw "Native control missing: $name. Found: $($names -join ', ')" }
}
$nodes = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $LauncherId" | Where-Object { $_.Name -eq 'node.exe' })
if ($nodes.Count -ne 1) { throw 'Expected exactly one owned Nexus server process.' }
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port | Where-Object { $_.OwningProcess -eq $nodes[0].ProcessId })
if ($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1') { throw 'The server must listen only on IPv4 localhost.' }
$hash = [Security.Cryptography.SHA256]::Create()
try { $scope = ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToUpperInvariant())))).Replace('-', '').Substring(0, 16) }
finally { $hash.Dispose() }
$credentialPath = Join-Path $env:LOCALAPPDATA "Nexus\$scope\login.dpapi"
$plain = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($credentialPath), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$url = "http://127.0.0.1:$Port"
$authenticated = $false
try {
    $payload = [Text.Encoding]::UTF8.GetString($plain)
    $login = Invoke-WebRequest -UseBasicParsing -Uri "$url/api/login" -Method Post -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($payload)) -WebSession $session
    if ($login.StatusCode -ne 200) { throw 'Login verification failed.' }
    $authenticated = $true
    $projects = Invoke-WebRequest -UseBasicParsing -Uri "$url/api/projects" -WebSession $session
    if ($projects.StatusCode -ne 200) { throw 'Authenticated project access failed.' }
    $version = (Invoke-WebRequest -UseBasicParsing -Uri "$url/api/version" -WebSession $session).Content | ConvertFrom-Json
    if ($version.auto) { throw 'Linux-only automatic updates must be off on Windows.' }
    foreach ($asset in 'marked.js', 'purify.js', 'xterm.js', 'fit.js') {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "$url/vendor/$asset"
        if ($response.StatusCode -ne 200) { throw "Missing browser asset: $asset" }
    }
    [pscustomobject]@{
        NativeControls = 'PASS'
        Login = 'PASS'
        AuthenticatedAPI = 'PASS'
        BrowserAssets = 'PASS'
        LocalhostOnly = 'PASS'
        AutomaticUpdates = 'OFF'
        ServerPID = $nodes[0].ProcessId
        SecretsPrinted = $false
    } | Format-List
} finally {
    if ($authenticated) { $null = Invoke-WebRequest -UseBasicParsing -Uri "$url/api/logout" -Method Post -WebSession $session }
    [Array]::Clear($plain, 0, $plain.Length)
    $payload = $null
}