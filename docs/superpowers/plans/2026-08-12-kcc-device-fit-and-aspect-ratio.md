# KCC Device Fitting, Aspect Ratio & EPUB Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port KCC's device presets, proportional aspect-ratio scaling (`contain` / upscale), clean XHTML styling, and Kindle OPF metadata into the application to prevent image distortion and squashing on Kindle e-readers.

**Architecture:** Update `constants.js` with verified KCC device resolutions, refactor `image-processor.js` for strict `contain` aspect-ratio scaling and upscaling, upgrade `epub-builder.js` to emit KCC-standard XHTML and OPF metadata, and update `index.html`/`ui-controller.js` with a device profile selector.

**Tech Stack:** Vanilla JavaScript (ES Modules), HTML5 Canvas, JSZip, Python unittest test runner (`agy-node` integration).

## Global Constraints
- Target resolution for Kindle Paperwhite 12: `1272x1696` (aspect ratio 3:4 = 0.7500).
- Target resolution for Kindle Paperwhite 11: `1236x1648` (aspect ratio 3:4 = 0.7500).
- Strict aspect ratio preservation: $\text{ratio} = \min\left(\frac{\text{targetWidth}}{\text{width}}, \frac{\text{targetHeight}}{\text{height}}\right)$.
- XHTML images must use explicit `width` and `height` attributes without `object-fit: cover` or percentage stretching.
- OPF metadata must include Kindle-specific fixed-layout tags (`zero-gutter`, `zero-margin`, `ke-border-color`, `ke-border-width`, `orientation-lock`).
- Backwards compatibility: Passing `isKindleFitEnabled: true` maps directly to the `KINDLE_PW12` profile.

---

### Task 1: Update Device Presets & Helper in `constants.js`

**Files:**
- Modify: `src/js/modules/constants.js:5-10`
- Test: `test/test_epub_builder.py`

**Interfaces:**
- Produces: `DEVICE_PRESETS` object with `ORIGINAL`, `KINDLE_PW12`, `KINDLE_PW11`, `KINDLE_OASIS`, `KINDLE_PW34`, `KINDLE_SCRIBE`, and `getDevicePreset(keyOrId)`.

- [ ] **Step 1: Write failing test in `test/test_epub_builder.py` for device presets**

Add a test case in `test/test_epub_builder.py` verifying device preset dimensions and helper lookup:
```python
    def test_device_presets_constants(self):
        code = self.base_env + r"""
        import { DEVICE_PRESETS, getDevicePreset } from './src/js/modules/constants.js';

        const pw12 = getDevicePreset('kindle_pw12');
        const pw11 = getDevicePreset('kindle_pw11');
        const oasis = getDevicePreset('kindle_oasis');
        const original = getDevicePreset('original');

        console.log(JSON.stringify({
            pw12: { width: pw12.width, height: pw12.height },
            pw11: { width: pw11.width, height: pw11.height },
            oasis: { width: oasis.width, height: oasis.height },
            original: { width: original.width, height: original.height }
        }));
        """
        data = run_js_eval(code)
        self.assertEqual(data['pw12'], {'width': 1272, 'height': 1696})
        self.assertEqual(data['pw11'], {'width': 1236, 'height': 1648})
        self.assertEqual(data['oasis'], {'width': 1264, 'height': 1680})
        self.assertEqual(data['original'], {'width': 0, 'height': 0})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `D:\Programs\Dev\Python\Python312\python.exe -m unittest test.test_epub_builder.TestEpubBuilderIntegration.test_device_presets_constants`
Expected: FAIL (missing `getDevicePreset` or wrong PW12 resolution).

- [ ] **Step 3: Implement device presets and helper in `src/js/modules/constants.js`**

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

export function getDevicePreset(keyOrId) {
    if (!keyOrId) return DEVICE_PRESETS.ORIGINAL;
    if (typeof keyOrId === 'object' && typeof keyOrId.width === 'number' && typeof keyOrId.height === 'number') {
        return keyOrId;
    }
    const normalized = String(keyOrId).toLowerCase().replace(/[-_]/g, '');
    for (const key of Object.keys(DEVICE_PRESETS)) {
        const preset = DEVICE_PRESETS[key];
        const pKeyNorm = key.toLowerCase().replace(/[-_]/g, '');
        const pIdNorm = preset.id.toLowerCase().replace(/[-_]/g, '');
        if (normalized === pKeyNorm || normalized === pIdNorm) {
            return preset;
        }
    }
    return DEVICE_PRESETS.ORIGINAL;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `D:\Programs\Dev\Python\Python312\python.exe -m unittest test.test_epub_builder.TestEpubBuilderIntegration.test_device_presets_constants`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/js/modules/constants.js test/test_epub_builder.py
git commit -m "feat: add KCC device presets and getDevicePreset helper"
```

