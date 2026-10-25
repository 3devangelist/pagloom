# Third-party licences

Pagloom is released under the MIT licence (see `LICENSE`). It bundles the following libraries, each under its own licence:

| Library | Licence | Location |
|---|---|---|
| [pdf.js](https://github.com/mozilla/pdf.js) (Mozilla), including `cmaps` and `standard_fonts` | Apache-2.0 | `web/lib/` (downloaded by `fetch-libs.sh`, embedded in the binaries) |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | MIT | `web/lib/` (downloaded by `fetch-libs.sh`, embedded in the binaries) |
| [OpenCV.js](https://github.com/opencv/opencv) 4.12.0, npm build [@techstark/opencv-js](https://github.com/TechStark/opencv-js) | Apache-2.0 | `web/lib/opencv.js` (downloaded by `fetch-libs.sh`, embedded in the binaries) |
| [libheif](https://github.com/strukturag/libheif) (struktur AG), npm build [libheif-js](https://github.com/catdad-experiments/libheif-js) 1.23.2 | LGPL-3.0 | `web/lib/libheif-bundle.js` (downloaded by `fetch-libs.sh`, embedded in the binaries) |
| [go-ole](https://github.com/go-ole/go-ole) | MIT | Go module `github.com/go-ole/go-ole` |
| [go-webview2](https://github.com/jchv/go-webview2) | MIT | Go module `github.com/jchv/go-webview2` |
| [go-winloader](https://github.com/jchv/go-winloader) | ISC | Go module `github.com/jchv/go-winloader` |
| [golang.org/x/sys](https://pkg.go.dev/golang.org/x/sys) | BSD-3-Clause | Go module `golang.org/x/sys` |

`fetch-libs.sh` writes the full licence texts for pdf.js, pdf-lib, OpenCV.js and libheif to `web/lib/LICENSES.txt`, which is embedded in the binaries.

libheif is LGPL-3.0. Pagloom loads it as a separate, unmodified file (`libheif-bundle.js`), so it can be replaced by another build of the same library: put the replacement in `web/lib/` and rebuild, or use the source at the links above. The Go libraries are downloaded at build time (`go mod tidy`) and their licences ship with each module.
