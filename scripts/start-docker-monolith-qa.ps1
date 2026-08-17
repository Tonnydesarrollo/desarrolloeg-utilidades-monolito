param(
  [int]$MaxAttempts = 90,
  [int]$SleepSeconds = 10
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$dockerExe = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
$dockerDesktopExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
$dockerServiceName = "com.docker.service"
$dockerConfigDir = Join-Path $repoRoot ".docker-runtime-config"
$dockerConfigPath = Join-Path $dockerConfigDir "config.json"
$dockerSourceContexts = Join-Path $env:USERPROFILE ".docker\contexts"
$dockerTargetContexts = Join-Path $dockerConfigDir "contexts"
$logDir = Join-Path $repoRoot "runtime\logs"
$logPath = Join-Path $logDir "docker-startup-qa.log"

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

$env:PATH = "$PSScriptRoot;$env:PATH"
$env:DOCKER_CONTEXT = "desktop-linux"

function Write-Log {
  param([string]$Message)

  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -LiteralPath $logPath -Value "[$timestamp] $Message"
}

if (-not (Test-Path $dockerExe)) {
  Write-Log "docker.exe no encontrado en $dockerExe"
  exit 1
}

try {
  $dockerService = Get-Service -Name $dockerServiceName -ErrorAction SilentlyContinue
  if ($dockerService -and $dockerService.Status -ne "Running") {
    Write-Log "Iniciando servicio $dockerServiceName"
    Start-Service -Name $dockerServiceName
  }
} catch {
  Write-Log "No fue posible iniciar servicio ${dockerServiceName}: $($_.Exception.Message)"
}

try {
  if ((Test-Path $dockerDesktopExe) -and -not (Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue)) {
    Write-Log "Iniciando Docker Desktop"
    Start-Process -FilePath $dockerDesktopExe -WindowStyle Hidden
    Start-Sleep -Seconds 5
  }
} catch {
  Write-Log "No fue posible iniciar Docker Desktop: $($_.Exception.Message)"
}

Set-Location $repoRoot
Write-Log "Iniciando espera para Docker Desktop"

$dockerReady = $false
for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
  try {
    & $dockerExe --config $dockerConfigDir version | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $dockerReady = $true
      Write-Log "Docker listo en intento $attempt"
      break
    }
  } catch {
    Write-Log "Docker no listo en intento ${attempt}: $($_.Exception.Message)"
  }

  Start-Sleep -Seconds $SleepSeconds
}

if (-not $dockerReady) {
  Write-Log "Docker no quedo listo tras $MaxAttempts intentos"
  exit 1
}

try {
  Write-Log "Levantando QA con docker compose --profile qa up -d --build"
  $composeCommand = "`"$dockerExe`" --config `"$dockerConfigDir`" compose --profile qa up -d --build >> `"$logPath`" 2>&1"
  cmd.exe /d /c $composeCommand
  $composeExitCode = $LASTEXITCODE
  if ($composeExitCode -ne 0) {
    Write-Log "docker compose QA termino con codigo $composeExitCode"
    exit $composeExitCode
  }

  Write-Log "QA levantado correctamente"
} catch {
  Write-Log "Error levantando QA: $($_.Exception.Message)"
  exit 1
}
