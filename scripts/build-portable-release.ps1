param(
  [string]$OutputDir = "",
  [string]$ZipName = "desarrolloeg-release.zip",
  [switch]$IncludeSyncImage = $true
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$syncRepoRoot = Resolve-Path (Join-Path $repoRoot "..\appsheet_local_sync")
if (-not $OutputDir) {
  $OutputDir = Join-Path $repoRoot "release"
}

$stageDir = Join-Path $OutputDir "portable-release"
$manifestPath = Join-Path $stageDir "release-manifest.txt"
$imagesTarPath = Join-Path $stageDir "desarrolloeg-images.tar"
$zipPath = Join-Path $OutputDir $ZipName
$dockerExe = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"

function Write-Line {
  param([string]$Message)
  Write-Host $Message
}

function Ensure-Directory {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
  }
}

function Assert-FileExists {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    throw "No se encontro el archivo requerido: $Path"
  }
}

if (-not (Test-Path $dockerExe)) {
  throw "docker.exe no encontrado en $dockerExe"
}

Set-Location $repoRoot

Ensure-Directory $OutputDir
if (Test-Path $stageDir) {
  Remove-Item -Recurse -Force $stageDir
}
Ensure-Directory $stageDir

Assert-FileExists (Join-Path $repoRoot "docker-compose.portable.yml")
Assert-FileExists (Join-Path $repoRoot ".env.docker")
Assert-FileExists (Join-Path $repoRoot "scripts\apply-portable-release.ps1")
Assert-FileExists (Join-Path $repoRoot "Dockerfile")
Assert-FileExists (Join-Path $syncRepoRoot "data\desarrolloeg.sqlite")

Copy-Item -LiteralPath (Join-Path $repoRoot "docker-compose.portable.yml") -Destination (Join-Path $stageDir "docker-compose.yml") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot ".env.docker") -Destination (Join-Path $stageDir ".env.docker") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "scripts\apply-portable-release.ps1") -Destination (Join-Path $stageDir "apply-portable-release.ps1") -Force
Ensure-Directory (Join-Path $stageDir "seed-data")
Copy-Item -LiteralPath (Join-Path $syncRepoRoot "data\desarrolloeg.sqlite") -Destination (Join-Path $stageDir "seed-data\desarrolloeg.sqlite") -Force

$secretsSourceDir = Join-Path $repoRoot "secrets"
$secretsTargetDir = Join-Path $stageDir "secrets"
if (Test-Path $secretsSourceDir) {
  Copy-Item -LiteralPath $secretsSourceDir -Destination $secretsTargetDir -Recurse -Force
}

$monolitoImage = "desarrolloeg-utilidades-monolito:latest"
Write-Line "Reconstruyendo imagen: $monolitoImage"
$previousBuildKit = [Environment]::GetEnvironmentVariable("DOCKER_BUILDKIT", "Process")
try {
  [Environment]::SetEnvironmentVariable("DOCKER_BUILDKIT", "0", "Process")
  & $dockerExe build -t $monolitoImage -f (Join-Path $repoRoot "Dockerfile") $repoRoot
  if ($LASTEXITCODE -ne 0) {
    throw "docker build fallo con codigo $LASTEXITCODE"
  }

  if ($IncludeSyncImage) {
    $syncImage = "desarrolloeg-appsheet-local-sync:latest"
    Write-Line "Reconstruyendo imagen: $syncImage"
    & $dockerExe build -t $syncImage -f (Join-Path $syncRepoRoot "Dockerfile.desarrolloeg") $syncRepoRoot
    if ($LASTEXITCODE -ne 0) {
      throw "docker build sync fallo con codigo $LASTEXITCODE"
    }
  }
} finally {
  [Environment]::SetEnvironmentVariable("DOCKER_BUILDKIT", $previousBuildKit, "Process")
}

$images = @("desarrolloeg-utilidades-monolito:latest")
if ($IncludeSyncImage) {
  $images += "desarrolloeg-appsheet-local-sync:latest"
}

Write-Line "Guardando imagenes: $($images -join ', ')"
& $dockerExe save -o $imagesTarPath @images
if ($LASTEXITCODE -ne 0) {
  throw "docker save fallo con codigo $LASTEXITCODE"
}

@"
Paquete portable de Desarrollo EG
Generado: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

Contenido:
- docker-compose.yml
- .env.docker
- desarrolloeg-images.tar
- apply-portable-release.ps1
- seed-data/desarrolloeg.sqlite

Notas:
- cloudflared ya corre dentro de la imagen del monolito.
- En PC B solo se debe cargar el tar y levantar docker compose con --no-build.
- Si existe el contenedor desarrolloeg-monolito, el script de aplicacion lo elimina antes de recrearlo.
"@ | Set-Content -LiteralPath $manifestPath -Encoding ASCII

Push-Location $OutputDir
try {
  if (Test-Path $zipPath) {
    Remove-Item -Force $zipPath
  }
  Compress-Archive -Path (Join-Path $stageDir "*") -DestinationPath $zipPath -Force
} finally {
  Pop-Location
}

Write-Line "Paquete generado en: $zipPath"
Write-Line "Usa el script incluido apply-portable-release.ps1 en la PC B para aplicar el paquete."
