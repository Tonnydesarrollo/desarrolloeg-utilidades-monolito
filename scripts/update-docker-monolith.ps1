param(
  [string]$Branch = "main",
  [string]$Remote = "origin",
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
$logPath = Join-Path $logDir "docker-update.log"
$pm2Exe = Join-Path $env:APPDATA "npm\pm2.cmd"

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

function Write-Log {
  param([string]$Message)

  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -LiteralPath $logPath -Value "[$timestamp] $Message"
}

function Test-RepoDirty {
  $status = & git -C $repoRoot status --porcelain --untracked-files=no 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "No fue posible leer el estado del repo"
  }

  return [bool]$status
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
    return 1
  }

  & $pm2Exe @Arguments
  return $LASTEXITCODE
}

function Ensure-DockerReady {
  if (-not (Test-Path $dockerExe)) {
    throw "docker.exe no encontrado en $dockerExe"
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

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    try {
      & $dockerExe --config $dockerConfigDir version | Out-Null
      if ($LASTEXITCODE -eq 0) {
        Write-Log "Docker listo en intento $attempt"
        return
      }
    } catch {
      Write-Log "Docker no listo en intento ${attempt}: $($_.Exception.Message)"
    }

    Start-Sleep -Seconds $SleepSeconds
  }

  throw "Docker no quedo listo tras $MaxAttempts intentos"
}

Set-Location $repoRoot
Write-Log "Iniciando revision de actualizaciones"

try {
  Ensure-DockerReady

  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git no esta disponible en PATH"
  }

  if (Test-RepoDirty) {
    Write-Log "El repo tiene cambios locales; se omite la actualizacion para no sobrescribirlos"
    exit 0
  }

  Write-Log "Consultando cambios remotos con git fetch $Remote --prune"
  & git -C $repoRoot fetch $Remote --prune >> $logPath 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "git fetch fallo con codigo $LASTEXITCODE"
  }

  $localHead = (& git -C $repoRoot rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $localHead) {
    throw "No fue posible leer HEAD local"
  }

  $remoteHead = (& git -C $repoRoot rev-parse "$Remote/$Branch").Trim()
  if ($LASTEXITCODE -ne 0 -or -not $remoteHead) {
    throw "No fue posible leer $Remote/$Branch"
  }

  if ($localHead -eq $remoteHead) {
    Write-Log "Sin cambios en $Remote/$Branch"
    exit 0
  }

  Write-Log "Cambio detectado: $localHead -> $remoteHead"
  $hadPm2Monolith = $false
  if (Test-Pm2ProcessExists -Name "desarrolloeg-monolito") {
    $hadPm2Monolith = $true
    Write-Log "Deteniendo desarrolloeg-monolito en PM2 para liberar el puerto 7000"
    Invoke-Pm2 -Arguments @("stop", "desarrolloeg-monolito") | Out-Null
  }

  Write-Log "Aplicando git pull --ff-only $Remote $Branch"
  & git -C $repoRoot pull --ff-only $Remote $Branch >> $logPath 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "git pull fallo con codigo $LASTEXITCODE"
  }

  Write-Log "Recreando stack con docker compose down --remove-orphans"
  & $dockerExe --config $dockerConfigDir compose down --remove-orphans >> $logPath 2>&1

  Write-Log "Recreando stack con docker compose up -d --build"
  & $dockerExe --config $dockerConfigDir compose up -d --build >> $logPath 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose up -d --build fallo con codigo $LASTEXITCODE"
  }

  if ($hadPm2Monolith -and (Test-Pm2ProcessExists -Name "desarrolloeg-monolito")) {
    Write-Log "Eliminando desarrolloeg-monolito de PM2 y guardando dump"
    Invoke-Pm2 -Arguments @("delete", "desarrolloeg-monolito") | Out-Null
    Invoke-Pm2 -Arguments @("save", "--force") | Out-Null
  }

  Write-Log "Actualizacion completada correctamente"
} catch {
  Write-Log "Error actualizando el stack: $($_.Exception.Message)"
  exit 1
}
