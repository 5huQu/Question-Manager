# Windows build and install

## Prerequisites

- Windows 10/11 x64
- Node.js 24 LTS or newer
- Internet access for `npm ci`, Electron downloads, and the bundled Python runtime download

No system Python installation is required. The build script downloads a pinned Windows CPython runtime and packages it with the app.

## One-step build

Double-click:

```bat
build-and-install-windows.cmd
```

Or run from PowerShell:

```powershell
.\scripts\windows-build-and-install.ps1
```

The script will:

1. Install npm dependencies with `npm ci`.
2. Download and verify the bundled Windows Python runtime.
3. Build the frontend and backend.
4. Package and verify `dist\win-unpacked`.
5. Verify the packaged Python runtime with a real PDF cutting smoke test.
6. Build a standard NSIS installer.
7. Launch the installer, which creates Start Menu/Desktop shortcuts and a standard uninstall entry.

## Options

```powershell
.\scripts\windows-build-and-install.ps1 -NoLaunch
.\scripts\windows-build-and-install.ps1 -NoShortcut
```

`-NoLaunch` only builds the installer. `-NoShortcut` launches the installer without creating a Desktop shortcut.

## Output

- Verified unpacked app: `dist\win-unpacked`
- Installer: `dist\Question-Manager-Setup-<version>-x64.exe`

After installation, Question Manager appears in Windows Settings under Apps and can be removed through the standard uninstall entry.
