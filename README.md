<p align="center"><img src="pagloom.svg" width="128" alt="Pagloom logo"></p>

# Pagloom — Scanner & PDF Utility

[![Latest release](https://img.shields.io/github/v/release/3devangelist/pagloom)](https://github.com/3devangelist/pagloom/releases/latest)
[![Build](https://github.com/3devangelist/pagloom/actions/workflows/release.yml/badge.svg)](https://github.com/3devangelist/pagloom/actions/workflows/release.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

*Versão em português: [README.pt-PT.md](README.pt-PT.md)*

**Pagloom** is a desktop app for scanning documents, fixing the pages and weaving everything, including existing PDFs, into a single document. The name comes from *page* + *loom*.

**[⬇ Download the latest release](https://github.com/3devangelist/pagloom/releases/latest)** — Windows (`.zip`) and Linux (`.AppImage`).

| Scanning, previous + current page | Cropping a PDF page (stays vector) | Free-angle rotation and export |
|---|---|---|
| ![Scanning](docs/scan.png) | ![Cropping](docs/crop.png) | ![Rotation and export](docs/edit-export.png) |

| | |
|---|---|
| **Made on** | 11 October 2026 |
| **Requested and directed by** | Ricardo Pereira ([@3devangelist](https://github.com/3devangelist)) |
| **Written by** | Claude (Anthropic), in Cowork |
| **Platforms** | Windows 10/11 · Linux (Ubuntu, Debian, Fedora, openSUSE, Arch) · Linux ARM (Raspberry Pi) |
| **Interface language** | Portuguese (Portugal) |
| **Licence** | [MIT](LICENSE) |

---

## What it does

- **Scans** sheets from the flatbed or the automatic document feeder (ADF), including duplex, through the operating system's own scanner driver.
- **Shows each page as it is scanned**, with the previous page side by side when useful.
- **Fixes pages**: rotate by any angle, straighten, crop and set the white and black points.
- **Merges PDFs and images** with the scans and lets you **reorder pages** by dragging.
- **Turns phone photos into pages**: finds the sheet, corrects perspective and curvature, and sets the page to its real size.
- **Exports** to PDF, PNG, JPEG, TIFF or SVG at the resolution you choose.

In short, one program for scanning and for the usual PDF chores: merging, reordering, rotating, cropping and deleting pages.

---

## How it works

### Scanning
1. In the **Digitalizar** (Scan) tab, pick the scanner, source (flatbed, ADF, ADF duplex), colour mode, **acquisition resolution** and area (A4, A5, Letter or full bed). Brightness and contrast are optional.
2. Press **Digitalizar** (or the Space bar). New pages are inserted after the current page.
3. **Redigitalizar página atual** (rescan current page) replaces the page you are viewing.
4. On Windows there is also **Digitalizar com janela do driver**, which opens the manufacturer's own scanning dialog.

### Navigating and organising
- Thumbnails on the left: click to open, **drag to reorder**. Ctrl+click and Shift+click select several pages.
- ◀ ▶ buttons or the arrow keys change page. The mouse wheel also changes page when not zoomed in.
- **Anterior + atual** shows the previous page next to the current one.
- **Duplicate**, **Delete**, **Undo** (Ctrl+Z) and **Redo** (Ctrl+Y).

### Editing tools
| Tool | Key | What it does |
|---|---|---|
| Move | H / Esc | Pan the page when zoomed in |
| Crop | C | Mark the area to keep, adjust by the handles, Enter to apply |
| Angle | A | Rotate by any angle (0.1° steps), with an alignment grid |
| Straighten | T | Draw a line along a line of text or a margin; the page is levelled |
| Photo → page | P | Finds the sheet in a photo and corrects perspective, edge curvature and size (see below) |
| Batch | Shift+P | Photo → page on a page range (from page X to Y), several at once |
| White point | W | Click an area that should be white; colours are corrected from it |
| Black point | K | Click an area that should be black |
| Auto levels | — | Automatic white/black correction on the selected pages |
| Rotate 90° | R / L | Rotate the selected pages right or left |

### Adding PDFs and images
- **Adicionar PDF / imagens** button (Ctrl+O), or drag files from the file manager onto the window.
- Accepts PDF, PNG, JPEG, HEIC/HEIF (iPhone photos), WEBP, GIF and BMP. Password-protected PDFs ask for the password.
- Photos come in the right way up (the phone's EXIF orientation is applied).
- **PDF pages stay vector** (selectable text) when moved, rotated by 90° or cropped.
- Free-angle rotation, straightening and levels turn that page into an image, at the resolution set in the **Página** tab (300 dpi by default).

### Phone photos → page
1. Add the photo and press **Foto → página** (key P).
2. Pagloom looks for the sheet in the photo **at full resolution** and places a **grid of points** (4 × 4 by default; 3 × 3 up to 8 × 8):
   - **Corners:** where straight lines fitted to the middle of each edge meet. A folded or missing corner does not pull the edge.
   - **Warp and crop only:** the result is the photo's own pixels resampled onto the straightened page; nothing is painted and colours and levels are left alone. Anything missing from the photo shows as photographed.
   - **Minimal deformation:** by default only perspective is corrected. Curvature is added only when the **content** confirms it: lines of text and printed rules (horizontal), and margins, columns and table lines (vertical), were straight on paper.
   - **Validation:** "perspective only" is compared with "perspective + content correction", and the simplest one that straightens the text wins. A **confidence** level (high, medium, low) is shown with the reasons; "mostrar análise" shows in green where the lines were measured.
3. Drag any point if needed. A magnifier appears for precise placement, and Ctrl+wheel zooms in.
4. **Sheet format**: *Automatic* works out the real proportions from the perspective and picks A4, Letter or Legal. You can also pick A3, A4, A5, A6, Letter, Legal or a **custom size** in mm, for books with non-standard sizes.
5. **Enter** applies. The page comes out straight, with the correct size in mm and the resolution (dpi) the photo allows, without downscaling.
6. In the **Página** tab, **Endireitar logo as fotos ao adicionar** does this automatically for every JPEG and HEIC photo you add, several photos at once (one per CPU core). Photos with low confidence are left as they are, for you to fix by hand. The number of photos processed in parallel adapts to the PC (cores, free memory and photo size); on a modest PC fewer run at once, and if memory runs out the number drops and the photo is retried. It can also be fixed by hand in **Fotos em paralelo**.

Detection also works on textured backgrounds such as lace tablecloths, fabric or wood grain: paper is smooth, so the edge chosen is the outermost one with smooth paper just inside it.

### Exporting
1. **Exportar** tab: choose the format, the pages (all, selected, current or a range such as `1-3, 5`) and the **export resolution**.
2. PDF options: keep the original PDF pages, and store images as JPEG (adjustable quality) or lossless (PNG).
3. **Exportar…** opens the system "Save as" dialog. When it finishes, a **show in folder** link appears.
4. The **Exportar** button at the top (or Ctrl+E) first asks for the format, pages and resolution, then opens "Save as" to choose the folder and file name.

| Format | Result |
|---|---|
| PDF | One multi-page file |
| TIFF | One multi-page file (PackBits compression) |
| PNG / JPEG / SVG | One file per page (`name_001`, `name_002`, …) |

The export resolution only ever reduces; it never upsamples beyond the scanned resolution. PNG, JPEG and TIFF files carry the correct dpi, so they print at real size.

Closing the window while there are pages that have not been exported asks for confirmation first.

---

## Installation

### Windows
1. Extract `Pagloom.exe` from the `.zip`.
2. On first run: **More info → Run anyway** (the program is not code-signed).
3. Requires WebView2, which ships with Windows 11 and most Windows 10 installs.

### Linux (Ubuntu, Debian, Fedora, openSUSE…)
```bash
chmod +x Pagloom-x86_64.AppImage   # or -aarch64 on a Raspberry Pi
./Pagloom-x86_64.AppImage
```
On first run, if SANE is missing, Pagloom asks whether it may install it, using the system's package manager:

| System | Packages |
|---|---|
| Ubuntu / Debian (APT) | `sane-utils sane-airscan` |
| Fedora (DNF) | `sane-backends sane-backends-drivers-scanners sane-airscan` |
| openSUSE (Zypper) | `sane-backends sane-airscan` |
| Arch (Pacman) | `sane sane-airscan` |

The password is requested through the system dialog (pkexec). Without it, Pagloom opens a terminal with the `sudo` command ready. `sane-airscan` enables network scanners, such as the EPSON ET-2850, without a vendor driver.

If the AppImage does not start because of FUSE, run it with `--appimage-extract-and-run`.

---

## How it is built

```
┌─────────────────────────────── Pagloom ────────────────────────────────┐
│  Interface (HTML + JavaScript)                                         │
│  pages, tools, pdf.js (reading PDFs), pdf-lib (writing PDFs)           │
├────────────────────────────────────────────────────────────────────────┤
│  Local Go server (127.0.0.1, with an access token)                     │
│  Windows: WIA (Windows driver) · WebView2 window · "Save as" dialog    │
│  Linux:   SANE (scanimage) · Chromium/Chrome or Firefox window · zenity│
└────────────────────────────────────────────────────────────────────────┘
```

- The interface is identical on every platform; only the layer that talks to the scanner and to the system dialogs changes.
- Pagloom is a single executable with the interface and libraries embedded.
- Scans live in a temporary folder that is deleted on exit. Settings are stored in `%APPDATA%\Pagloom` (Windows) or `~/.config/Pagloom` (Linux).

---

## Building from source

Requirements: **Go 1.24 or newer** and `curl`, on Linux (AppImages can only be built on Linux).

```bash
bash build.sh
```

The script writes to `dist/`:
- `Pagloom.exe` (Windows x86_64)
- `Pagloom-x86_64.AppImage` and `Pagloom-aarch64.AppImage` (Linux)

On first run the script downloads the JavaScript libraries (`fetch-libs.sh`: pdf.js, pdf-lib, OpenCV.js and libheif from the npm registry into `web/lib/`), the Go dependencies (`go mod tidy`), and `appimagetool` with the AppImage runtimes into `build/tools/`.

Windows only, also from Windows:
```bash
bash fetch-libs.sh   # or download the files listed in it by hand
go mod tidy
go build -trimpath -ldflags "-H windowsgui -s -w" -o Pagloom.exe .
```

Releases are built automatically by GitHub Actions (`.github/workflows/release.yml`): push a tag such as `v1.1.0` and the workflow builds the three files and publishes the release.

To try the interface **without compiling** (needs only Node.js and the libraries in `web/lib/`):
```bash
node dev-server.js        # or, on Windows, double-click testar-interface.bat
```
Open `http://127.0.0.1:8765/` in a browser. There is no scanner; Export opens the Windows "Save as" dialog (on other systems files go to `dev-out/`). The rest of the interface works as in the real program.

To try the interface without a scanner but with the Go program, there is a simulated scanner:
```bash
bash fetch-libs.sh
PAGLOOM_MOCK=1 go run .
```

### Repository layout
```
main.go            local server, API, start-up
types.go           shared types and helpers
wia_windows.go     scanner on Windows (WIA)
ui_windows.go      WebView2 window and "Save as" dialog on Windows
sane_linux.go      scanner on Linux (SANE / scanimage)
ui_linux.go        window, "Save as" and "show in folder" on Linux
deps_linux.go      dependency detection and install (apt, dnf, zypper, pacman)
mock.go            simulated scanner for testing
web/               interface (index.html, style.css, app.js); web/lib/ is filled by fetch-libs.sh
web/photo.js       photo → page: sheet detection, point grid, perspective and curvature correction
web/photo-worker.js  runs photo.js on other CPU cores (Web Workers)
fetch-libs.sh      downloads pdf.js, pdf-lib, OpenCV.js and libheif
dev-server.js      test server for the interface without compiling (testar-interface.bat on Windows)
build.sh           build and AppImage packaging
pagloom.svg        logo (source); pagloom.png / pagloom.ico / icons/ are generated from it
rsrc_windows_amd64.syso  Windows icon resource, linked into Pagloom.exe
docs/              screenshots and social preview image
.github/           release workflow and issue templates
```

---

## Tools used

| Tool | Purpose |
|---|---|
| **Go 1.24** | Main program, local server, cross-compiling for Windows and Linux (x86_64 and ARM) |
| **go-ole** | Access to WIA (Windows Image Acquisition) through COM |
| **go-webview2** | Window with the Edge engine (WebView2) on Windows |
| **WIA** | Windows scanner driver framework |
| **SANE / scanimage** | Linux scanner driver framework |
| **pdf.js** (Mozilla, Apache-2.0) | Reading and rendering PDFs |
| **pdf-lib** (MIT) | Writing PDFs, copying vector pages, rotating and cropping |
| **OpenCV.js** (Apache-2.0) | Finding the sheet in photos and resampling the corrected page (bicubic remap) |
| **libheif-js** (LGPL-3.0) | Opening HEIC/HEIF photos from iPhones |
| **HTML5 Canvas** | Rotation, cropping, levels, thumbnails |
| **zenity / kdialog / pkexec** | Linux dialogs ("Save as", questions, password) |
| **appimagetool** | Building the AppImages |
| **Playwright + Chromium** | Automated interface tests |
| **Python (Pillow, pypdf, img2pdf)** | Checking exported files, and the `pngs_para_pdf.py` helper script |

### Before this version
1. **`Digitalizador.hta`**: first Windows-only version, an HTML Application running on the old Internet Explorer engine. Dropped because of problems listing scanners and exporting PDFs.
2. **`pngs_para_pdf.py`**: a Python script that merges every PNG in a folder into one PDF, used as a stop-gap.
3. **Pagloom (this version)**: a native program for Windows and Linux.

### Known limitations
- Tested with a simulated scanner; still to be confirmed with a real EPSON ET-2850.
- Photo → page: tested with 24 real photos (sheets on a lace tablecloth): 22 with high or medium confidence and the text straight to 0.15–0.5 mm; the other 2 are flagged for manual correction. The proportion worked out from perspective can be off by up to ~8%, so automatic mode prefers A4; for other formats, pick the format.
- No macOS build yet.

---

## Ricardo's requests and rules

**Initial request**

1. Sheet-scanning software that uses the **Windows driver directly**.
2. Show the **previously scanned page**.
3. Allow **paging forwards and backwards**.
4. Choose separate **acquisition resolution** and **export resolution**.
5. Export to the best-known formats: **PDF, PNG, SVG**, "whatever works".
6. Something **easy to use whenever needed** (initially, HTML).

**Follow-up requests**

7. A file with a `.html` extension so it could be downloaded.
8. A Python script to merge all PNGs in a folder into a PDF.
9. A straight answer, without changing anything: can this work inside the browser?
10. Turn the app into an **EXE**.
11. **Rotate pages by any angle**.
12. **Crop**.
13. **Set levels by clicking on the white area with the mouse**.
14. **Add PDFs and reorder pages**, to solve everyday PDF problems.
15. Make the app independent of the operating system.
16. A **Linux AppImage**.
17. **Install dependencies on first run**: via **APT** on Ubuntu/Debian, or the system's own package manager elsewhere.
18. An **AppImage for Fedora**.
19. A document explaining what the app is for, how it works, when and by whom it was made, the tools used and the rules given.
20. **MIT licence**, for publishing on GitHub.
21. A distinctive name, researched so that it neither exists nor resembles another: **Pagloom** (*page* + *loom*), with the subtitle **Scanner & PDF Utility**.
22. Documentation in **English**, published on GitHub under the **3devangelist** account.
23. GitHub extras: automatic release builds (GitHub Actions), screenshots, topics, social preview image, issue templates and a changelog.
24. A logo (monogram **P** with a woven thread), in SVG, used as the icon of every build.
25. A **warning when closing** the window with pages not yet exported. TIFF import is dropped.
26. **Phone photos → page**: detect the sheet without downscaling the photo, correct perspective (parallax) and curvature with a **grid of points** (4 × 4 or more, not just 4 corners), set the page to its **true size** (standard formats and **custom sizes**) and open **HEIC photos**.

**General rules**

- All Portuguese text in **European Portuguese (pt-PT)**, never Brazilian Portuguese.
- **Direct answers, no gratuitous praise.**

---

## Feedback

Found a bug or have an idea? Open an [issue](https://github.com/3devangelist/pagloom/issues/new/choose). Version history is in [CHANGELOG.md](CHANGELOG.md).

---

## Licence

Released under the **MIT** licence. See [`LICENSE`](LICENSE).
© 2026 Ricardo Pereira.

Bundled libraries keep their own licences (Apache-2.0, MIT, ISC, BSD-3-Clause, LGPL-3.0). See [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).
