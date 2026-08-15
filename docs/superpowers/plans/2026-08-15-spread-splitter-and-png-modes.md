# Spread Splitter & Indexed PNG Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port KCC's spread splitter logic (Split, Rotate only, Both with configurable rotation and placement) and add 4-bit (16 gray levels E-Ink) & 8-bit PNG encoding to the CBZ-to-EPUB Converter.

**Architecture:** 
1. `src/js/modules/constants.js` provides constants for `SPREAD_MODES`, `SPREAD_POSITIONS`, `ROTATION_DIRECTIONS`, and `OUTPUT_FORMATS`.
2. `src/js/modules/png-encoder.js` provides a standalone pure-JS PNG encoder for 4-bit indexed (16-level grayscale E-Ink palette) and 8-bit grayscale PNG formats.
3. `src/js/modules/image-processor.js` handles aspect-ratio checking ($> 1.16$), canvas image rotation (CCW/CW), splitting halves by reading direction, and formatting.
4. `src/js/modules/epub-builder.js` orchestrates spread handling, page type assignment (`S1`, `S2`, `R`, `N`), and spine spread property calculation.
5. `src/js/ui/ui-controller.js` and `index.html` expose dynamic UI controls for spread modes and output formats.

**Tech Stack:** Vanilla JavaScript (ES Modules), HTML5 Canvas, JSZip / CompressionStream (DEFLATE), Python unittest test harness for Node.js modules.

## Global Constraints
- Target workspace: `d:\Workspace\Programing\html\Converter`
- Test runner: `D:\Programs\Dev\Python\Python312\python.exe -m unittest discover -s test`
- No external runtime dependencies in frontend modules (pure JS + JSZip).
- 4-bit PNG palette must match KCC `Palette16`: 16 uniform shades `[0x00, 0x11, 0x22, ..., 0xFF]`.

---

### Task 1: Update Constants and Formats

**Files:**
- Modify: `src/js/modules/constants.js`
- Test: `test/test_epub_builder.py`

**Interfaces:**
- Produces:
  - `SPREAD_MODES = { OFF: 'off', SPLIT: 'split', ROTATE: 'rotate', BOTH: 'both' }`
  - `SPREAD_POSITIONS = { AFTER: 'after', BEFORE: 'before' }`
  - `ROTATION_DIRECTIONS = { CCW: 'ccw', CW: 'cw' }`
  - `OUTPUT_FORMATS = { ORIGINAL: 'original', JPEG: 'jpeg', PNG: 'png', PNG_8BIT: 'png_8bit', PNG_4BIT: 'png_4bit' }`

- [ ] **Step 1: Write the test verifying new constants in test_epub_builder.py**
```python
def test_constants_exports(self):
    code = self.base_env + r"""
    import { SPREAD_MODES, SPREAD_POSITIONS, ROTATION_DIRECTIONS, OUTPUT_FORMATS } from './src/js/modules/constants.js';
    console.log(JSON.stringify({ SPREAD_MODES, SPREAD_POSITIONS, ROTATION_DIRECTIONS, OUTPUT_FORMATS }));
    """
    res = run_js_eval(code)
    self.assertEqual(res['SPREAD_MODES']['SPLIT'], 'split')
    self.assertEqual(res['OUTPUT_FORMATS']['PNG_4BIT'], 'png_4bit')
```

- [ ] **Step 2: Run test to verify it fails**
Run: `D:\Programs\Dev\Python\Python312\python.exe -m unittest test.test_epub_builder.TestEpubBuilderIntegration.test_constants_exports`
Expected: FAIL

- [ ] **Step 3: Update `src/js/modules/constants.js`**
Add `SPREAD_MODES`, `SPREAD_POSITIONS`, `ROTATION_DIRECTIONS`, and update `OUTPUT_FORMATS`.

- [ ] **Step 4: Run test to verify it passes**
Run: `D:\Programs\Dev\Python\Python312\python.exe -m unittest test.test_epub_builder.TestEpubBuilderIntegration.test_constants_exports`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/js/modules/constants.js test/test_epub_builder.py
git commit -m "feat: add spread modes and PNG format constants"
```

---

### Task 2: Implement Indexed PNG Encoder (`png-encoder.js`)

**Files:**
- Create: `src/js/modules/png-encoder.js`
- Test: `test/test_png_encoder.py`

**Interfaces:**
- Produces:
  - `encode4BitPng(imageData: ImageData | { width, height, data }): Promise<Uint8Array | Blob>`
  - `encode8BitPng(imageData: ImageData | { width, height, data }): Promise<Uint8Array | Blob>`
  - `PALETTE_16: number[][]`

- [ ] **Step 1: Write tests for PNG 4-bit and 8-bit binary encoders in `test/test_png_encoder.py`**
Verify PNG magic header `[137, 80, 78, 71, 13, 10, 26, 10]`, `IHDR` width/height/bit-depth/color-type, `PLTE` chunk for 4-bit, and decodability.

- [ ] **Step 2: Run test to verify it fails**
Run: `D:\Programs\Dev\Python\Python312\python.exe -m unittest test.test_png_encoder`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `src/js/modules/png-encoder.js`**
Implement CRC32, Adler32, Deflate (using JSZip/pako if available, or CompressionStream, or uncompressed RFC1951 blocks as fallback), 16-level grayscale quantizer, 4-bit pixel packing (2 px/byte), 8-bit grayscale mapping (1 px/byte), and chunk builders (`IHDR`, `PLTE`, `IDAT`, `IEND`).

- [ ] **Step 4: Run test to verify it passes**
Run: `D:\Programs\Dev\Python\Python312\python.exe -m unittest test.test_png_encoder`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/js/modules/png-encoder.js test/test_png_encoder.py
git commit -m "feat: add 4-bit E-Ink and 8-bit grayscale PNG encoder"
```

