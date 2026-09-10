[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$Name,
    [Parameter(Mandatory)]
    [string]$FilePath,
    [string[]]$Arguments = @(),
    [Parameter(Mandatory)]
    [string]$WorkingDirectory,
    [Parameter(Mandatory)]
    [string]$EvidenceDirectory,
    [ValidateRange(1, 1800)]
    [int]$TimeoutSeconds = 600
)

$ErrorActionPreference = "Stop"
[System.IO.Directory]::CreateDirectory($EvidenceDirectory) | Out-Null
Import-Module (Join-Path $PSScriptRoot "PaymentFixtureHarness.psm1") -Force
$Context = @{
    RepositoryRoot = (Resolve-Path $WorkingDirectory).Path
    EvidenceDirectory = (Resolve-Path $EvidenceDirectory).Path
    CleanupLog = Join-Path $EvidenceDirectory "cleanup.log"
    ProcessInspectionFile = Join-Path $EvidenceDirectory "post-command-processes.json"
    TrackedProcessIds = [System.Collections.Generic.HashSet[int]]::new()
    CleanupErrors = [System.Collections.Generic.List[string]]::new()
    ProcessQuery = { @(Get-CimInstance Win32_Process -ErrorAction Stop) }
}
Set-Content -LiteralPath (Join-Path $EvidenceDirectory "command.txt") -Value "$FilePath $($Arguments -join ' ')"
Set-Content -LiteralPath $Context.CleanupLog -Value "Command process cleanup"
try {
    $ExitCode = Invoke-HarnessCommand -Context $Context -Command @{
        Name = $Name
        FilePath = $FilePath
        Arguments = $Arguments
        TimeoutSeconds = $TimeoutSeconds
        LogPrefix = "command"
    }
}
finally {
    Stop-TrackedProcesses -Context $Context
    Write-ProcessInspection -Context $Context
}
if ($Context.CleanupErrors.Count -gt 0) {
    throw "Evidence command cleanup failed: $($Context.CleanupErrors -join ' ')"
}
exit $ExitCode
