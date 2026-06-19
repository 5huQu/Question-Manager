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

Step "Building and verifying the Windows NSIS installer"
npm run pack:windows-installer
if ($LASTEXITCODE -ne 0) {
  throw "npm run pack:windows-installer failed."
}

$Installer = Get-ChildItem (Join-Path $Root "dist") -Filter "Question-Manager-Setup-*-x64.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $Installer) {
  throw "The NSIS installer was not found in the dist directory."
}

Step "Installer ready"
Write-Host "Installer: $($Installer.FullName)"

if (-not $NoLaunch) {
  Step "Launching the Question Manager installer"
  $InstallerArgs = @()
  if ($NoShortcut) {
    $InstallerArgs += "--no-desktop-shortcut"
  }
  $Process = if ($InstallerArgs.Count -gt 0) {
    Start-Process -FilePath $Installer.FullName -ArgumentList $InstallerArgs -Wait -PassThru
  } else {
    Start-Process -FilePath $Installer.FullName -Wait -PassThru
  }
  if ($Process.ExitCode -ne 0) {
    throw "The installer exited with code $($Process.ExitCode)."
  }
}
