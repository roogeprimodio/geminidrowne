# Gemini Image Downloader

Electron app that downloads images from public Google Gemini chat links.

## Prerequisites

- Node.js 18+
- npm installed

Install dependencies once:

```bash
npm install
```

## During development

```bash
npm run electron:dev
```

## Build installable packages

### Windows installer (.exe)

```bash
npm run dist:win
```

- Output: `electron-dist/`
- Installer name: `Gemini-Image-Downloader-<version>-Setup.exe`
- Includes NSIS wizard with desktop/start-menu shortcuts

### macOS build (DMG/ZIP)

```bash
npm run dist:mac
```

> Requires macOS to sign/notarize binaries. If you only need Windows installers, you can ignore this.

The build scripts automatically regenerate `build/icon.ico` (256×256) to satisfy Windows requirements, so no extra manual steps are needed before packaging.

## Portable CLI script

You can also run the downloader straight from Node:

```bash
node download-gemini-images.js <Gemini share URL>
```

Use the Electron app if you want a simple GUI flow.
