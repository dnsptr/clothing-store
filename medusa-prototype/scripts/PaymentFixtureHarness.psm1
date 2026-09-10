function Update-TrackedProcessTree {
    param([hashtable]$Context)

    $Processes = @(& $Context.ProcessQuery)
    $Frontier = @($Context.TrackedProcessIds)
    while ($Frontier.Count -gt 0) {
        $NextFrontier = [System.Collections.Generic.List[int]]::new()
        foreach ($RootId in $Frontier) {
            $Context.TrackedProcessIds.Add([int]$RootId) | Out-Null
            foreach ($Child in $Processes | Where-Object { $_.ParentProcessId -eq $RootId }) {
                if ($Context.TrackedProcessIds.Add([int]$Child.ProcessId)) {
                    $NextFrontier.Add([int]$Child.ProcessId)
                }
            }
        }
        $Frontier = @($NextFrontier)
    }
}

function Stop-TrackedProcesses {
    param([hashtable]$Context)

    try {
        Update-TrackedProcessTree -Context $Context
    }
    catch {
        $Context.CleanupErrors.Add("Process discovery failed: $($_.Exception.Message)")
    }

    $ProcessIds = @($Context.TrackedProcessIds)
    [array]::Reverse($ProcessIds)
    foreach ($ProcessId in $ProcessIds) {
        try {
            Stop-Process -Id $ProcessId -Force -ErrorAction Stop
            $StoppedProcess = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
            if ($null -ne $StoppedProcess -and -not $StoppedProcess.WaitForExit(5000)) {
                $Context.CleanupErrors.Add("Tracked process $ProcessId did not exit within five seconds.")
            }
        }
        catch {
            if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
                $Context.CleanupErrors.Add("Failed to stop tracked process $ProcessId`: $($_.Exception.Message)")
            }
        }
    }
    Add-Content -LiteralPath $Context.CleanupLog -Value "Tracked process stop attempted for: $($ProcessIds -join ',')"
}

function ConvertTo-CommandLine {
    param([string[]]$Arguments)

    return (@($Arguments | ForEach-Object {
        if ($_ -match '[\s"]') { '"' + $_.Replace('"', '\"') + '"' } else { $_ }
    }) -join " ")
}

function Invoke-BoundedProcess {
    param([hashtable]$Options)

    $ResolvedFilePath = (Get-Command $Options.FilePath -ErrorAction Stop).Source
    $StartInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $StartInfo.FileName = $ResolvedFilePath
    $StartInfo.Arguments = ConvertTo-CommandLine -Arguments $Options.Arguments
    $StartInfo.WorkingDirectory = $Options.WorkingDirectory
    $StartInfo.UseShellExecute = $false
    $StartInfo.CreateNoWindow = $true
    $StartInfo.RedirectStandardOutput = $true
    $StartInfo.RedirectStandardError = $true
    $Process = [System.Diagnostics.Process]::new()
    $Process.StartInfo = $StartInfo
    if (-not $Process.Start()) {
        throw "$($Options.Name) could not be started."
    }

    $OutputTask = $Process.StandardOutput.ReadToEndAsync()
    $ErrorTask = $Process.StandardError.ReadToEndAsync()
    $Options.Context.TrackedProcessIds.Add($Process.Id) | Out-Null
    $Deadline = [DateTime]::UtcNow.AddSeconds($Options.TimeoutSeconds)
    $TimedOut = $false
    while (-not $Process.HasExited) {
        try {
            Update-TrackedProcessTree -Context $Options.Context
        }
        catch {
            $Options.Context.CleanupErrors.Add("Process discovery failed during $($Options.Name): $($_.Exception.Message)")
        }
        if ([DateTime]::UtcNow -ge $Deadline) {
            $TimedOut = $true
            Stop-TrackedProcesses -Context $Options.Context
            break
        }
        Start-Sleep -Milliseconds 250
        $Process.Refresh()
    }
    if (-not $Process.HasExited) {
        $Process.WaitForExit(10000) | Out-Null
    }
    if ($Process.HasExited) {
        $Process.WaitForExit()
    }
    $OutputTask.Wait(10000) | Out-Null
    $ErrorTask.Wait(10000) | Out-Null
    Set-Content -LiteralPath $Options.StandardOutput -Value $(if ($OutputTask.IsCompleted) { $OutputTask.Result } else { "Output capture did not complete." })
    Set-Content -LiteralPath $Options.StandardError -Value $(if ($ErrorTask.IsCompleted) { $ErrorTask.Result } else { "Error capture did not complete." })
    if ($TimedOut) {
        Set-Content -LiteralPath $Options.ExitCodeFile -Value "TIMEOUT"
        throw "$($Options.Name) timed out after $($Options.TimeoutSeconds) seconds."
    }
    $ExitCode = [int]($Process.ExitCode)
    Set-Content -LiteralPath $Options.ExitCodeFile -Value $ExitCode
    return $ExitCode
}

function Invoke-HarnessCommand {
    param([hashtable]$Context, [hashtable]$Command)

    $Prefix = Join-Path $Context.EvidenceDirectory $Command.LogPrefix
    return Invoke-BoundedProcess -Options @{
        Name = $Command.Name
        FilePath = $Command.FilePath
        Arguments = $Command.Arguments
        WorkingDirectory = $Context.RepositoryRoot
        TimeoutSeconds = $Command.TimeoutSeconds
        StandardOutput = "$Prefix.stdout.log"
        StandardError = "$Prefix.stderr.log"
        ExitCodeFile = "$Prefix.exit-code.txt"
        Context = $Context
    }
}

function Write-ProcessInspection {
    param([hashtable]$Context)

    try {
        $Processes = @(& $Context.ProcessQuery)
        $WorktreePattern = [regex]::Escape($Context.RepositoryRoot)
        $Survivors = @($Processes | Where-Object {
            $Context.TrackedProcessIds.Contains([int]$_.ProcessId) -or
            ($_.CommandLine -match $WorktreePattern -and (
                $_.CommandLine -match 'e2e[\\/]fixtures[\\/]payment-baseline\.ts' -or
                $_.CommandLine -match 'next[\\/]dist[\\/]bin[\\/]next.+--port 4173'
            ))
        } | Select-Object ProcessId, ParentProcessId, ExecutablePath, CommandLine)
        ConvertTo-Json -InputObject $Survivors -Depth 3 | Set-Content -LiteralPath $Context.ProcessInspectionFile
        if ($Survivors.Count -gt 0) {
            $Context.CleanupErrors.Add("Process survivors detected: $($Survivors.ProcessId -join ',').")
        }
    }
    catch {
        $Context.CleanupErrors.Add("Post-cleanup process inspection failed: $($_.Exception.Message)")
        [ordered]@{ inspection_error = $_.Exception.Message } | ConvertTo-Json | Set-Content -LiteralPath $Context.ProcessInspectionFile
    }
}

Export-ModuleMember -Function Invoke-HarnessCommand, Stop-TrackedProcesses, Write-ProcessInspection
