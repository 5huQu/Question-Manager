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
4. Package `dist\win-unpacked`.
5. Verify the packaged Python runtime.
6. Copy the app to `%LOCALAPPDATA%\QuestionWorkbench\app`.
7. Create Start Menu and Desktop shortcuts.
8. Launch Question Workbench.

## Options

```powershell
.\scripts\windows-build-and-install.ps1 -NoLaunch
.\scripts\windows-build-and-install.ps1 -NoShortcut
```

## Output

- Built package: `dist\win-unpacked`
- Installed app: `%LOCALAPPDATA%\QuestionWorkbench\app\Question Workbench.exe`
