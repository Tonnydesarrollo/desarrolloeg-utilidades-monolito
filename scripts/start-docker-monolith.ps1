param(
  [int]$MaxAttempts = 90,
  [int]$SleepSeconds = 10
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$dockerExe = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
$dockerDesktopExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
$dockerServiceName = "com.docker.service"
$pm2Exe = Join-Path $env:APPDATA "npm\pm2.cmd"
$dockerConfigDir = Join-Path $repoRoot ".docker-runtime-config"
$dockerConfigPath = Join-Path $dockerConfigDir "config.json"
$dockerSourceContexts = Join-Path $env:USERPROFILE ".docker\contexts"
$dockerTargetContexts = Join-Path $dockerConfigDir "contexts"
$logDir = Join-Path $repoRoot "runtime\logs"
$logPath = Join-Path $logDir "docker-startup.log"

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

function Test-Pm2ProcessExists {
  param([string]$Name)

  if (-not (Test-Path $pm2Exe)) {
    return $false
  }

  $pm2ListJson = & $pm2Exe jlist 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $pm2ListJson) {
    return $false
  }

  try {
    $pm2List = $pm2ListJson | ConvertFrom-Json
  } catch {
    return $false
  }

  return (@($pm2List | Where-Object { $_.name -eq $Name }).Count -gt 0)
}

function Invoke-Pm2 {
  param([string[]]$Arguments)

  if (-not (Test-Path $pm2Exe)) {
    throw "pm2.cmd no encontrado en $pm2Exe"
  }

  & $pm2Exe @Arguments
  return $LASTEXITCODE
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
    Start-Process -FilePath $dockerDesktopExe
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
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git no esta disponible en PATH"
  }

  Write-Log "Actualizando repo con git pull --ff-only origin main"
  & git -C $repoRoot pull --ff-only origin main >> $logPath 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "git pull fallo con codigo $LASTEXITCODE"
  }

  $hadPm2Monolith = $false
  if (Test-Pm2ProcessExists -Name "desarrolloeg-monolito") {
    $hadPm2Monolith = $true
    Write-Log "Deteniendo desarrolloeg-monolito en PM2 para liberar el puerto 7000"
    Invoke-Pm2 -Arguments @("stop", "desarrolloeg-monolito") 2>$null | Out-Null
  }

  Write-Log "Ejecutando docker compose up -d --build"
  $composeCommand = "`"$dockerExe`" --config `"$dockerConfigDir`" compose up -d --build >> `"$logPath`" 2>&1"
  cmd.exe /d /c $composeCommand
  $composeExitCode = $LASTEXITCODE
  if ($composeExitCode -ne 0) {
    Write-Log "docker compose up -d --build termino con codigo $composeExitCode"

    if ($hadPm2Monolith) {
      Write-Log "Restaurando desarrolloeg-monolito en PM2 por fallo en Docker"
      Invoke-Pm2 -Arguments @("restart", "desarrolloeg-monolito") | Out-Null
    }

    exit $composeExitCode
  }

  if ($hadPm2Monolith -and (Test-Pm2ProcessExists -Name "desarrolloeg-monolito")) {
    Write-Log "Eliminando desarrolloeg-monolito de PM2 y guardando dump"
    Invoke-Pm2 -Arguments @("delete", "desarrolloeg-monolito") 2>$null | Out-Null
    Invoke-Pm2 -Arguments @("save", "--force") 2>$null | Out-Null
  }

  Write-Log "docker compose up -d --build completado correctamente"
} catch {
  Write-Log "Error ejecutando docker compose: $($_.Exception.Message)"
  exit 1
}
