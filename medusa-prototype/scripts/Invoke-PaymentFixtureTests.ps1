[CmdletBinding()]
param(
    [ValidateSet("smoke", "baseline", "reconciler", "status", "security-review")]
    [string]$Mode = "baseline",
    [string]$TestPath,
    [ValidateRange(1, 1800)]
    [int]$ComposeTimeoutSeconds = 180,
    [ValidateRange(1, 1800)]
    [int]$PlaywrightTimeoutSeconds = 600,
    [string]$EvidenceDirectory
)

$ErrorActionPreference = "Stop"
$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ComposeFile = Join-Path $RepositoryRoot "medusa-prototype\payment-fixtures.compose.yml"
$ProjectName = "mario-mikke-payment-fixture-$PID"
$RunError = $null
$ComposeAttempted = $false
$StartedAt = [DateTime]::UtcNow
if ([string]::IsNullOrWhiteSpace($EvidenceDirectory)) {
    $TaskSubdir = if ($Mode -eq "reconciler") { "task-4" } else { "task-1" }
    $EvidenceDirectory = Join-Path $RepositoryRoot ".omo\evidence\payment-lifecycle-hardening\$TaskSubdir\harness-$PID"
}
[System.IO.Directory]::CreateDirectory($EvidenceDirectory) | Out-Null

Import-Module (Join-Path $PSScriptRoot "PaymentFixtureHarness.psm1") -Force
$Context = @{
    RepositoryRoot = $RepositoryRoot
    EvidenceDirectory = $EvidenceDirectory
    CleanupLog = Join-Path $EvidenceDirectory "cleanup.log"
    ProcessInspectionFile = Join-Path $EvidenceDirectory "post-cleanup-processes.json"
    TrackedProcessIds = [System.Collections.Generic.HashSet[int]]::new()
    CleanupErrors = [System.Collections.Generic.List[string]]::new()
    ProcessQuery = { @(Get-CimInstance Win32_Process -ErrorAction Stop) }
}
Set-Content -LiteralPath $Context.CleanupLog -Value "Cleanup log for $ProjectName"

function Invoke-CommandForHarness {
    param([hashtable]$Command)

    return Invoke-HarnessCommand -Context $Context -Command $Command
}

function Inspect-DockerResource {
    param([string]$Kind, [string[]]$Arguments)

    $LogPrefix = "inspect-$Kind"
    $ExitCode = Invoke-CommandForHarness -Command @{
        Name = "$Kind inspection"
        FilePath = "docker"
        Arguments = $Arguments
        TimeoutSeconds = 30
        LogPrefix = $LogPrefix
    }
    $Output = (Get-Content -LiteralPath (Join-Path $EvidenceDirectory "$LogPrefix.stdout.log") -Raw).Trim()
    if ($ExitCode -ne 0) {
        $Context.CleanupErrors.Add("$Kind inspection exited with code $ExitCode.")
    }
    elseif ($Output.Length -gt 0) {
        $Context.CleanupErrors.Add("$Kind survivors detected: $Output")
    }
}

