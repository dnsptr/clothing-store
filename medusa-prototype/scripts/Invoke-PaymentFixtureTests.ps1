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
    $TaskSubdir = switch ($Mode) {
        "reconciler" { "task-4" }
        "status" { "task-6" }
        default { "task-1" }
    }
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

function Invoke-StatusProbe {
    param(
        [string]$Name,
        [string]$Path,
        [int]$ExpectedStatus,
        [string]$ExpectedPayment,
        [string]$ExpectedOrder
    )

    $LogPrefix = "status-$Name"
    $BodyFile = Join-Path $EvidenceDirectory "$LogPrefix.body.json"
    $HeadersFile = Join-Path $EvidenceDirectory "$LogPrefix.headers.txt"
    $ExitCode = Invoke-CommandForHarness -Command @{
        Name = "Payment status $Name"
        FilePath = "curl.exe"
        Arguments = @("--silent", "--show-error", "--output", $BodyFile, "--dump-header", $HeadersFile, "--write-out", "%{http_code}", "http://127.0.0.1:4174$Path")
        TimeoutSeconds = 30
        LogPrefix = $LogPrefix
    }
    if ($ExitCode -ne 0) {
        throw "Payment status $Name curl failed with code $ExitCode."
    }
    $StatusCode = (Get-Content -LiteralPath (Join-Path $EvidenceDirectory "$LogPrefix.stdout.log") -Raw).Trim()
    if ($StatusCode -ne [string]$ExpectedStatus) {
        throw "Payment status $Name returned HTTP $StatusCode instead of $ExpectedStatus."
    }
    $Headers = Get-Content -LiteralPath $HeadersFile -Raw
    if ($Headers -notmatch '(?im)^Cache-Control:\s*no-store, no-cache, must-revalidate, proxy-revalidate\s*$') {
        throw "Payment status $Name omitted the required Cache-Control policy."
    }
    $RawBody = Get-Content -LiteralPath $BodyFile -Raw
    if ($ExpectedStatus -eq 404) {
        if (-not [string]::IsNullOrWhiteSpace($RawBody)) {
            throw "Payment status $Name returned a body for the non-enumerating 404 contract."
        }
        return
    }
    $Body = $RawBody | ConvertFrom-Json
    $Properties = @($Body.PSObject.Properties.Name | Sort-Object) -join ","
    if ($Properties -ne "order,payment" -or $Body.payment -ne $ExpectedPayment -or $Body.order -ne $ExpectedOrder) {
        throw "Payment status $Name returned an unexpected public projection."
    }
}

try {
    if ($Mode -ne "status") {
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
    }

    if ($Mode -eq "status") {
        $FixturePath = Join-Path $RepositoryRoot "e2e\fixtures\payment-status.ts"
        $FixtureStdout = Join-Path $EvidenceDirectory "status-fixture.stdout.log"
        $FixtureStderr = Join-Path $EvidenceDirectory "status-fixture.stderr.log"
        $FixtureProcess = Start-Process -FilePath (Get-Command node -ErrorAction Stop).Source `
            -ArgumentList @("--import", "tsx", $FixturePath) `
            -WorkingDirectory (Join-Path $RepositoryRoot "medusa-prototype") `
            -RedirectStandardOutput $FixtureStdout -RedirectStandardError $FixtureStderr `
            -PassThru -NoNewWindow
        $Context.TrackedProcessIds.Add($FixtureProcess.Id) | Out-Null

        $Ready = $false
        for ($Attempt = 0; $Attempt -lt 40; $Attempt++) {
            if ($FixtureProcess.HasExited) {
                throw "Payment status fixture exited before readiness with code $($FixtureProcess.ExitCode)."
            }
            $HealthCode = Invoke-CommandForHarness -Command @{
                Name = "Payment status fixture readiness"
                FilePath = "curl.exe"
                Arguments = @("--silent", "--show-error", "--output", (Join-Path $EvidenceDirectory "status-health.body.json"), "--write-out", "%{http_code}", "http://127.0.0.1:4174/health")
                TimeoutSeconds = 5
                LogPrefix = "status-health"
            }
            if ($HealthCode -eq 0 -and (Get-Content -LiteralPath (Join-Path $EvidenceDirectory "status-health.stdout.log") -Raw).Trim() -eq "200") {
                $Ready = $true
                break
            }
            Start-Sleep -Milliseconds 250
        }
        if (-not $Ready) {
            throw "Payment status fixture did not become ready."
        }

        Invoke-StatusProbe -Name "pending" -Path "/store/payment-status/cart_01J00000000000000000000000" -ExpectedStatus 200 -ExpectedPayment "pending" -ExpectedOrder "pending"
        Invoke-StatusProbe -Name "confirmed" -Path "/store/payment-status/cart_01J00000000000000000000001" -ExpectedStatus 200 -ExpectedPayment "confirmed" -ExpectedOrder "pending"
        Invoke-StatusProbe -Name "ready" -Path "/store/payment-status/cart_01J00000000000000000000002" -ExpectedStatus 200 -ExpectedPayment "confirmed" -ExpectedOrder "ready"
        Invoke-StatusProbe -Name "failed" -Path "/store/payment-status/cart_01J00000000000000000000003" -ExpectedStatus 200 -ExpectedPayment "failed" -ExpectedOrder "pending"
        Invoke-StatusProbe -Name "malformed" -Path "/store/payment-status/payses_01J00000000000000000000000" -ExpectedStatus 404
        Invoke-StatusProbe -Name "unknown" -Path "/store/payment-status/cart_01J00000000000000000000009" -ExpectedStatus 404
        Invoke-StatusProbe -Name "foreign" -Path "/store/payment-status/cart_01J00000000000000000000004" -ExpectedStatus 404

        $ObservationExitCode = Invoke-CommandForHarness -Command @{
            Name = "Payment status bank-call observation"
            FilePath = "curl.exe"
            Arguments = @("--silent", "--show-error", "--fail", "http://127.0.0.1:4174/__control/observations")
            TimeoutSeconds = 30
            LogPrefix = "status-observations"
        }
        $Observations = Get-Content -LiteralPath (Join-Path $EvidenceDirectory "status-observations.stdout.log") -Raw | ConvertFrom-Json
        if ($ObservationExitCode -ne 0 -or $Observations.bank_calls -ne 0) {
            throw "Payment status fixture observed an external bank dependency call."
        }
    }
    elseif ($Mode -eq "reconciler") {
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

    if ($ComposeAttempted) {
        try {
            Inspect-DockerResource -Kind "containers" -Arguments @("ps", "-a", "--filter", "label=com.docker.compose.project=$ProjectName", "--format", "{{.ID}}")
            Inspect-DockerResource -Kind "volumes" -Arguments @("volume", "ls", "--filter", "label=com.docker.compose.project=$ProjectName", "--format", "{{.Name}}")
            Inspect-DockerResource -Kind "networks" -Arguments @("network", "ls", "--filter", "label=com.docker.compose.project=$ProjectName", "--format", "{{.ID}}")
        }
        catch {
            $Context.CleanupErrors.Add("Docker resource inspection failed: $($_.Exception.Message)")
        }
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