---

### Task 2: Refactor `processImage` for Proportional Contain & Upscale Scaling

**Files:**
- Modify: `src/js/modules/image-processor.js:67-138`
- Test: `test/test_epub_builder.py`

**Interfaces:**
- Consumes: `getDevicePreset` from `constants.js`
- Produces: `processImage(img, originalBlob, targetDeviceOrOptions, isGrayscale, mimeType, outputFormat, quality, isUpscale)`

- [ ] **Step 1: Write failing test in `test/test_epub_builder.py` for proportional scaling & upscale**

Add test cases in `test/test_epub_builder.py`:
```python
    def test_process_image_proportional_scaling(self):
        code = self.base_env + r"""
        import { processImage } from './src/js/modules/image-processor.js';
        import { DEVICE_PRESETS } from './src/js/modules/constants.js';

        // 1. Downscale test: large image 2000x3000 -> Kindle PW12 (1272x1696)
        // Ratio = min(1272/2000 = 0.636, 1696/3000 = 0.565333) = 0.565333
        // Width = round(2000 * 0.565333) = 1131, Height = round(3000 * 0.565333) = 1696
        const imgLarge = new globalThis.Image();
        imgLarge.width = 2000;
        imgLarge.height = 3000;
        const resLarge = await processImage(imgLarge, null, DEVICE_PRESETS.KINDLE_PW12, false, 'image/jpeg', 'original', 0.85, true);

        // 2. Upscale test: small image 600x900 -> Kindle PW12 (1272x1696)
        // Ratio = min(1272/600 = 2.12, 1696/900 = 1.88444) = 1.88444
        // Width = round(600 * 1.88444) = 1131, Height = round(900 * 1.88444) = 1696
        const imgSmall = new globalThis.Image();
        imgSmall.width = 600;
        imgSmall.height = 900;
        const resSmallUpscale = await processImage(imgSmall, null, DEVICE_PRESETS.KINDLE_PW12, false, 'image/jpeg', 'original', 0.85, true);
        const resSmallNoUpscale = await processImage(imgSmall, null, DEVICE_PRESETS.KINDLE_PW12, false, 'image/jpeg', 'original', 0.85, false);

        console.log(JSON.stringify({
            large: { width: resLarge.width, height: resLarge.height },
            smallUpscale: { width: resSmallUpscale.width, height: resSmallUpscale.height },
            smallNoUpscale: { width: resSmallNoUpscale.width, height: resSmallNoUpscale.height }
        }));
        """
        data = run_js_eval(code)
        self.assertEqual(data['large'], {'width': 1131, 'height': 1696})
        self.assertEqual(data['smallUpscale'], {'width': 1131, 'height': 1696})
        self.assertEqual(data['smallNoUpscale'], {'width': 600, 'height': 900})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `D:\Programs\Dev\Python\Python312\python.exe -m unittest test.test_epub_builder.TestEpubBuilderIntegration.test_process_image_proportional_scaling`
Expected: FAIL.

- [ ] **Step 3: Update `processImage` in `src/js/modules/image-processor.js`**

```javascript
import { DEVICE_PRESETS, getDevicePreset, DEFAULT_JPEG_QUALITY, READING_DIRECTIONS, OUTPUT_FORMATS } from './constants.js';

