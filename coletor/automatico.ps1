$ErrorActionPreference = 'Stop'
$taskRepo = Split-Path -Parent $PSScriptRoot
$taskLogDir = Join-Path $env:LOCALAPPDATA 'Vortex'
$taskLog = Join-Path $taskLogDir 'sincronizacao.log'
New-Item -ItemType Directory -Path $taskLogDir -Force | Out-Null
if ((Test-Path -LiteralPath $taskLog) -and (Get-Item -LiteralPath $taskLog).Length -gt 2MB) {
    Move-Item -LiteralPath $taskLog -Destination (Join-Path $taskLogDir 'sincronizacao-anterior.log') -Force
}
function Write-VortexLog([string] $Message) {
    Add-Content -LiteralPath $taskLog -Encoding UTF8 -Value (('[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ') + $Message)
}
if (-not (Get-Process -Name chrome -ErrorAction SilentlyContinue)) {
    Write-VortexLog 'Chrome fechado. A coleta sera tentada no proximo horario.'
    exit 0
}
try {
    $taskNode = (Get-Command node.exe -ErrorAction Stop).Source
    Write-VortexLog 'Iniciando sincronizacao automatica.'
    # PowerShell 5.1 pode tratar mensagens normais do stderr do Git como ErrorRecord.
    $ErrorActionPreference = 'Continue'
    $taskOutput = & $taskNode (Join-Path $PSScriptRoot 'coletor-local.mjs') --automatic 2>&1 | Out-String
    $taskCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    Add-Content -LiteralPath $taskLog -Encoding UTF8 -Value $taskOutput.Trim()
    if ($taskCode -eq 75) { Write-VortexLog 'Outra coleta ja esta em andamento; ciclo ignorado.'; exit 0 }
    if ($taskCode -ne 0) { Write-VortexLog ('Falha na coleta. Nova tentativa em ate 10 minutos. Codigo: ' + $taskCode) }
    exit $taskCode
} catch {
    Write-VortexLog ('Falha ao iniciar a coleta: ' + $_.Exception.Message)
    exit 1
}
