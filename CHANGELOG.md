# Changelog

All notable changes to Pagloom are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## [1.2.0] — 2026-10-25

### Added
- Warning when closing the window with pages that have not been exported (Windows: confirmation dialog on close; Linux/browser: the browser's leave-page prompt).
- **Photo → page** tool (key P): finds the sheet in a phone photo at full resolution, places an N×N grid of points (4×4 by default, up to 8×8) on its real, possibly curved edges, and corrects perspective and curvature with a smooth bicubic warp. Points can be dragged, with a magnifier.
- True size for corrected photos: automatic format from the perspective (A4, Letter, Legal), or A3/A4/A5/A6/Letter/Legal, or a custom size in mm. The page gets the right size in mm and the highest dpi the photo allows.
- Option to straighten photos automatically when adding them; several photos are processed at once, one per CPU core (Web Workers, up to 8).
- Content-first geometry: corners come from straight lines fitted to the middle of each edge (folded or missing corners do not pull them). The output is warp and crop only: the photo's own pixels, nothing painted, colours untouched. By default only perspective is corrected; curvature is applied only when lines of text, printed rules, margins and table lines confirm it, choosing the simplest model that makes them straight.
- **Lote** button (Shift+P): Photo → page on a page range ("from page X to page Y"; defaults to all pages, or to the selection), one per CPU core; low-confidence pages are left untouched and one Ctrl+Z undoes the whole batch.
- Parallel photo processing adapts to the PC: the Go program reports the real CPU count and free memory (Windows: GlobalMemoryStatusEx; Linux: /proc/meminfo), and the number of workers follows free memory and photo size (~0.6 GB per 12 MP photo, 25% kept in reserve). Pixels are prepared only when a worker is free. If a worker runs out of memory, the limit drops and the photo is retried. Manual override: "Fotos em paralelo" in the Página tab.
- The top **Exportar** button and Ctrl+E open a dialog asking for format, pages and resolution before the "Save as" dialog.
- Angle, Straighten, White point and Black point tools now have a Cancel/Close button (Esc also works while typing in a field).
- Confidence level (high / medium / low) with reasons, and an optional overlay showing where the content was measured. Automatic mode leaves low-confidence photos untouched.
- Sheet detection works on textured backgrounds (lace, fabric, wood grain): it measures local texture, since paper is smooth, and only accepts an edge with smooth paper just inside it.
- HEIC/HEIF import (iPhone photos), via libheif.
- JPEG EXIF orientation is honoured on import.

### For developers
- `dev-server.js` (or `testar-interface.bat` on Windows): runs the interface in a browser without compiling the Go program; no scanner, Export uses the Windows "Save as" dialog.
- New libraries in `fetch-libs.sh`: OpenCV.js 4.12.0 (Apache-2.0) and libheif-js 1.23.2 (LGPL-3.0).

### Removed
- "TIFF import is not supported" from the known limitations: TIFF import is not planned.

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

[1.2.0]: https://github.com/3devangelist/pagloom/releases/tag/v1.2.0
[1.1.0]: https://github.com/3devangelist/pagloom/releases/tag/v1.1.0
[1.0.0]: https://github.com/3devangelist/pagloom/releases/tag/v1.0.0
