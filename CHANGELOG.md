# Changelog

All notable changes to Pagloom are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## [1.1.0] — 2026-10-12

### Added
- Logo: monogram **P** with a woven thread (`pagloom.svg`).
- Application icon in the Windows EXE, in the window title bar and taskbar, and in the Linux AppImages (scalable SVG plus PNG sizes from 16 to 512 px).
- Logo in the app header and in the README.

## [1.0.0] — 2026-10-11

First public release.

### Added
- Scanning through the OS driver: WIA on Windows, SANE on Linux (flatbed, ADF, ADF duplex), with colour mode, area, brightness and contrast.
- Separate acquisition and export resolution.
- Previous + current page view, thumbnails with drag-to-reorder, duplicate, delete, undo/redo.
- Editing tools: free-angle rotation with grid, straighten by drawing a line, crop, white point, black point, auto levels, rotate 90°.
- Import of PDFs (including password-protected) and PNG/JPEG/WEBP/GIF/BMP images; PDF pages stay vector when moved, rotated 90° or cropped.
- Export to PDF, PNG, JPEG, multi-page TIFF and SVG, with correct dpi metadata.
- Windows EXE (WebView2 window) and Linux AppImages for x86_64 and aarch64.
- First-run installation of SANE and sane-airscan on Linux via apt, dnf, zypper or pacman.

### Known limitations
- Not yet tested with a real scanner.
- Closing the window without exporting loses the pages.
- TIFF import is not supported.
- No macOS build.

[1.1.0]: https://github.com/3devangelist/pagloom/releases/tag/v1.1.0
[1.0.0]: https://github.com/3devangelist/pagloom/releases/tag/v1.0.0
