# Training data for page detection

Data collected to teach Pagloom, later on, to find pages in photos better (corners, spine, curvature).

## Collecting data
Whenever you export pages that went through Photo → page, Pagloom saves a `<name>.treino.zip` next to the PDF.
Copy those zips into `treino/dados/`. That folder is not uploaded to GitHub (it is in `.gitignore`).

Each zip contains:
- `fotos/`: the original photos, as they entered Pagloom (apply any EXIF rotation when opening them);
- `malhas.json`: for each photo, its size, the grid proposed by the program (`proposed`), the final grid of each
  page you corrected (`final`, left to right), the points you placed by hand (`fixed`) and whether you skipped it (`skipped`).
  The points (`nodes`) are the N×N grid row by row, in pixels of the photo.

Variety matters more than quantity: different books and sheets, tables, light, shadows and angles.

## Measuring
```
py treino/avaliar.py
```
Shows how many pages the automatic proposal got right (worst corner as a % of the photo diagonal), how many it
missed, and the worst cases. Uses only the Python standard library. Double-clicking it also works; the window
waits for Enter before closing.

## Plans
1. ~100 photos: tune the thresholds of the current detection against this data (local script, no AI).
2. ~300 photos: train a small model that points out the corners of each page and the spine
   (Python + PyTorch on the GPU), exported to ONNX and used inside Pagloom, offline.
   The rest (grid, warp and crop) stays the same.
