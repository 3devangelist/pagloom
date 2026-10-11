# Third-party licences

Pagloom is released under the MIT licence (see `LICENSE`). It bundles the following libraries, each under its own licence:

| Library | Licence | Location |
|---|---|---|
| [pdf.js](https://github.com/mozilla/pdf.js) (Mozilla), including `cmaps` and `standard_fonts` | Apache-2.0 | `web/lib/` (downloaded by `fetch-libs.sh`, embedded in the binaries) |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | MIT | `web/lib/` (downloaded by `fetch-libs.sh`, embedded in the binaries) |
| [go-ole](https://github.com/go-ole/go-ole) | MIT | Go module `github.com/go-ole/go-ole` |
| [go-webview2](https://github.com/jchv/go-webview2) | MIT | Go module `github.com/jchv/go-webview2` |
| [go-winloader](https://github.com/jchv/go-winloader) | ISC | Go module `github.com/jchv/go-winloader` |
| [golang.org/x/sys](https://pkg.go.dev/golang.org/x/sys) | BSD-3-Clause | Go module `golang.org/x/sys` |

`fetch-libs.sh` writes the full licence texts for pdf.js and pdf-lib to `web/lib/LICENSES.txt`, which is embedded in the binaries. The Go libraries are downloaded at build time (`go mod tidy`) and their licences ship with each module.