export async function processImage(
    img,
    originalBlob,
    targetDeviceOrFit,
    isGrayscale,
    mimeType,
    outputFormat = OUTPUT_FORMATS.ORIGINAL,
    quality = DEFAULT_JPEG_QUALITY,
    isUpscale = true
) {
    let width = img.width;
    let height = img.height;
    let needsProcessing = false;

    let targetWidth = 0;
    let targetHeight = 0;

    if (targetDeviceOrFit) {
        if (typeof targetDeviceOrFit === 'boolean') {
            targetWidth = DEVICE_PRESETS.KINDLE_PW12.width;
            targetHeight = DEVICE_PRESETS.KINDLE_PW12.height;
        } else if (typeof targetDeviceOrFit === 'string') {
            const preset = getDevicePreset(targetDeviceOrFit);
            targetWidth = preset.width;
            targetHeight = preset.height;
        } else if (typeof targetDeviceOrFit === 'object') {
            targetWidth = targetDeviceOrFit.width || 0;
            targetHeight = targetDeviceOrFit.height || 0;
        }
    }

    if (targetWidth > 0 && targetHeight > 0) {
        const isLarger = width > targetWidth || height > targetHeight;
        const isSmaller = width < targetWidth && height < targetHeight;

        if (isLarger || (isUpscale && isSmaller)) {
            const ratio = Math.min(targetWidth / width, targetHeight / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
            needsProcessing = true;
        }
    }

    if (isGrayscale) {
        needsProcessing = true;
    }

    if (outputFormat === OUTPUT_FORMATS.JPEG) {
        needsProcessing = true;
        mimeType = 'image/jpeg';
    }

    if (!needsProcessing) {
        if (originalBlob) {
            return { blob: originalBlob, width: img.width, height: img.height };
        }
        return { blob: await imageToBlob(img, mimeType, quality), width: img.width, height: img.height };
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx.imageSmoothingEnabled !== undefined) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
    }

    ctx.drawImage(img, 0, 0, width, height);

    if (isGrayscale) {
        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
            const avg = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            data[i] = avg;
            data[i + 1] = avg;
            data[i + 2] = avg;
        }
        ctx.putImageData(imgData, 0, 0);
    }

    return { blob: await imageToBlob(canvas, mimeType, quality), width, height };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `D:\Programs\Dev\Python\Python312\python.exe -m unittest test.test_epub_builder.TestEpubBuilderIntegration.test_process_image_proportional_scaling`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/js/modules/image-processor.js test/test_epub_builder.py
git commit -m "feat: implement proportional contain and upscale image resizing"
```

---

### Task 3: Upgrade `epub-builder.js` for KCC XHTML and OPF Metadata

**Files:**
- Modify: `src/js/modules/epub-builder.js`
- Test: `test/test_epub_builder.py`

**Interfaces:**
- Consumes: `getDevicePreset` from `constants.js`, `processImage` from `image-processor.js`
- Produces: `createEpub({ ..., targetDevice, isUpscaleEnabled, isKindleFitEnabled })`

- [ ] **Step 1: Write failing test in `test/test_epub_builder.py` for XHTML structure and OPF Kindle metadata**

Add test cases in `test/test_epub_builder.py`:
```python
    def test_epub_builder_kcc_xhtml_and_opf(self):
        code = self.base_env + r"""
        import { createEpub } from './src/js/modules/epub-builder.js';
        import { DEVICE_PRESETS } from './src/js/modules/constants.js';

        const mockImages = [
            { name: '001.jpg', async: async () => new globalThis.Blob([], { width: 1200, height: 1600 }) },
            { name: '002.jpg', async: async () => new globalThis.Blob([], { width: 1200, height: 1600 }) }
        ];

        let files = {};
        const mockZip = {
            file: (name, content) => { files[name] = content; },
            folder: (fName) => ({
                file: (name, content) => { files[fName + '/' + name] = content; },
                folder: (subName) => ({
                    file: (name, content) => { files[fName + '/' + subName + '/' + name] = content; }
                })
            }),
            generateAsync: async () => new globalThis.Blob(['epub'])
        };

        await createEpub({
            images: mockImages,
            title: 'Test Book',
            author: 'Test Author',
            targetDevice: DEVICE_PRESETS.KINDLE_PW12,
            isUpscaleEnabled: true,
            jszipLib: function() { return mockZip; }
        });

        const page0 = files['OEBPS/Text/page_0000.xhtml'];
        const opf = files['OEBPS/content.opf'];

        console.log(JSON.stringify({
            hasObjectFit: page0.includes('object-fit'),
            hasExplicitDimensions: page0.includes('width="') && page0.includes('height="'),
            hasCenterDiv: page0.includes('text-align:center') || page0.includes('class="page-container"'),
            originalResolution: opf.match(/name="original-resolution" content="([^"]+)"/)?.[1],
            hasZeroGutter: opf.includes('name="zero-gutter" content="true"'),
            hasZeroMargin: opf.includes('name="zero-margin" content="true"'),
            hasBorderColor: opf.includes('name="ke-border-color" content="#FFFFFF"'),
            hasOrientationLock: opf.includes('name="orientation-lock" content="none"')
        }));
        """
        data = run_js_eval(code)
        self.assertFalse(data['hasObjectFit'])
        self.assertTrue(data['hasExplicitDimensions'])
        self.assertTrue(data['hasCenterDiv'])
        self.assertEqual(data['originalResolution'], '1272x1696')
        self.assertTrue(data['hasZeroGutter'])
        self.assertTrue(data['hasZeroMargin'])
        self.assertTrue(data['hasBorderColor'])
        self.assertTrue(data['hasOrientationLock'])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `D:\Programs\Dev\Python\Python312\python.exe -m unittest test.test_epub_builder.TestEpubBuilderIntegration.test_epub_builder_kcc_xhtml_and_opf`