---

### Task 3: Enhance Image Processor for Spread Splitting & Rotation

**Files:**
- Modify: `src/js/modules/image-processor.js`
- Test: `test/test_image_processor.py` (or update integration tests)

**Interfaces:**
- Consumes: `SPREAD_MODES`, `SPREAD_POSITIONS`, `ROTATION_DIRECTIONS`, `OUTPUT_FORMATS` from `constants.js`, and `encode4BitPng`, `encode8BitPng` from `png-encoder.js`.
- Produces:
  - `isSpread(width, height): boolean` (checks `width > height && (width / height) > 1.16`)
  - `rotateImage(canvasOrImg, direction = 'ccw'): HTMLCanvasElement`
  - `processSpreadImage(img, options): Promise<Array<{ blob, ext, mimeType, suffix, width, height, type }>>`
  - `processImage(img, originalBlob, targetDevice, isGrayscale, mimeType, outputFormat, quality, isUpscale): Promise<{ blob, width, height, ext, mimeType }>`

- [ ] **Step 1: Write tests for spread splitting and rotation in `test/test_image_processor.py`**
Test:
- `isSpread` returns true for aspect ratio $> 1.16$, false for portrait or square.
- `processSpreadImage` with `SPLIT` produces 2 halves (`S1`, `S2`), ordered correctly for LTR and RTL.
- `processSpreadImage` with `ROTATE` produces rotated spread `R` (or unrotated if `noRotate: true`).
- `processSpreadImage` with `BOTH` produces `[R, S1, S2]` when `spreadPosition: 'before'`, and `[S1, S2, R]` when `spreadPosition: 'after'`.

- [ ] **Step 2: Run test to verify it fails**
Run: `D:\Programs\Dev\Python\Python312\python.exe -m unittest test.test_image_processor`
Expected: FAIL

- [ ] **Step 3: Implement changes in `src/js/modules/image-processor.js`**
Update `isSpread`, add `rotateImage`, add `processSpreadImage`, integrate 4-bit and 8-bit PNG formats into `processImage`.

- [ ] **Step 4: Run test to verify it passes**
Run: `D:\Programs\Dev\Python\Python312\python.exe -m unittest test.test_image_processor`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/js/modules/image-processor.js test/test_image_processor.py
git commit -m "feat: implement KCC spread splitter and rotation in image processor"
```

---

### Task 4: Integrate Spread Splitter with EPUB Builder

**Files:**
- Modify: `src/js/modules/epub-builder.js`
- Test: `test/test_epub_builder.py`

**Interfaces:**
- Consumes: `processSpreadImage`, `processImage`, `SPREAD_MODES`, `calculatePageSpreads`.
- Produces: `createEpub({ images, spreadMode, spreadNoRotate, spreadRotateRight, spreadPosition, outputFormat, ... })`

- [ ] **Step 1: Add integration tests for all spread modes in `test/test_epub_builder.py`**
Test:
- `spreadMode: 'split'` generates 2 spine items (`_s1`, `_s2`) per spread.
- `spreadMode: 'rotate'` generates 1 spine item (`_spread`) with `page-spread-center`.
- `spreadMode: 'both'` with `spreadPosition: 'before'` generates spread first, then split halves.
- `spreadMode: 'both'` with `spreadPosition: 'after'` generates split halves first, then spread.
- `outputFormat: 'png_4bit'` generates valid `.png` files with `image/png` media-type in manifest.

- [ ] **Step 2: Run test to verify it fails**
Run: `D:\Programs\Dev\Python\Python312\python.exe -m unittest test.test_epub_builder`
Expected: FAIL

- [ ] **Step 3: Update `src/js/modules/epub-builder.js`**
Integrate `processSpreadImage`, wire options (`spreadMode`, `spreadNoRotate`, `spreadRotateRight`, `spreadPosition`), handle PNG formats, and update manifest/spine generation.

- [ ] **Step 4: Run full test suite to verify it passes**
Run: `D:\Programs\Dev\Python\Python312\python.exe -m unittest discover -s test`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/js/modules/epub-builder.js test/test_epub_builder.py
git commit -m "feat: integrate spread modes and indexed PNG formats into EPUB builder"
```

---

### Task 5: UI Controls & Dynamic Visibility

**Files:**
- Modify: `index.html`
- Modify: `src/css/styles.css`
- Modify: `src/js/ui/ui-controller.js`

**Interfaces:**
- DOM elements:
  - `#spread-mode-select`
  - `#spread-options-group`
  - `#spread-no-rotate-checkbox`
  - `#spread-rotate-right-checkbox`
  - `#spread-position-group` & `#spread-position-select`
  - `#format-select` (options: `original`, `jpeg`, `png`, `png_8bit`, `png_4bit`)

- [ ] **Step 1: Update `index.html` with new spread options group and format select options**
- [ ] **Step 2: Update `src/css/styles.css` for clean styling and sub-option indentation**
- [ ] **Step 3: Update `src/js/ui/ui-controller.js`**
Handle event listeners for `#spread-mode-select` and `#spread-no-rotate-checkbox` to show/hide relevant sub-controls dynamically; pass all values to `createEpub`.
- [ ] **Step 4: Run full test suite to verify no regressions**
Run: `D:\Programs\Dev\Python\Python312\python.exe -m unittest discover -s test`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add index.html src/css/styles.css src/js/ui/ui-controller.js
git commit -m "feat: add spread splitter and indexed PNG controls in UI"
```
