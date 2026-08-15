# KCC-aligned EPUB Container, Margin Cropping & Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align EPUB packaging, metadata, navigation, CSS, and margin trimming with Kindle Comic Converter (KCC) to eliminate excessive two-page spread margins and drastically speed up Kindle conversion.

**Architecture:** 
1. `epub-builder.js`: Generate EPUB 2 `toc.ncx` and EPUB 3 `nav.xhtml`, link unified `style.css`, insert Kindle viewport/positioning fixes, complete OPF metadata (fixed-layout, zero-gutter, zero-margin, rendition:spread), and package with JSZip `STORE` (uncompressed) with uncompressed `mimetype` first.
2. `image-processor.js`: Implement `detectAndCropMargins` bounding box scanner (auto-cropping scan whitespace borders up to 10%) and near-aspect-ratio `fit` scaling (`AUTO_CROP_THRESHOLD = 0.02`).
3. `constants.js`, `index.html`, `ui-controller.js`: Add UI control for Auto-crop margins (enabled by default).

**Tech Stack:** Vanilla JavaScript (ES modules), HTML5 Canvas, JSZip, Python unittest test runner via Node.js wrapper.

## Global Constraints

- Preserve pure clientside in-browser execution with zero external runtime dependencies.
- Ensure 100% EPUB 3 & EPUB 2 specification compliance and Kindle KF8 / KFX parser compatibility.
- Store `mimetype` uncompressed as the first entry in EPUB ZIP.
- Keep all unit tests passing (`D:\Programs\Dev\Python\Python312\python.exe -m unittest discover -s test`).

---

### Task 1: EPUB Container, Navigation Documents & KCC-Aligned Packaging

**Files:**
- Modify: `src/js/modules/epub-builder.js`
- Test: `test/test_epub_builder.py`

**Interfaces:**
- Produces: `createEpub` generating valid EPUB containing `toc.ncx`, `nav.xhtml`, `Text/style.css`, full OPF metadata, clean XHTML templates with Kindle fixes, and STORED zip compression.

- [x] **Step 1: Write/update tests in `test/test_epub_builder.py` for `toc.ncx`, `nav.xhtml`, `style.css`, metadata & STORE compression**
- [x] **Step 2: Run test to verify it fails**
- [x] **Step 3: Implement `buildNcx`, `buildNav`, `style.css`, OPF metadata updates, and `STORE` compression in `src/js/modules/epub-builder.js`**
- [x] **Step 4: Run test to verify it passes**
- [x] **Step 5: Commit changes**

---

### Task 2: Margin Cropping & Aspect-Ratio Fit Algorithm

**Files:**
- Modify: `src/js/modules/constants.js`
- Modify: `src/js/modules/image-processor.js`
- Test: `test/test_image_processor.py`

**Interfaces:**
- Produces: `detectAndCropMargins(canvas, options)` and `AUTO_CROP_THRESHOLD` logic integrated into `processImage` and `processSpreadImage`.

- [ ] **Step 1: Write/update unit tests in `test/test_image_processor.py` for margin crop and near-ratio fit**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `detectAndCropMargins` and `AUTO_CROP_THRESHOLD` in `src/js/modules/image-processor.js`**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit changes**

---

### Task 3: UI Integration for Auto-Crop Margins

**Files:**
- Modify: `index.html`
- Modify: `src/js/ui/ui-controller.js`
- Test: `test/test_epub_builder.py` / browser UI checks

**Interfaces:**
- Produces: Checkbox `#crop-margins-checkbox` in `index.html` wired to `isCropMarginsEnabled` option in `ui-controller.js` and `createEpub`.

- [ ] **Step 1: Add checkbox to `index.html`**
- [ ] **Step 2: Update `ui-controller.js` to read `#crop-margins-checkbox` and pass `isCropMarginsEnabled`**
- [ ] **Step 3: Verify with unit tests**
- [ ] **Step 4: Commit changes**

---

### Task 4: Full Suite Integration & Regression Testing

**Files:**
- Test: `test/test_epub_builder.py`, `test/test_image_processor.py`, `test/test_spread_calculator.py`, `test/test_png_encoder.py`

- [ ] **Step 1: Run complete test suite: `D:\Programs\Dev\Python\Python312\python.exe -m unittest discover -s test`**
- [ ] **Step 2: Verify all tests pass with 0 failures**
- [ ] **Step 3: Commit any final test adjustments**
