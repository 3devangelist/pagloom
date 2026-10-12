#!/usr/bin/env bash
# Builds Pagloom for Windows and Linux (x86_64 and ARM64) and creates the AppImages.
# Requirements: Go 1.24+, curl. Run on Linux (AppImages can only be built on Linux).
set -euo pipefail
cd "$(dirname "$0")"
OUT=dist
TOOLS=build/tools
mkdir -p "$OUT" "$TOOLS"

# JavaScript libraries (pdf.js, pdf-lib) and Go dependencies, downloaded once
bash fetch-libs.sh
go mod tidy

echo "» Windows (x86_64)"
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-H windowsgui -s -w" -o "$OUT/Pagloom.exe" .

# appimagetool and AppImage runtimes (downloaded once)
if [ ! -x "$TOOLS/appimagetool" ]; then
  curl -fsSL -o "$TOOLS/appimagetool" https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage
  chmod +x "$TOOLS/appimagetool"
fi
for A in x86_64 aarch64; do
  [ -f "$TOOLS/runtime-$A" ] || curl -fsSL -o "$TOOLS/runtime-$A" "https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-$A"
done

for PAIR in amd64:x86_64 arm64:aarch64; do
  GA=${PAIR%%:*}; AA=${PAIR##*:}
  echo "» Linux ($AA)"
  D=build/AppDir-$AA
  rm -rf "$D"
  mkdir -p "$D/usr/bin" "$D/usr/share/applications"
  CGO_ENABLED=0 GOOS=linux GOARCH=$GA go build -trimpath -ldflags "-s -w" -o "$D/usr/bin/pagloom" .
  cat > "$D/pagloom.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Pagloom
GenericName=Scanner & PDF Utility
GenericName[pt]=Digitalizar documentos
Comment=Scan, edit and merge pages and PDFs
Comment[pt]=Digitalizar, editar e juntar páginas e PDFs
Exec=pagloom %F
Icon=pagloom
Categories=Graphics;Scanning;Office;
MimeType=application/pdf;
Terminal=false
StartupWMClass=Pagloom
EOF
  cp "$D/pagloom.desktop" "$D/usr/share/applications/"
  cp pagloom.png "$D/pagloom.png"
  mkdir -p "$D/usr/share/icons/hicolor/scalable/apps"
  cp pagloom.svg "$D/usr/share/icons/hicolor/scalable/apps/pagloom.svg"
  for S in 16 24 32 48 64 128 256 512; do
    mkdir -p "$D/usr/share/icons/hicolor/${S}x${S}/apps"
    cp "icons/pagloom-$S.png" "$D/usr/share/icons/hicolor/${S}x${S}/apps/pagloom.png"
  done
  ln -s pagloom.png "$D/.DirIcon"
  ln -s usr/bin/pagloom "$D/AppRun"
  ARCH=$AA APPIMAGE_EXTRACT_AND_RUN=1 "$TOOLS/appimagetool" --runtime-file "$TOOLS/runtime-$AA" -n "$D" "$OUT/Pagloom-$AA.AppImage" >/dev/null
done

echo "Done. Files in $OUT/:"
ls -la "$OUT"