try {
    $ComposeAttempted = $true
    $ComposeExitCode = Invoke-CommandForHarness -Command @{
        Name = "Compose up"
        FilePath = "docker"
        Arguments = @("compose", "-p", $ProjectName, "-f", $ComposeFile, "up", "-d", "--wait")
        TimeoutSeconds = $ComposeTimeoutSeconds
        LogPrefix = "compose-up"
    }
    if ($ComposeExitCode -ne 0) {
        throw "Payment fixture Compose services failed to start with code $ComposeExitCode."
    }

    if ($Mode -eq "reconciler") {
        $WorktreeRoot = (Resolve-Path "$PSScriptRoot\..\..").Path
        $WslWorktree = if (Get-Command wsl.exe -ErrorAction SilentlyContinue) {
            try { (wsl.exe wslpath -a $WorktreeRoot 2>$null).Trim() } catch { $null }
        } else { $null }

        $TargetTest = if ($TestPath) { $TestPath } else { "src/modules/tbank/__tests__/payment-reconciler.integration.spec.ts" }
        $SeedScript = Join-Path $WorktreeRoot "medusa-prototype\apps\backend\src\scripts\seed-payment-test-fixtures.mjs"
        if (Test-Path $SeedScript) {
            Invoke-CommandForHarness -Command @{
                Name = "Seed payment test fixtures"
                FilePath = (Get-Command node -ErrorAction Stop).Source
                Arguments = @($SeedScript)
                TimeoutSeconds = 60
                LogPrefix = "seed-fixtures"
            }
        }

        if ($WslWorktree) {
            $TestExitCode = Invoke-CommandForHarness -Command @{
                Name = "Reconciler integration tests (WSL)"
                FilePath = "wsl.exe"
                Arguments = @("bash", "-lc", "cd '$WslWorktree/medusa-prototype/apps/backend' && TEST_TYPE=integration:modules npm run test:integration:modules -- --testPathPattern=$TargetTest")
                TimeoutSeconds = $PlaywrightTimeoutSeconds
                LogPrefix = "reconciler-tests"
            }
        } else {
            $TestExitCode = Invoke-CommandForHarness -Command @{
                Name = "Reconciler integration tests"
                FilePath = (Get-Command npx.cmd -ErrorAction Stop).Source
                Arguments = @("jest", "--runInBand", $TargetTest)
                TimeoutSeconds = $PlaywrightTimeoutSeconds
                LogPrefix = "reconciler-tests"
            }
        }
        if ($TestExitCode -ne 0) {
            throw "Payment reconciler integration tests failed with code $TestExitCode."
        }
    }
    else {
        $PlaywrightArguments = @("node_modules/@playwright/test/cli.js", "test", "e2e/payment-baseline.spec.ts")
        if ($Mode -eq "smoke") {
            $PlaywrightArguments += "--list"
        }
        $PlaywrightExitCode = Invoke-CommandForHarness -Command @{
            Name = "Playwright"
            FilePath = (Get-Command node -ErrorAction Stop).Source
            Arguments = $PlaywrightArguments
            TimeoutSeconds = $PlaywrightTimeoutSeconds
            LogPrefix = "playwright"
        }
        if ($PlaywrightExitCode -ne 0) {
            throw "Payment baseline Playwright characterization failed with code $PlaywrightExitCode."
        }
    }
}
catch {
    $RunError = $_
}
finally {
    Stop-TrackedProcesses -Context $Context
    if ($ComposeAttempted) {
        try {
            $ComposeDownCode = Invoke-CommandForHarness -Command @{
                Name = "Compose down"
                FilePath = "docker"
                Arguments = @("compose", "-p", $ProjectName, "-f", $ComposeFile, "down", "-v", "--remove-orphans")
                TimeoutSeconds = $ComposeTimeoutSeconds
                LogPrefix = "compose-down"
            }
            if ($ComposeDownCode -ne 0) {
                $Context.CleanupErrors.Add("Compose down exited with code $ComposeDownCode.")
            }
        }
        catch {
            $Context.CleanupErrors.Add("Compose down failed: $($_.Exception.Message)")
        }
    }
    Stop-TrackedProcesses -Context $Context

    try {
        Inspect-DockerResource -Kind "containers" -Arguments @("ps", "-a", "--filter", "label=com.docker.compose.project=$ProjectName", "--format", "{{.ID}}")
        Inspect-DockerResource -Kind "volumes" -Arguments @("volume", "ls", "--filter", "label=com.docker.compose.project=$ProjectName", "--format", "{{.Name}}")
        Inspect-DockerResource -Kind "networks" -Arguments @("network", "ls", "--filter", "label=com.docker.compose.project=$ProjectName", "--format", "{{.ID}}")
    }
    catch {
        $Context.CleanupErrors.Add("Docker resource inspection failed: $($_.Exception.Message)")
    }

    $Listeners = @(Get-NetTCPConnection -State Listen -LocalPort 4173,4174 -ErrorAction SilentlyContinue |
        Select-Object LocalAddress, LocalPort, OwningProcess, State)
    ConvertTo-Json -InputObject $Listeners -Depth 3 | Set-Content -LiteralPath (Join-Path $EvidenceDirectory "post-cleanup-listeners.json")
    if ($Listeners.Count -gt 0) {
        $Context.CleanupErrors.Add("Listener survivors detected on ports 4173/4174.")
    }
    Write-ProcessInspection -Context $Context

    foreach ($CleanupError in $Context.CleanupErrors) {
        Add-Content -LiteralPath $Context.CleanupLog -Value $CleanupError
    }
    $Status = if ($null -eq $RunError -and $Context.CleanupErrors.Count -eq 0) { "passed" } else { "failed" }
    [ordered]@{
        mode = $Mode
        project = $ProjectName
        status = $Status
        started_at_utc = $StartedAt.ToString("o")
        finished_at_utc = [DateTime]::UtcNow.ToString("o")
        run_error = if ($null -eq $RunError) { $null } else { $RunError.Exception.Message }
        cleanup_errors = @($Context.CleanupErrors)
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $EvidenceDirectory "run-summary.json")
}

if ($null -ne $RunError) {
    throw $RunError
}
if ($Context.CleanupErrors.Count -gt 0) {
    throw "Payment fixture cleanup failed: $($Context.CleanupErrors -join ' ')"
}
Write-Output "Payment fixture $Mode passed after zero-survivor assertions. Evidence: $EvidenceDirectory"
