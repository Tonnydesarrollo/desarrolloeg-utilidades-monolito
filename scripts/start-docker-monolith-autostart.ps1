param(
  [int]$MaxAttempts = 90,
  [int]$SleepSeconds = 10,
  [int]$CheckIntervalSeconds = 30
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$dockerExe = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
$dockerServiceName = "com.docker.service"
$dockerConfigDir = Join-Path $repoRoot ".docker-runtime-config"
$dockerConfigPath = Join-Path $dockerConfigDir "config.json"
$dockerSourceContexts = Join-Path $env:USERPROFILE ".docker\contexts"
$dockerTargetContexts = Join-Path $dockerConfigDir "contexts"
$logDir = Join-Path $repoRoot "runtime\logs"
$logPath = Join-Path $logDir "docker-autostart.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
New-Item -ItemType Directory -Force -Path $dockerConfigDir | Out-Null
if (Test-Path $dockerSourceContexts) {
  Copy-Item -LiteralPath $dockerSourceContexts -Destination $dockerTargetContexts -Recurse -Force
}

@'
{
  "auths": {},
  "credsStore": "empty"
}
'@ | Set-Content -LiteralPath $dockerConfigPath -Encoding ASCII

function Write-Log {
  param([string]$Message)

  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -LiteralPath $logPath -Value "[$timestamp] $Message"
}

function Invoke-DockerComposeUp {
  $command = "`"$dockerExe`" --config `"$dockerConfigDir`" compose up -d >> `"$logPath`" 2>&1"
  cmd.exe /d /c $command
  return $LASTEXITCODE
}

function Test-DockerReady {
  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    try {
      & $dockerExe --config $dockerConfigDir version | Out-Null
      if ($LASTEXITCODE -eq 0) {
        Write-Log "Docker listo en intento $attempt"
        return $true
      }
    } catch {
      Write-Log "Docker no listo en intento ${attempt}: $($_.Exception.Message)"
    }

    Start-Sleep -Seconds $SleepSeconds
  }

  return $false
}

if (-not (Test-Path $dockerExe)) {
  Write-Log "docker.exe no encontrado en $dockerExe"
  exit 1
}

Set-Location $repoRoot

Write-Log "Iniciando vigilante del monolito"

while ($true) {
try {
  $dockerService = Get-Service -Name $dockerServiceName -ErrorAction SilentlyContinue
  if ($dockerService -and $dockerService.Status -ne "Running") {
    Write-Log "Iniciando servicio $dockerServiceName"
    Set-Service -Name $dockerServiceName -StartupType Automatic
    Start-Service -Name $dockerServiceName
  }
} catch {
  Write-Log "No fue posible iniciar servicio ${dockerServiceName}: $($_.Exception.Message)"
}

  Write-Log "Esperando a que Docker responda"
  $dockerReady = Test-DockerReady
  if (-not $dockerReady) {
    Write-Log "Docker no quedo listo tras $MaxAttempts intentos; reintentando en $CheckIntervalSeconds segundos"
    Start-Sleep -Seconds $CheckIntervalSeconds
    continue
  }

  Write-Log "Asegurando monolito con docker compose up -d"
  $composeExitCode = Invoke-DockerComposeUp
  if ($composeExitCode -ne 0) {
    Write-Log "docker compose up -d termino con codigo $composeExitCode"
  } else {
    Write-Log "Monolito verificado correctamente"
  }

  Start-Sleep -Seconds $CheckIntervalSeconds
}
