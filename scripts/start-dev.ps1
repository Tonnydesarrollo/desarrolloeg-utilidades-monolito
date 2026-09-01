param(
  [switch]$NoBuild
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $projectRoot "docker-compose.dev.yml"
$envFile = Join-Path $projectRoot ".env.dev.docker"
$database = Join-Path $projectRoot "data-dev\desarrolloeg.sqlite"
$env:COMPOSE_BAKE = "false"

if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Falta .env.dev.docker. Recupera la configuracion de PC B antes de iniciar desarrollo."
}

if (-not (Test-Path -LiteralPath $database)) {
  throw "Falta data-dev\desarrolloeg.sqlite. Crea una semilla consistente desde PC B."
}

$arguments = @("compose", "-f", $composeFile, "up", "-d")
if (-not $NoBuild) {
  $arguments += "--build"
}

& docker @arguments
if ($LASTEXITCODE -ne 0) {
  throw "No se pudo iniciar el entorno de desarrollo."
}

Write-Host "Portal local: http://localhost:7001"
Write-Host "Salud sync:  http://localhost:8788/health"
