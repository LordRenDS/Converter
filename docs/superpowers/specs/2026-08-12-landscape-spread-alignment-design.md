# Design Document: Landscape Spread Seamless Seam Alignment

## 1. Overview
When displaying double-page spreads in landscape mode on e-readers (such as Kindle Paperwhite, Oasis, Scribe, and Kobo), two adjacent pages are placed side by side. 

Currently, `epub-builder.js` centers images on every page with `div.page-container { text-align: center; }`. When comic pages or split spread halves are narrower than the half-screen viewport, centering creates whitespace on both sides of each page. At the center seam where the two pages meet, these margins add together to produce an artificial white gap between the two halves of a continuous illustration. Furthermore, omitting `@page { margin: 0; }` allows e-reader rendering engines to inject default margins around pages.

This design introduces **automatic seamless seam alignment (выравнивание встык к корешку)** and **zero-margin page reset** in `Converter`.

## 2. Technical Design & Architecture

### 2.1. Alignment Logic by Spread Property
In two-page landscape spreads:
- **Left Page (`page-spread-left`)**: The page is on the left side of the display. Its binding/gutter (seam) is on the **right edge**. The image must be aligned to the **right** (`text-align: right;`).
- **Right Page (`page-spread-right`)**: The page is on the right side of the display. Its binding/gutter (seam) is on the **left edge**. The image must be aligned to the **left** (`text-align: left;`).
- **Centered / Unsplit Wide Spreads (`page-spread-center` or disabled landscape spread)**: The image occupies the full display or has no specific side binding, so it is aligned to the **center** (`text-align: center;`).

This rule is universal for both LTR (comics) and RTL (manga) because `page-spread-left` always sits on the left half of the screen and `page-spread-right` always sits on the right half.

### 2.2. CSS Reset Rules
Each generated XHTML page (including cover) will include:
```css
@page {
  margin: 0;
}
body {
  margin: 0;
  padding: 0;
  background-color: #FFFFFF;
}
div.page-container {
  text-align: /* 'right' | 'left' | 'center' */;
  margin: 0;
  padding: 0;
}
img {
  margin: 0;
  padding: 0;
  display: inline-block;
  vertical-align: top;
}
```

### 2.3. Pipeline Refactoring in `src/js/modules/epub-builder.js`
1. **Pass 1 - Image Processing & Metadata Collection**:
   - Process images, collect `procImg` objects (dimensions, blobs, MIME types, `PAGE_TYPES`).
   - Populate `spinePages` list with `{ id, type }`.
2. **Pass 2 - Spread Calculation**:
   - Compute `spreadProps = calculatePageSpreads({ pages: spinePages, readingDirection, isLandscapeSpread, isOffsetFirstPage })`.
3. **Pass 3 - XHTML & Spine Generation**:
   - For each page, determine its alignment:
     - `spreadProps[i] === 'left' ? 'right' : (spreadProps[i] === 'right' ? 'left' : 'center')`
   - Generate and write `page_XXXX.xhtml` with the computed `text-align` and `@page { margin: 0; }`.
   - Generate `<itemref>` elements with `properties="page-spread-..."`.

## 3. Error Handling & Edge Cases
- **Landscape spread disabled (`isLandscapeSpread = false`)**: All pages use `text-align: center` (standard single-page reading).
- **Custom cover**: Always uses `text-align: center` and `@page { margin: 0; }`.
- **Wide unsplit pages (`PAGE_TYPES.SPREAD_CENTER`)**: Uses `text-align: center`.
- **Images with identical aspect ratio to screen slot**: Fills width completely with 0px margin regardless of alignment, remaining visually identical.
- **Narrow pages**: Left page aligns right, right page aligns left; letterboxing shifts entirely to the outer display edges (leftmost and rightmost borders), keeping the center seam seamless.

## 4. Testing & Verification
1. **Unit & Integration Tests (`test/epub-builder.test.js` & `test/test_epub_builder.py`)**:
   - Verify `page_XXXX.xhtml` contains `@page { margin: 0; }`.
   - Verify `page-spread-left` XHTML has `text-align: right` (or `class="page-container align-right"`).
   - Verify `page-spread-right` XHTML has `text-align: left` (or `class="page-container align-left"`).
   - Verify single/center pages have `text-align: center`.
   - Verify cover XHTML has `@page { margin: 0; }` and `text-align: center`.
2. **Full test suite execution**:
   - Run Python discovery runner: `python -m unittest discover test`.
   - All tests pass with 100% success rate.
