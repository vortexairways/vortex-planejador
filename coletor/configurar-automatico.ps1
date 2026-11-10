param([switch] $Desativar)
$ErrorActionPreference = 'Stop'
$taskName = 'Vortex - Sincronizar automaticamente'
$taskRepo = Split-Path -Parent $PSScriptRoot
$taskScript = Join-Path $PSScriptRoot 'automatico.ps1'
$taskPowerShell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$taskSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskService = New-Object -ComObject 'Schedule.Service'
$taskService.Connect()
$taskFolder = $taskService.GetFolder('\')
$taskExisting = $null
try { $taskExisting = $taskFolder.GetTask($taskName) } catch { }
if ($taskExisting -and -not $taskExisting.Xml.Contains([Security.SecurityElement]::Escape($taskScript))) {
    throw 'Ja existe uma tarefa Vortex apontando para outro projeto. Ela foi preservada.'
}
if ($Desativar) {
    if ($taskExisting) { $taskExisting.Enabled = $false }
    Write-Output 'Coleta automatica desativada. O atalho manual continua disponivel.'
    exit 0
}
$taskStart = (Get-Date).AddMinutes(10).ToString('yyyy-MM-ddTHH:mm:ss')
$taskArguments = '-NoProfile -WindowStyle Hidden -File "' + $taskScript + '"'
$taskEsc = { param($value) [Security.SecurityElement]::Escape($value) }
$taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Sincroniza a Vortex a cada 10 minutos quando o usuario e o Chrome estao disponiveis. Mantem a sincronizacao manual.</Description></RegistrationInfo>
  <Triggers>
    <TimeTrigger><Repetition><Interval>PT10M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>$taskStart</StartBoundary><Enabled>true</Enabled></TimeTrigger>
    <LogonTrigger><Enabled>true</Enabled><UserId>$taskSid</UserId><Delay>PT1M</Delay></LogonTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>$taskSid</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><Enabled>true</Enabled><Hidden>false</Hidden><WakeToRun>false</WakeToRun><ExecutionTimeLimit>PT8M</ExecutionTimeLimit></Settings>
  <Actions Context="Author"><Exec><Command>$(& $taskEsc $taskPowerShell)</Command><Arguments>$(& $taskEsc $taskArguments)</Arguments><WorkingDirectory>$(& $taskEsc $taskRepo)</WorkingDirectory></Exec></Actions>
</Task>
"@
$taskRegistered = $taskFolder.RegisterTask($taskName, $taskXml, 6, $taskSid, $null, 3)
Write-Output ('Ativada: ' + $taskRegistered.Name)
Write-Output 'Intervalo: 10 minutos; retoma ao entrar no Windows; nao desperta o computador.'
Write-Output 'O atalho Sincronizar Vortex continua disponivel como reserva.'
