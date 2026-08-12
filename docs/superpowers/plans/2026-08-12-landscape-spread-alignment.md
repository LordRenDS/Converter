# Landscape Spread Seamless Seam Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement automatic seamless seam alignment (`text-align: right` for left pages, `text-align: left` for right pages, `text-align: center` for center pages) and CSS `@page { margin: 0; }` reset in `src/js/modules/epub-builder.js` to eliminate empty gaps between landscape spread pages on e-readers.

**Architecture:** Refactor `epub-builder.js` page XHTML generation: collect page items and their `PAGE_TYPES`, compute spread properties using `calculatePageSpreads`, and generate each page's XHTML with the corresponding alignment style and zero-margin CSS reset.

**Tech Stack:** JavaScript (ES Modules), HTML/CSS, JSZip, Jest, Python unittest integration test runner.

## Global Constraints
- Target codebase is `Converter` (`d:\Workspace\Programing\html\Converter`).
- Maintain full compatibility with existing `calculatePageSpreads` algorithm and OPF metadata.
- All existing and new tests must pass (100% success rate).

---

### Task 1: Refactor `epub-builder.js` for Seamless Seam Alignment & CSS Reset

**Files:**
- Modify: `src/js/modules/epub-builder.js`
- Test: `test/epub-builder.test.js`

**Interfaces:**
- Consumes: `PAGE_TYPES`, `calculatePageSpreads`, `getPageSpreadProperty` from `./spread-calculator.js`
- Produces: `createEpub(options)` generating XHTML pages with `@page { margin: 0; }` and alignment:
  - `page-spread-left` -> `text-align: right;`
  - `page-spread-right` -> `text-align: left;`
  - `page-spread-center` / default -> `text-align: center;`

- [ ] **Step 1: Write the failing unit tests in `test/epub-builder.test.js`**

Add tests checking that:
1. Generated page XHTML contains `@page { margin: 0; }`.
2. When `isLandscapeSpread: true`:
   - Left page XHTML has `text-align: right;`.
   - Right page XHTML has `text-align: left;`.
   - Center page XHTML has `text-align: center;`.
3. Cover XHTML contains `@page { margin: 0; }` and `text-align: center;`.

- [ ] **Step 2: Run tests to verify failure**

Run: `python -m unittest discover test`
Expected: Failures on the new alignment assertions.

- [ ] **Step 3: Implement the alignment and CSS reset in `src/js/modules/epub-builder.js`**

In `src/js/modules/epub-builder.js`:
1. Add alignment resolver helper:
```javascript
export function getPageSpreadAlignment(spreadProp) {
    if (spreadProp === 'left') return 'right';
    if (spreadProp === 'right') return 'left';
    return 'center';
}
```
2. Refactor `createEpub` loop:
   - When building pages, collect page descriptors with their image data and metadata in a list.
   - Run `const spreadProps = calculatePageSpreads({ pages: spinePages, readingDirection, isLandscapeSpread, isOffsetFirstPage });`.
   - For each page item:
     - Get `spreadProp = spreadProps[i] || ''`.
     - Determine `textAlign = getPageSpreadAlignment(spreadProp)`.
     - Generate XHTML with:
     ```html
     <?xml version="1.0" encoding="utf-8"?>
     <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
     <head>
       <title>${title}</title>
       <meta name="viewport" content="width=${procImg.width}, height=${procImg.height}"/>
       <style type="text/css">
         @page { margin: 0; }
         body { margin: 0; padding: 0; background-color: #FFFFFF; }
         div.page-container { text-align: ${textAlign}; margin: 0; padding: 0; }
         img { margin: 0; padding: 0; display: inline-block; vertical-align: top; }
       </style>
     </head>
     <body>
       <div class="page-container">
         <img width="${procImg.width}" height="${procImg.height}" src="../Images/${imgName}" alt="Page ${globalImageCounter}" />
       </div>
     </body>
     </html>
     ```
   - For custom cover XHTML, apply `@page { margin: 0; }`, `text-align: center;`, and `display: inline-block; vertical-align: top;`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m unittest discover test`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/js/modules/epub-builder.js test/epub-builder.test.js
git commit -m "feat: add seamless seam alignment and CSS reset for landscape spreads in epub-builder"
```

---

### Task 2: Update Python Integration Test Suite for XHTML Alignment

**Files:**
- Modify: `test/test_epub_builder.py`

**Interfaces:**
- Consumes: `createEpub` from `./src/js/modules/epub-builder.js` via Node runner
- Produces: Test assertions for XHTML content across all landscape and single-page scenarios

- [ ] **Step 1: Add integration test assertions in `test/test_epub_builder.py`**

Add tests verifying:
1. `test_landscape_spread_xhtml_alignment_rtl`:
   - Checks that in RTL reading direction, spread page 1 (right side) has `text-align: left`, and spread page 2 (left side) has `text-align: right`.
2. `test_landscape_spread_xhtml_alignment_ltr`:
   - Checks that in LTR reading direction, spread page 1 (left side) has `text-align: right`, and spread page 2 (right side) has `text-align: left`.
3. `test_landscape_spread_disabled_xhtml_alignment`:
   - Checks that when `isLandscapeSpread = false`, all pages have `text-align: center`.
4. `test_cover_page_xhtml_reset`:
   - Checks that custom cover and regular cover pages have `@page { margin: 0; }` and `text-align: center`.

- [ ] **Step 2: Run test suite**

Run: `python -m unittest discover test`
Expected: PASS (all tests pass).

- [ ] **Step 3: Commit changes**

```bash
git add test/test_epub_builder.py
git commit -m "test: add integration tests for landscape spread XHTML alignment and CSS reset"
```

---

### Task 3: Full End-to-End Test Suite Verification

**Files:**
- Verify: All files in repository

- [ ] **Step 1: Run complete test suite**

Run: `python -m unittest discover test`
Expected: All tests pass with 0 errors, 0 failures.

- [ ] **Step 2: Verify git status is clean**

Run: `git status`
Expected: Working tree clean.
