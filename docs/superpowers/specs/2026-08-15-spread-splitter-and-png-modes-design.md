# Design Specification: KCC Spread Splitter & Indexed PNG Modes

## 1. Overview
Port the Kindle Comic Converter (KCC) image spread splitting and rotation logic into the Web CBZ-to-EPUB Converter (`LordRenDS/Converter`), providing full control over wide spread handling (mode, rotation, position order) and adding 4-bit (16 gray levels E-Ink) and 8-bit PNG export capabilities.

---

## 2. Spread Splitter Architecture

### 2.1 Spread Detection
An image is recognized as a two-page spread if:
$$\text{width} > \text{height} \quad \text{and} \quad \frac{\text{width}}{\text{height}} > 1.16$$
This matches KCC's aspect ratio threshold for two-page comic/manga spreads.

### 2.2 Spread Processing Modes (`SPREAD_MODES`)
- **`OFF` (`'off'`)**: No splitting or rotation. Image is included as a single page (`PAGE_TYPES.NORMAL` or `PAGE_TYPES.SPREAD_CENTER` if landscape spread layout is active).
- **`SPLIT` (`'split'`)** *(KCC `splitter = 0`)*: Splits the spread vertically into two halves.
  - In **LTR (Comic)**: Left half is Part 1 (`PAGE_TYPES.SPREAD_PART_1`), Right half is Part 2 (`PAGE_TYPES.SPREAD_PART_2`).
  - In **RTL (Manga)**: Right half is Part 1 (`PAGE_TYPES.SPREAD_PART_1`), Left half is Part 2 (`PAGE_TYPES.SPREAD_PART_2`).
- **`ROTATE` (`'rotate'`)** *(KCC `splitter = 1`)*: Preserves the entire spread as a single page (`PAGE_TYPES.SPREAD_CENTER`).
  - Rotated by 90° CCW (default) or 90° CW (if `rotateRight` is true).
  - If `noRotate` is true, the image remains unrotated (landscape).
- **`BOTH` (`'both'`)** *(KCC `splitter = 2`)*: Produces both split halves (`S1`, `S2`) and the full spread (`R`).
  - If `spreadPosition === 'before'` *(KCC `rotatefirst = True`)*: Order is `[R, S1, S2]`.
  - If `spreadPosition === 'after'` *(KCC `rotatefirst = False` / default)*: Order is `[S1, S2, R]`.
  - The `R` page respects `noRotate` and `rotateRight`.

---

## 3. Indexed PNG Encoder (4-bit & 8-bit)

### 3.1 4-bit E-Ink PNG (16 Grayscale Levels)
- **Palette**: 16 uniform gray steps matching KCC `Palette16`:
  `[0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF]`.
- **Conversion**: Converts RGB to luminance $Y = 0.299R + 0.587G + 0.114B$, then maps to closest palette index ($0..15$).
- **Bit packing**: 4 bits per pixel (2 pixels per byte), scanline filter byte `0x00` (None).
- **PNG Chunk Structure**:
  - `IHDR`: Bit depth 4, Color type 3 (Indexed).
  - `PLTE`: 16 RGB color entries (48 bytes).
  - `IDAT`: Compressed pixel byte stream.
  - `IEND`.

### 3.2 8-bit Grayscale PNG (256 Levels)
- **Conversion**: Converts RGB to 8-bit luminance ($0..255$).
- **Bit packing**: 8 bits per pixel (1 pixel per byte), scanline filter byte `0x00`.
- **PNG Chunk Structure**:
  - `IHDR`: Bit depth 8, Color type 0 (Grayscale).
  - `IDAT`: Compressed pixel byte stream.
  - `IEND`.

### 3.3 Deflate Compression
- Pixel scanline payload is compressed using `JSZip`'s embedded DEFLATE engine, browser `CompressionStream('deflate')`, or raw RFC 1951 blocks, with CRC-32 and Adler-32 checksum calculation.

---

## 4. UI & Controls

### 4.1 Options in `index.html`
1. **Spread Mode Select** (`#spread-mode-select`):
   - `off`: Off (Do not split/rotate)
   - `split`: Split into 2 pages (Default)
   - `rotate`: Rotate spread only
   - `both`: Split and include full spread
2. **Spread Options Group** (sub-controls):
   - `#spread-no-rotate-checkbox`: "Do not rotate wide spread"
   - `#spread-rotate-right-checkbox`: "Rotate clockwise (90° right)"
   - `#spread-position-select`: "Spread position: After split pages / Before split pages"
3. **Format Select** (`#format-select`):
   - `original`: Original Format
   - `jpeg`: JPEG
   - `png`: PNG (Standard 24/32-bit)
   - `png_8bit`: PNG (8-bit Grayscale)
   - `png_4bit`: PNG (4-bit E-Ink 16 grays)

### 4.2 Dynamic UI Logic
- When `#spread-mode-select` is `off`: hide sub-controls.
- When `split`: hide sub-controls.
- When `rotate`: show `#spread-no-rotate-checkbox`, `#spread-rotate-right-checkbox`, hide `#spread-position-select`.
- When `both`: show all three sub-controls.
- When `#spread-no-rotate-checkbox` is checked: disable/hide `#spread-rotate-right-checkbox`.

---

## 5. EPUB Generation & Spread Integration

- Split pages and spreads are tagged with types `S1`, `S2`, `R`, and `N`.
- `spread-calculator.js` consumes the generated page sequence and computes fixed-layout `page-spread-left`, `page-spread-right`, and `page-spread-center` properties.
- Image names are saved deterministically with suffixes (e.g. `_s1`, `_s2`, `_spread`).

---

## 6. Verification Plan
- **Automated Tests**:
  - `test_png_encoder.js` / Python integration test: Verify PNG binary structure (magic header, IHDR bit depth 4 and 8, PLTE chunks, valid CRC/Adler32, correct decoding).
  - `test_spread_splitter.js` / Python integration test: Verify all spread modes (`off`, `split`, `rotate`, `both`), `spreadPosition` (`before`/`after`), `noRotate`, and reading directions (`ltr`/`rtl`).
  - Run full test suite: `D:\Programs\Dev\Python\Python312\python.exe -m unittest discover -s test`.
