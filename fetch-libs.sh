#!/usr/bin/env bash
# Downloads the JavaScript libraries used by the interface into web/lib/, from the npm registry:
#   pdf.js 4.10.38 (Apache-2.0), pdf-lib 1.17.1 (MIT),
#   OpenCV.js 4.12.0 (@techstark/opencv-js, Apache-2.0) — page detection in phone photos,
#   libheif-js 1.23.2 (LGPL-3.0) — HEIC/HEIF photos,
#   tesseract.js 6.0.1 + tesseract.js-core 6.0.0 (Apache-2.0) and language data PT/EN/IT/ES/FR
#   (@tesseract.js-data/*, tessdata_best int) — OCR.
set -euo pipefail
cd "$(dirname "$0")"
LIB=web/lib
[ -f "$LIB/pdf.min.mjs" ] && [ -f "$LIB/pdf-lib.min.js" ] && [ -d "$LIB/cmaps" ] && [ -f "$LIB/opencv.js" ] && [ -f "$LIB/libheif-bundle.js" ] && [ -f "$LIB/tesseract/por.traineddata.gz" ] && exit 0
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fsSL https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-4.10.38.tgz | tar -xz -C "$TMP"
mv "$TMP/package" "$TMP/pdfjs"
curl -fsSL https://registry.npmjs.org/pdf-lib/-/pdf-lib-1.17.1.tgz | tar -xz -C "$TMP"
mv "$TMP/package" "$TMP/pdflib"
curl -fsSL https://registry.npmjs.org/@techstark/opencv-js/-/opencv-js-4.12.0-release.1.tgz | tar -xz -C "$TMP"
mv "$TMP/package" "$TMP/opencv"
curl -fsSL https://registry.npmjs.org/libheif-js/-/libheif-js-1.23.2.tgz | tar -xz -C "$TMP"
mv "$TMP/package" "$TMP/libheif"
curl -fsSL https://registry.npmjs.org/tesseract.js/-/tesseract.js-6.0.1.tgz | tar -xz -C "$TMP"
mv "$TMP/package" "$TMP/tesseract"
curl -fsSL https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-6.0.0.tgz | tar -xz -C "$TMP"
mv "$TMP/package" "$TMP/tesscore"
for L in por eng ita spa fra; do # dados de OCR: português, inglês, italiano, espanhol, francês
  curl -fsSL "https://registry.npmjs.org/@tesseract.js-data/$L/-/$L-1.0.0.tgz" | tar -xz -C "$TMP"
  mv "$TMP/package" "$TMP/tess-$L"
done
mkdir -p "$LIB"
cp "$TMP/pdfjs/build/pdf.min.mjs" "$TMP/pdfjs/build/pdf.worker.min.mjs" "$LIB/"
cp -r "$TMP/pdfjs/cmaps" "$TMP/pdfjs/standard_fonts" "$LIB/"
cp "$TMP/pdflib/dist/pdf-lib.min.js" "$LIB/"
cp "$TMP/opencv/dist/opencv.js" "$LIB/"
cp "$TMP/libheif/libheif-wasm/libheif-bundle.js" "$LIB/"
mkdir -p "$LIB/tesseract"
cp "$TMP/tesseract/dist/tesseract.min.js" "$TMP/tesseract/dist/worker.min.js" "$LIB/tesseract/"
cp "$TMP/tesscore/tesseract-core-lstm.wasm.js" "$TMP/tesscore/tesseract-core-simd-lstm.wasm.js" "$LIB/tesseract/"
for L in por eng ita spa fra; do cp "$TMP/tess-$L/4.0.0_best_int/$L.traineddata.gz" "$LIB/tesseract/"; done
{
  echo "pdf.js (Apache-2.0) — Mozilla"; cat "$TMP/pdfjs/LICENSE"; echo
  echo "pdf-lib (MIT) — Andrew Dillon"; cat "$TMP/pdflib/LICENSE.md"; echo
  echo "OpenCV.js (Apache-2.0) — OpenCV team, packaged by TechStark"; cat "$TMP/opencv/LICENSE"; echo
  echo "libheif-js (LGPL-3.0) — libheif by struktur AG, packaged by catdad"; cat "$TMP/libheif/libheif-wasm/LICENSE"; echo
  echo "tesseract.js and tesseract.js-core (Apache-2.0) — Tesseract OCR by Google/HP, JS port by naptha"; cat "$TMP/tesscore/LICENSE"; echo
  echo "Language data por/eng/ita/spa/fra (Apache-2.0, tessdata_best int) — @tesseract.js-data (MIT packaging)"
} > "$LIB/LICENSES.txt"
echo "JavaScript libraries ready in $LIB/"
