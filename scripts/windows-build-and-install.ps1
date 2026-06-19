param(
  [switch]$NoLaunch,
  [switch]$NoShortcut
)

$ErrorActionPreference = "Stop"

function Step($Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Require-Command($Name, $Hint) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "$Name was not found. $Hint"
  }
  return $command.Source
}

function Require-Node24 {
  $nodePath = Require-Command "node" "Install Node.js 24 LTS or newer, then reopen this terminal."
  $versionText = & $nodePath --version
  if ($LASTEXITCODE -ne 0) {
    throw "node --version failed."
  }
  $version = [version]($versionText.TrimStart("v"))
  if ($version.Major -lt 24) {
    throw "Node.js $versionText is too old. Install Node.js 24 LTS or newer."
  }
  return $versionText
}

function Copy-CleanDirectory($Source, $Destination) {
  if (Test-Path $Destination) {
    Remove-Item $Destination -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
  Copy-Item $Source $Destination -Recurse -Force
}

function New-Shortcut($ShortcutPath, $TargetPath, $WorkingDirectory) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $TargetPath
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.IconLocation = $TargetPath
  $shortcut.Save()
}

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

Step "Checking prerequisites"
$nodeVersion = Require-Node24
Require-Command "npm" "Install Node.js 24 LTS or newer; npm is bundled with Node.js." | Out-Null
Require-Command "tar" "Windows 10/11 normally includes tar.exe. If it is missing, install a current Windows build or Git for Windows." | Out-Null
Write-Host "Node.js: $nodeVersion"

Step "Installing npm dependencies"
npm ci
if ($LASTEXITCODE -ne 0) {
  throw "npm ci failed."
}

Step "Building and verifying the Windows desktop package"
npm run pack:desktop
if ($LASTEXITCODE -ne 0) {
  throw "npm run pack:desktop failed."
}

$BuiltApp = Join-Path $Root "dist\win-unpacked"
$ExePath = Join-Path $BuiltApp "Question Workbench.exe"
if (-not (Test-Path $ExePath)) {
  throw "Built app was not found: $ExePath"
}

$InstallRoot = Join-Path $env:LOCALAPPDATA "QuestionWorkbench"
$InstallApp = Join-Path $InstallRoot "app"
$InstalledExe = Join-Path $InstallApp "Question Workbench.exe"

Step "Installing to $InstallApp"
Copy-CleanDirectory $BuiltApp $InstallApp

if (-not $NoShortcut) {
  Step "Creating shortcuts"
  $Programs = [Environment]::GetFolderPath("Programs")
  $StartMenuDir = Join-Path $Programs "Question Workbench"
  New-Item -ItemType Directory -Force -Path $StartMenuDir | Out-Null
  New-Shortcut (Join-Path $StartMenuDir "Question Workbench.lnk") $InstalledExe $InstallApp
  New-Shortcut (Join-Path ([Environment]::GetFolderPath("Desktop")) "Question Workbench.lnk") $InstalledExe $InstallApp
}

Step "Installed"
Write-Host "App: $InstalledExe"

if (-not $NoLaunch) {
  Step "Launching Question Workbench"
  Start-Process $InstalledExe
}
