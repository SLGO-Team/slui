# Per-process CPU of an app and its WebView2 children over -Seconds (ROOT_PID env picks the app process).
param([int]$Seconds = 5)
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class W {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
$fg = [W]::GetForegroundWindow(); $fp = 0; [void][W]::GetWindowThreadProcessId($fg, [ref]$fp)
"foreground pid: $fp ($((Get-Process -Id $fp).ProcessName))"
$root = if ($env:ROOT_PID) { [int]$env:ROOT_PID } else { (Get-Process slui | Select-Object -First 1).Id }
$kids = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedgewebview2.exe' }
$tree = @($root); $changed = $true
while ($changed) { $changed = $false; foreach ($k in $kids) { if ($tree -contains $k.ParentProcessId -and -not ($tree -contains $k.ProcessId)) { $tree += $k.ProcessId; $changed = $true } } }
$types = @{}; foreach ($k in $kids) { if ($tree -contains $k.ProcessId) { $m = [regex]::Match($k.CommandLine, '--type=(\S+)'); $types[$k.ProcessId] = if ($m.Success) { $m.Groups[1].Value } else { 'browser' } } }
$types[$root] = 'slui'
$a = @{}; foreach ($p in $tree) { $a[$p] = (Get-Process -Id $p).TotalProcessorTime.TotalMilliseconds }
Start-Sleep -Seconds $Seconds
foreach ($p in $tree) { $d = (Get-Process -Id $p).TotalProcessorTime.TotalMilliseconds - $a[$p]; "{0,6} {1,-16} {2,8:N1} ms/s" -f $p, $types[$p], ($d / $Seconds) }