Expected: FAIL.

- [ ] **Step 3: Update `src/js/modules/epub-builder.js`**

Implement the updated XHTML template and OPF metadata:
- Determine device preset from `targetDevice` or `isKindleFitEnabled`.
- Format XHTML pages:
```html
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
```
- Format `content.opf`:
```xml
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta property="rendition:spread">${isLandscapeSpread ? 'landscape' : 'auto'}</meta>
    <meta name="book-type" content="comic"/>
    <meta name="fixed-layout" content="true"/>
    <meta name="zero-gutter" content="true"/>
    <meta name="zero-margin" content="true"/>
    <meta name="ke-border-color" content="#FFFFFF"/>
    <meta name="ke-border-width" content="0"/>
    <meta name="orientation-lock" content="none"/>
    <meta name="primary-writing-mode" content="${primaryWritingMode}"/>
    <meta name="original-resolution" content="${opfResolution}"/>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `D:\Programs\Dev\Python\Python312\python.exe -m unittest test.test_epub_builder.TestEpubBuilderIntegration.test_epub_builder_kcc_xhtml_and_opf`
Expected: PASS.

- [ ] **Step 5: Run existing test suite to ensure regression-free behavior**

Run: `D:\Programs\Dev\Python\Python312\python.exe -m unittest discover test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/js/modules/epub-builder.js test/test_epub_builder.py
git commit -m "feat: format EPUB XHTML and OPF metadata per KCC standards"
```

---

### Task 4: Update UI and UI Controller

**Files:**
- Modify: `index.html:85-89`
- Modify: `src/js/ui/ui-controller.js`

**Interfaces:**
- Consumes: `DEVICE_PRESETS` from `constants.js`
- Connects: `#device-select` and `#upscale-checkbox` to `createEpub` parameters.

- [ ] **Step 1: Update `index.html` with Device Profile select and Upscale checkbox**

Replace lines 85-88 in `index.html`:
```html
            <div class="select-group" id="device-group">
                <label for="device-select">Target Device Profile:</label>
                <select id="device-select">
                    <option value="original">Original (No resize)</option>
                    <option value="kindle_pw12" selected>Kindle Paperwhite 12 (7" - 1272x1696)</option>
                    <option value="kindle_pw11">Kindle Paperwhite 11 (6.8" - 1236x1648)</option>
                    <option value="kindle_oasis">Kindle Oasis 2/3 (7" - 1264x1680)</option>
                    <option value="kindle_pw34">Kindle Paperwhite 3/4 / Voyage / Basic (1072x1448)</option>
                    <option value="kindle_scribe">Kindle Scribe (10.2" - 1860x2480)</option>
                </select>
            </div>
            <label class="checkbox-label" id="upscale-group">
                <input type="checkbox" id="upscale-checkbox" checked>
                Upscale small images to device resolution
            </label>
```

- [ ] **Step 2: Update `src/js/ui/ui-controller.js` to handle device select & upscale**

- Reference `this.deviceSelect = document.getElementById('device-select')` and `this.upscaleCheckbox = document.getElementById('upscale-checkbox')`.
- In `handleConvert`:
  ```javascript
  const selectedDeviceId = this.deviceSelect ? this.deviceSelect.value : 'original';
  const targetDevice = getDevicePreset(selectedDeviceId);
  const isUpscaleEnabled = this.upscaleCheckbox ? this.upscaleCheckbox.checked : true;
  ```
- Pass `targetDevice` and `isUpscaleEnabled` to `createEpub`.

- [ ] **Step 3: Test UI controller interactions with integration tests**

Update `test/test_epub_builder.py` and `test/image-processor.test.js` as needed to ensure full test suite passes.

- [ ] **Step 4: Run full test suite**

Run: `D:\Programs\Dev\Python\Python312\python.exe -m unittest discover test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html src/js/ui/ui-controller.js
git commit -m "feat: add device profile selector and upscale toggle to UI"
```

---

### Task 5: Full Verification & Walkthrough

**Files:**
- Create: `docs/superpowers/walkthrough.md` or conversation walkthrough artifact

- [ ] **Step 1: Run comprehensive automated test suite**

Run: `D:\Programs\Dev\Python\Python312\python.exe -m unittest discover test`
Expected: All tests PASS.

- [ ] **Step 2: Verify git status is clean**

Run: `git status`
Expected: Working tree clean.

- [ ] **Step 3: Commit any remaining test additions**

```bash
git add .
git commit -m "test: add comprehensive unit and integration tests for KCC fitting"
```
