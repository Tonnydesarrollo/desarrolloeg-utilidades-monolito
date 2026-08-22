param(
  [string]$PackagePath = "",
  [string]$TargetDir = ""
)

$ErrorActionPreference = "Stop"

if (-not $PackagePath) {
  throw "Debes indicar -PackagePath con el zip portable generado desde la PC A"
}

if (-not (Test-Path $PackagePath)) {
  throw "No existe el paquete: $PackagePath"
}

if (-not $TargetDir) {
  $TargetDir = Join-Path $env:ProgramData "DesarrolloEG\MonolitoPortable"
}

$dockerExe = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
if (-not (Test-Path $dockerExe)) {
  throw "docker.exe no encontrado en $dockerExe"
}

function Ensure-Directory {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
  }
}

Ensure-Directory $TargetDir

$extractDir = Join-Path $TargetDir "package"
if (Test-Path $extractDir) {
  Remove-Item -Recurse -Force $extractDir
}
Ensure-Directory $extractDir

Expand-Archive -Path $PackagePath -DestinationPath $extractDir -Force

$composePath = Join-Path $extractDir "docker-compose.yml"
$envPath = Join-Path $extractDir ".env.docker"
$imagesTarPath = Join-Path $extractDir "desarrolloeg-images.tar"
$applyLogPath = Join-Path $TargetDir "apply-portable-release.log"

foreach ($required in @($composePath, $envPath, $imagesTarPath)) {
  if (-not (Test-Path $required)) {
    throw "Falta el archivo requerido en el paquete: $required"
  }
}

function Write-Log {
  param([string]$Message)
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -LiteralPath $applyLogPath -Value "[$timestamp] $Message"
}

Write-Log "Cargando imagenes desde $imagesTarPath"
& $dockerExe load -i $imagesTarPath
if ($LASTEXITCODE -ne 0) {
  throw "docker load fallo con codigo $LASTEXITCODE"
}

Write-Log "Eliminando contenedores viejos si existen"
foreach ($name in @("desarrolloeg-monolito", "desarrolloeg-monolito-qa", "desarrolloeg-appsheet-local-sync")) {
  & $dockerExe rm -f $name 2>$null | Out-Null
}

$env:COMPOSE_PROJECT_NAME = "desarrolloeg"
Push-Location $extractDir
try {
  Write-Log "Levantando stack con docker compose up -d --no-build"
  & $dockerExe compose up -d --no-build
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose up -d --no-build fallo con codigo $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

Write-Log "Despliegue portable completado"
Write-Host "Despliegue completado en $TargetDir"
