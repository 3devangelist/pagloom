#!/usr/bin/env bash
# Downloads the JavaScript libraries used by the interface into web/lib/:
#   pdf.js 4.10.38 (Apache-2.0) and pdf-lib 1.17.1 (MIT), from the npm registry.
set -euo pipefail
cd "$(dirname "$0")"
LIB=web/lib
[ -f "$LIB/pdf.min.mjs" ] && [ -f "$LIB/pdf-lib.min.js" ] && [ -d "$LIB/cmaps" ] && exit 0
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fsSL https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-4.10.38.tgz | tar -xz -C "$TMP"
mv "$TMP/package" "$TMP/pdfjs"
curl -fsSL https://registry.npmjs.org/pdf-lib/-/pdf-lib-1.17.1.tgz | tar -xz -C "$TMP"
mv "$TMP/package" "$TMP/pdflib"
mkdir -p "$LIB"
cp "$TMP/pdfjs/build/pdf.min.mjs" "$TMP/pdfjs/build/pdf.worker.min.mjs" "$LIB/"
cp -r "$TMP/pdfjs/cmaps" "$TMP/pdfjs/standard_fonts" "$LIB/"
cp "$TMP/pdflib/dist/pdf-lib.min.js" "$LIB/"
{ echo "pdf.js (Apache-2.0) — Mozilla"; cat "$TMP/pdfjs/LICENSE"; echo; echo "pdf-lib (MIT) — Andrew Dillon"; cat "$TMP/pdflib/LICENSE.md"; } > "$LIB/LICENSES.txt"
echo "JavaScript libraries ready in $LIB/"
