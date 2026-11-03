# Usage: win.ps1 <pid> <list|show|hide|small>
param([int]$ProcessId, [string]$Action)
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text; using System.Collections.Generic;
public static class W {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(P cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  public struct RECT { public int L, T, R, B; }
  public static List<IntPtr> Tauri(uint pid) {
    var o = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); var c = new StringBuilder(64); GetClassName(h, c, 64);
      if (p == pid && c.ToString() == "Tauri Window") o.Add(h); return true; }, IntPtr.Zero);
    return o;
  }
}
"@
# The overlay is the Tauri window that starts hidden; the home window is visible.
$overlay = [W]::Tauri($ProcessId) | Where-Object { -not [W]::IsWindowVisible($_) -or $Action -eq 'hide' -or $Action -eq 'list' } | Select-Object -First 1
$HWND_TOPMOST = [IntPtr]-1
switch ($Action) {
  'list'  { foreach ($h in [W]::Tauri($ProcessId)) { $r = New-Object W+RECT; [void][W]::GetWindowRect($h, [ref]$r); "0x{0:X} vis={1} {2},{3} {4}x{5}" -f $h.ToInt64(), [W]::IsWindowVisible($h), $r.L, $r.T, ($r.R-$r.L), ($r.B-$r.T) } }
  'show'  { [void][W]::SetWindowPos([IntPtr][long]$env:OVERLAY, $HWND_TOPMOST, 0, 0, 0, 0, 0x0002 -bor 0x0001 -bor 0x0010 -bor 0x0040); "shown" }
  'hide'  { [void][W]::ShowWindow([IntPtr][long]$env:OVERLAY, 0); "hidden" }
  'small' { [void][W]::SetWindowPos([IntPtr][long]$env:OVERLAY, [IntPtr]::Zero, 40, 40, 240, 160, 0x0010 -bor 0x0004); "moved" }
}
