# Design Document: KCC Device Fitting, Aspect Ratio & EPUB Rendering

## 1. Overview
The purpose of this update is to align the application's image fitting and EPUB rendering pipeline with [Kindle Comic Converter (KCC)](https://github.com/ciromattia/kcc), eliminating image squashing/stretching issues on Kindle devices (particularly Kindle Paperwhite 11 & 12).

## 2. Root Cause Analysis of Image Squashing

1. **Inaccurate Preset Resolution**:
   - `KINDLE_PW12` was configured as `1264 × 1680` (Kindle Oasis resolution, aspect ratio ~0.7524).
   - Kindle Paperwhite 12 (PW 6, 2024, 7.0") has an exact resolution of **`1272 × 1696`** (aspect ratio 3:4 = 0.7500).
   - Kindle Paperwhite 11 (PW 5, 2021, 6.8") has an exact resolution of **`1236 × 1648`** (aspect ratio 3:4 = 0.7500).

2. **Deforming CSS Styles (`object-fit: cover` & `100%` stretching)**:
   - Pages were styled with `body { width: ${width}px; height: ${height}px; }` and `img { width: 100%; height: 100%; object-fit: cover; }`.
   - On Amazon Kindle e-readers and the Send to Kindle conversion pipeline, `object-fit: cover` is not properly supported in fixed-layout mode, forcing images to stretch to the 100% container box.

3. **OPF `original-resolution` Coordinate Space**:
   - `original-resolution` was set to `maxWidth x maxHeight` across all pages (including wide 2-page landscape spreads, e.g. `2400x1680`).
   - Kindle fixed-layout engine uses `original-resolution` as the root coordinate canvas, scaling portrait pages inside a wide canvas, which leads to distortion and pillarboxing/squashing.
   - In KCC, `original-resolution` is locked to the target device screen resolution.

4. **Asymmetrical Downscaling without Upscale**:
   - Only images larger than the target device were downscaled; smaller images remained untouched, causing mixed coordinate spaces across the book.

---

## 3. Architecture & Proposed Changes

### 3.1. Device Presets (`src/js/modules/constants.js`)
Define standard KCC device profiles:
```javascript
export const DEVICE_PRESETS = {
    ORIGINAL: {
        id: 'original',
        name: 'Original (No resize)',
        width: 0,
        height: 0
    },
    KINDLE_PW12: {
        id: 'kindle_pw12',
        name: 'Kindle Paperwhite 12 (7" - 1272x1696)',
        width: 1272,
        height: 1696
    },
    KINDLE_PW11: {
        id: 'kindle_pw11',
        name: 'Kindle Paperwhite 11 (6.8" - 1236x1648)',
        width: 1236,
        height: 1648
    },
    KINDLE_OASIS: {
        id: 'kindle_oasis',
        name: 'Kindle Oasis 2/3 (7" - 1264x1680)',
        width: 1264,
        height: 1680
    },
    KINDLE_PW34: {
        id: 'kindle_pw34',
        name: 'Kindle Paperwhite 3/4 / Voyage / Basic (6" - 1072x1448)',
        width: 1072,
        height: 1448
    },
    KINDLE_SCRIBE: {
        id: 'kindle_scribe',
        name: 'Kindle Scribe (10.2" - 1860x2480)',
        width: 1860,
        height: 2480
    }
};
```

### 3.2. Proportional Image Resizing (`src/js/modules/image-processor.js`)
Update `processImage` to support:
- `targetDevice` preset or `{ width, height }`.
- `isUpscaleEnabled` (boolean, defaults to `true` when a target device is selected).
- Proportional scaling ratio:
  $$\text{ratio} = \min\left(\frac{\text{targetWidth}}{\text{width}}, \frac{\text{targetHeight}}{\text{height}}\right)$$
- If downscaling (`width > targetWidth || height > targetHeight`) or upscaling (`isUpscaleEnabled && (width < targetWidth && height < targetHeight)`):
  $$\text{newWidth} = \text{Math.round}(\text{width} \times \text{ratio})$$
  $$\text{newHeight} = \text{Math.round}(\text{height} \times \text{ratio})$$
- Render on Canvas with high-quality smoothing:
  ```javascript
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ```
- Guaranteed aspect ratio preservation: $\frac{\text{newWidth}}{\text{newHeight}} \approx \frac{\text{width}}{\text{height}}$.

### 3.3. XHTML & CSS Formatting (`src/js/modules/epub-builder.js`)
Format page XHTML following KCC's clean specification:
```html
<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Page ${globalImageCounter}</title>
  <meta name="viewport" content="width=${procImg.width}, height=${procImg.height}"/>
  <style type="text/css">
    body { margin: 0; padding: 0; background-color: #FFFFFF; }
    div.page-container { text-align: center; margin: 0; padding: 0; }
    img { margin: 0; padding: 0; }
  </style>
</head>
<body>
  <div class="page-container">
    <img width="${procImg.width}" height="${procImg.height}" src="../Images/${imgName}" alt="Page ${globalImageCounter}" />
  </div>
</body>
</html>
```

### 3.4. OPF Metadata Specification (`src/js/modules/epub-builder.js`)
- `original-resolution`:
  - If a device preset is selected: `<meta name="original-resolution" content="${targetWidth}x${targetHeight}"/>`
  - If `ORIGINAL` is selected: `<meta name="original-resolution" content="${dominantWidth}x${dominantHeight}"/>` (dominant single-page dimensions, avoiding wide spread skewing).
- Kindle fixed-layout metadata tags:
  ```xml
  <meta name="zero-gutter" content="true"/>
  <meta name="zero-margin" content="true"/>
  <meta name="ke-border-color" content="#FFFFFF"/>
  <meta name="ke-border-width" content="0"/>
  <meta name="orientation-lock" content="none"/>
  ```

### 3.5. UI & UI Controller (`index.html` & `src/js/ui/ui-controller.js`)
- Replace the legacy checkbox with:
  1. `<select id="device-select">`: Dropdown with options for `Kindle Paperwhite 12 (1272x1696)`, `Kindle Paperwhite 11 (1236x1648)`, `Kindle Oasis`, `Kindle Paperwhite 3/4`, `Kindle Scribe`, `Original (No resize)`.
  2. `<input type="checkbox" id="upscale-checkbox" checked>`: "Upscale smaller images to device resolution".
- Maintain backwards compatibility for options:
  - If `isKindleFitEnabled === true` is passed, it maps to `DEVICE_PRESETS.KINDLE_PW12`.

---

## 4. Verification Plan

1. **Unit & Integration Tests (`test/image-processor.test.js`, `test/epub-builder.test.js`, `test/test_epub_builder.py`)**:
   - Verify `KINDLE_PW12` resolution is `1272x1696`.
   - Verify `KINDLE_PW11` resolution is `1236x1648`.
   - Verify `processImage` maintains exact aspect ratio for both tall and wide inputs during downscale and upscale.
   - Verify generated XHTML has no `object-fit: cover` and contains explicit `width` and `height` attributes on `<img>`.
   - Verify `content.opf` contains device `original-resolution` and Amazon Kindle fixed-layout meta tags (`zero-gutter`, `zero-margin`, `ke-border-color`, `ke-border-width`, `orientation-lock`).
2. **Automated Test Run**:
   - Run Python integration test runner `D:\Programs\Dev\Python\Python312\python.exe -m unittest discover test`.
