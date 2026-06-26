param(
  [string]$RepoUrl = "",
  [string]$InstallDir = "",
  [string]$Branch = "main",
  [int]$UpdateIntervalMinutes = 15,
  [string]$StartTaskName = "DesarrolloegMonolitoStart",
  [string]$UpdateTaskName = "DesarrolloegMonolitoUpdate"
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
  $candidate = Split-Path -Parent $PSScriptRoot
  if (Test-Path (Join-Path $candidate ".git")) {
    return (Resolve-Path $candidate).Path
  }
  return $null
}

function Write-Info {
  param([string]$Message)
  Write-Host $Message
}

function Ensure-Directory {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
  }
}

function Ensure-Repo {
  param(
    [string]$TargetDir,
    [string]$SourceUrl,
    [string]$SourceBranch
  )

  if (Test-Path (Join-Path $TargetDir ".git")) {
    return (Resolve-Path $TargetDir).Path
  }

  if (-not $SourceUrl) {
    throw "No existe un repo local y no se proporciono -RepoUrl"
  }

  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git no esta disponible en PATH"
  }

  if (Test-Path $TargetDir) {
    $items = Get-ChildItem -Force -LiteralPath $TargetDir
    if ($items.Count -gt 0) {
      throw "El directorio destino no esta vacio: $TargetDir"
    }
  } else {
    New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
  }

  Write-Info "Clonando $SourceUrl en $TargetDir"
  & git clone --branch $SourceBranch --single-branch $SourceUrl $TargetDir
  if ($LASTEXITCODE -ne 0) {
    throw "git clone fallo con codigo $LASTEXITCODE"
  }

  return (Resolve-Path $TargetDir).Path
}

function Initialize-DockerConfig {
  param([string]$RepoRoot)

  $dockerConfigDir = Join-Path $RepoRoot ".docker-runtime-config"
  $dockerConfigPath = Join-Path $dockerConfigDir "config.json"
  $dockerSourceContexts = Join-Path $env:USERPROFILE ".docker\contexts"
  $dockerTargetContexts = Join-Path $dockerConfigDir "contexts"

  Ensure-Directory $dockerConfigDir
  if (Test-Path $dockerSourceContexts) {
    Copy-Item -LiteralPath $dockerSourceContexts -Destination $dockerTargetContexts -Recurse -Force
  }

  @'
{
  "auths": {},
  "credsStore": "empty"
}
'@ | Set-Content -LiteralPath $dockerConfigPath -Encoding ASCII
}

function Ensure-LocalFolders {
  param([string]$RepoRoot)

  foreach ($relative in @("runtime", "secrets", "publicimg", "cloudflared")) {
    Ensure-Directory (Join-Path $RepoRoot $relative)
  }
}

function Ensure-EnvFile {
  param([string]$RepoRoot)

  $envDocker = Join-Path $RepoRoot ".env.docker"
  $envExample = Join-Path $RepoRoot ".env.example"
  if (-not (Test-Path $envDocker)) {
    if (-not (Test-Path $envExample)) {
      throw "No se encontro .env.example para crear .env.docker"
    }

    Copy-Item -LiteralPath $envExample -Destination $envDocker
    Write-Info "Se creo .env.docker a partir de .env.example"
  }
}

function Invoke-ComposeBootstrap {
  param([string]$RepoRoot)

  $dockerExe = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
  $dockerDesktopExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  $dockerServiceName = "com.docker.service"
  $dockerConfigDir = Join-Path $RepoRoot ".docker-runtime-config"

  if (-not (Test-Path $dockerExe)) {
    throw "docker.exe no encontrado en $dockerExe"
  }

  try {
    $dockerService = Get-Service -Name $dockerServiceName -ErrorAction SilentlyContinue
    if ($dockerService -and $dockerService.Status -ne "Running") {
      Set-Service -Name $dockerServiceName -StartupType Automatic
      Start-Service -Name $dockerServiceName
    }
    if ($dockerService) {
      Set-Service -Name $dockerServiceName -StartupType Automatic
    }
  } catch {
  }

  try {
    if ((Test-Path $dockerDesktopExe) -and -not (Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue)) {
      Start-Process -FilePath $dockerDesktopExe
      Start-Sleep -Seconds 5
    }
  } catch {
  }

  $ready = $false
  for ($attempt = 1; $attempt -le 90; $attempt++) {
    try {
      & $dockerExe --config $dockerConfigDir version | Out-Null
      if ($LASTEXITCODE -eq 0) {
        $ready = $true
        break
      }
    } catch {
    }

    Start-Sleep -Seconds 10
  }

  if (-not $ready) {
    throw "Docker no quedo listo para levantar el stack"
  }

  Set-Location $RepoRoot
  & $dockerExe --config $dockerConfigDir compose up -d --build
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose up -d --build fallo con codigo $LASTEXITCODE"
  }
}

function Register-UpdateTask {
  param(
    [string]$TaskName,
    [string]$ScriptPath,
    [string]$BranchName,
    [int]$IntervalMinutes
  )

  $powershellExe = (Get-Command powershell.exe).Source
  $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -Branch `"$BranchName`""
  $action = New-ScheduledTaskAction -Execute $powershellExe -Argument $arguments

  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }

  $startAt = (Get-Date).AddMinutes(2)
  $trigger = New-ScheduledTaskTrigger -Once -At $startAt -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)

  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Actualizacion automatica del monolito Docker desde git"
}

$repoRoot = Resolve-RepoRoot
if (-not $repoRoot) {
  if (-not $InstallDir) {
    $InstallDir = Join-Path $env:ProgramData "DesarrolloEG\Monolito"
  }

  if (-not $RepoUrl) {
    throw "Para instalar desde cero necesitas -RepoUrl o ejecutar el script dentro del repo clonado."
  }

  $repoRoot = Ensure-Repo -TargetDir $InstallDir -SourceUrl $RepoUrl -SourceBranch $Branch
} else {
  if (-not $InstallDir) {
    $InstallDir = $repoRoot
  }
}

Set-Location $repoRoot
Write-Info "Repositorio listo en $repoRoot"

Ensure-EnvFile -RepoRoot $repoRoot
Ensure-LocalFolders -RepoRoot $repoRoot
Initialize-DockerConfig -RepoRoot $repoRoot

Write-Info "Levantando el stack Docker"
Invoke-ComposeBootstrap -RepoRoot $repoRoot

$startScript = Join-Path $repoRoot "scripts\start-docker-monolith-autostart.ps1"
$updateScript = Join-Path $repoRoot "scripts\update-docker-monolith.ps1"

if (-not (Test-Path $startScript)) {
  throw "No se encontro el script de arranque: $startScript"
}

if (-not (Test-Path $updateScript)) {
  throw "No se encontro el script de actualizacion: $updateScript"
}

$startArguments = "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`""
$powershellExe = (Get-Command powershell.exe).Source
$startAction = New-ScheduledTaskAction -Execute $powershellExe -Argument $startArguments
if (Get-ScheduledTask -TaskName $StartTaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $StartTaskName -Confirm:$false
}
$startTrigger = New-ScheduledTaskTrigger -AtStartup
$startPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$startSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $StartTaskName -Action $startAction -Trigger $startTrigger -Principal $startPrincipal -Settings $startSettings -Description "Despliegue automatico del monolito Docker"

Register-UpdateTask -TaskName $UpdateTaskName -ScriptPath $updateScript -BranchName $Branch -IntervalMinutes $UpdateIntervalMinutes

Write-Info "Instalacion completada"
Write-Info "Tarea de arranque: $StartTaskName"
Write-Info "Tarea de actualizacion: $UpdateTaskName"
