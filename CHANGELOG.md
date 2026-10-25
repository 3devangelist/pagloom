# Changelog

All notable changes to Pagloom are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## [1.3.0] — 2026-10-26

### Added
**Interface**
- **English interface**: a **PT | EN** selector in the header switches the whole app between Portuguese and English: every button, tab, hint, panel and message, plus the Windows close warning and the "Save as" dialog. The choice is remembered; the default follows the system language.

**Text reading (OCR)**
- **Read text** with Tesseract, entirely on the PC (nothing is sent anywhere): **Read text** button (key O) over a page range, several pages in parallel. Languages: Portuguese, English, Italian, Spanish and French. Works on photos, images and scanned PDF pages; printed text only (handwriting is not reliable).
- **Language detected page by page**: each page is read with the language(s) found on it, so multilingual documents such as manuals come out right. The summary shows how many pages of each language were found.
- **Text read whenever pages are added** (on by default; can be turned off in the Text tab).
- **Text** tab: the text of the current page, Copy, and Save as `.txt` (all pages read).
- **Searchable PDF**: when exporting to PDF, the text read is placed as an invisible layer over each image (like OCRmyPDF), so the PDF can be searched (Ctrl+F), selected and read by other tools and AIs.

**Photo → page**
- **Open books and manuals**: a photo with two pages side by side is split into a left and a right page, each straightened on its own (Page tab: split automatically / do not split). The spine is found from two adjacent page candidates, from the notches in the paper outline, or from the spine shadow.
- **Preview → review → apply**: Batch (Shift+P) and "straighten photos as they are added" no longer change anything straight away. They propose the grids for every page; you go through the pages (arrow keys), confirm or fix each grid, skip a page or switch split / do not split, and **Apply all** (Enter) corrects everything at the end with a single Ctrl+Z. Esc cancels. Thumbnails show which pages have a proposal or are skipped. Text reading on add runs after applying.
- **Grids by hand**: **＋ Grid** inserts a fixed-size grid in the free half of the photo, ready to drag into place; **− Grid**, or right-click on a grid, deletes it (the grid is highlighted and you confirm). Each grid becomes one page, left to right (top to bottom when stacked), each in its own colour. When no spine is found, **Split** divides the grid down the middle for you to adjust.
- **Point hierarchy when editing a grid**: corners first, then edge points, then inner points. Moving a corner re-spaces the edge and inner points evenly (in the perspective of the corners); moving an edge point reshapes the inner points. A point you drag yourself stays where you put it (filled square) and is never moved automatically; double-click it to release it.
- Works on **scanned PDF pages** too (an image with no visible text or vector drawing; an invisible OCR layer is allowed), converted at the scan's own resolution. Digital PDF pages (text and vectors) are left out, with a message.
- Sheet detection also uses colour: paper is neutral, while light wood and coloured objects are not.
- **Training data**: when the export includes pages from Photo → page, a `<name>.treino.zip` is saved beside it with the original photos and a `malhas.json` holding, for each photo, the proposed grid and the final edited grid (points in pixels of the original photo, which points were placed by hand, skipped photos). It is collected to improve the detection later; see `treino/README.md`.

**Export**
- Resolution **Native (unchanged)**: image pages go into the PDF, or into PNG/JPEG files, with their original bytes, no resampling or recompression. The other resolutions are unchanged.

### Changed
- Progress messages now simply read "Processing…" (with the page count in batches).
- Confidence grades are no longer shown in the batch review: you see the grids and decide.

### For developers
- `treino/`: `avaliar.py` (standard-library Python) measures how far the automatic proposals in the collected `*.treino.zip` files are from the hand-corrected grids. The data itself (`treino/dados/`) stays out of git.
- New libraries in `fetch-libs.sh`: Tesseract.js 6.0.1 and tesseract.js-core 6.0.0 (Apache-2.0), with the `best_int` language data for por, eng, ita, spa and fra.

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

[1.3.0]: https://github.com/3devangelist/pagloom/releases/tag/v1.3.0
[1.2.0]: https://github.com/3devangelist/pagloom/releases/tag/v1.2.0
[1.1.0]: https://github.com/3devangelist/pagloom/releases/tag/v1.1.0
[1.0.0]: https://github.com/3devangelist/pagloom/releases/tag/v1.0.0
