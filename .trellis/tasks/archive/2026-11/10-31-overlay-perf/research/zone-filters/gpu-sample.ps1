# CPU ms/s of an app's WebView2 GPU and renderer processes, and the GPU process's GPU engine utilization, over -Seconds.
param([int]$RootPid, [int]$Seconds = 8)
$kids = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedgewebview2.exe' }
$tree = @($RootPid); $changed = $true
while ($changed) { $changed = $false; foreach ($k in $kids) { if ($tree -contains $k.ParentProcessId -and -not ($tree -contains $k.ProcessId)) { $tree += $k.ProcessId; $changed = $true } } }
$typed = foreach ($k in $kids) { if ($tree -contains $k.ProcessId) { $m = [regex]::Match($k.CommandLine, '--type=(\S+)'); if ($m.Success -and ($m.Groups[1].Value -in 'gpu-process','renderer')) { [pscustomobject]@{ Id = $k.ProcessId; Type = $m.Groups[1].Value } } } }
$gpuPid = ($typed | Where-Object Type -eq 'gpu-process').Id
$before = @{}; foreach ($p in $typed) { $before[$p.Id] = (Get-Process -Id $p.Id).TotalProcessorTime.TotalMilliseconds }
$samples = Get-Counter -Counter "\GPU Engine(pid_$($gpuPid)_*)\Utilization Percentage" -SampleInterval 1 -MaxSamples $Seconds -ErrorAction SilentlyContinue
$gpuUtil = ($samples | ForEach-Object { ($_.CounterSamples | Measure-Object CookedValue -Sum).Sum } | Measure-Object -Average).Average
$out = [ordered]@{ gpuUtilPct = [math]::Round($gpuUtil, 2) }
foreach ($p in $typed) { $d = (Get-Process -Id $p.Id).TotalProcessorTime.TotalMilliseconds - $before[$p.Id]; $key = if ($p.Type -eq 'gpu-process') { 'gpuProcessMsPerSec' } else { "renderer$($p.Id)MsPerSec" }; $out[$key] = [math]::Round($d / $Seconds, 1) }
$out | ConvertTo-Json -Compress
