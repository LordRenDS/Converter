# Landscape Spread Calculation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port and accurately implement the KCC two-pass landscape spread determination algorithm for CBZ to EPUB conversion.

**Architecture:** Encapsulate page type classification and two-pass spread calculations (`calculatePageSpreads`, `getPageSpreadProperty`) in a dedicated module `src/js/modules/spread-calculator.js`. Integrate this into `src/js/modules/epub-builder.js` so that custom covers, split spread halves (`S1`/`S2`), unsplit wide spreads (`R`), and normal portrait pages (`N`) produce exact EPUB 3 spine metadata matching Kindle/Kobo reader expectations.

**Tech Stack:** Vanilla JavaScript (ES modules), Jest (JS unit tests), Python 3.12 (headless test execution runner).

## Global Constraints

- Preserve reading direction logic (`ltr` and `rtl`) as defined in `src/js/modules/constants.js`.
- Support `isLandscapeSpread` flag and `isOffsetFirstPage` flag seamlessly.
- Zero dependencies added; pure ES module code.
- Provide automated test suites runnable both with Node/Jest and with Python 3.12.

---

### Task 1: Implement `spread-calculator.js` module and unit tests

**Files:**
- Create: `src/js/modules/spread-calculator.js`
- Create: `test/spread-calculator.test.js`
- Create: `test/test_spread_calculator.py` (Python test suite executing the same test vectors for verification)

**Interfaces:**
- Produces:
  - `PAGE_TYPES = { NORMAL: 'N', SPREAD_PART_1: 'S1', SPREAD_PART_2: 'S2', SPREAD_CENTER: 'R' }`
  - `calculatePageSpreads({ pages, readingDirection, isLandscapeSpread, isOffsetFirstPage }): string[]`
  - `getPageSpreadProperty(spreadProp, isKindle = false): string`

- [ ] **Step 1: Write test suite for spread calculator**

Write unit test vectors in `test/spread-calculator.test.js` (Jest) and equivalent verification script in `test/test_spread_calculator.py`.

Test cases:
1. `isLandscapeSpread = false`: returns empty string `""` for every page.
2. LTR single pages `[N, N, N, N]` without offset: returns `['left', 'right', 'left', 'right']`.
3. RTL single pages `[N, N, N, N]` without offset: returns `['right', 'left', 'right', 'left']`.
4. RTL single pages with `isOffsetFirstPage = true`: returns `['left', 'right', 'left', 'right']`.
5. LTR split spread `[N, S1, S2, N]`: returns `['left', 'left', 'right', 'left']`.
6. RTL split spread `[N, S1, S2, N]`: returns `['right', 'right', 'left', 'right']`.
7. Center spread `[N, R, N]`: returns `['right', 'center', 'right']` for RTL.
8. Backward pass with odd single pages before spread in RTL: `[N, N, N, S1, S2]`:
   - Forward pass initially assigns: `p0=right`, `p1=left`, `p2=right`, `p3=right(S1)`, `p4=left(S2)`.
   - Backward pass fixes preceding single pages backwards from `left`: `p2=left`, `p1=right`, `p0=left`.
   - Result: `['left', 'right', 'left', 'right', 'left']`.

- [ ] **Step 2: Run verification script to confirm tests fail before implementation**

Run: `& 'D:\Programs\Dev\Python\Python312\python.exe' test/test_spread_calculator.py`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `src/js/modules/spread-calculator.js`**

Implement `PAGE_TYPES`, `calculatePageSpreads`, and `getPageSpreadProperty`.

- [ ] **Step 4: Run verification script to confirm tests pass**

Run: `& 'D:\Programs\Dev\Python\Python312\python.exe' test/test_spread_calculator.py`
Expected: ALL TESTS PASS

- [ ] **Step 5: Commit**

```bash
git add src/js/modules/spread-calculator.js test/spread-calculator.test.js test/test_spread_calculator.py
git commit -m "feat: implement KCC two-pass landscape spread calculator"
```

---

### Task 2: Refactor `epub-builder.js` to integrate `spread-calculator.js`

**Files:**
- Modify: `src/js/modules/epub-builder.js`

**Interfaces:**
- Consumes: `PAGE_TYPES`, `calculatePageSpreads`, `getPageSpreadProperty` from `./spread-calculator.js`
- Produces: `createEpub(options): Promise<Blob>` with correct `<itemref properties="page-spread-...">` in OPF spine

- [ ] **Step 1: Update page collection in `epub-builder.js` to track page types**

1. Import `PAGE_TYPES`, `calculatePageSpreads`, `getPageSpreadProperty` from `./spread-calculator.js`.
2. For custom cover (if present), create page descriptor `{ id: coverPageId, type: PAGE_TYPES.NORMAL }`.
3. When processing images:
   - For split spread: push part 1 as `PAGE_TYPES.SPREAD_PART_1` and part 2 as `PAGE_TYPES.SPREAD_PART_2`.
   - For unsplit wide spread (`isSpread` without split): push as `PAGE_TYPES.SPREAD_CENTER`.
   - For normal portrait page: push as `PAGE_TYPES.NORMAL`.
4. Collect all `{ id, type, xhtmlFileName, imgFileName, ... }` into a flat page registry array.

- [ ] **Step 2: Compute spine properties via `calculatePageSpreads` and generate spine `<itemref>` elements**

1. Call `calculatePageSpreads({ pages: allPages, readingDirection, isLandscapeSpread, isOffsetFirstPage })`.
2. Iterate through `allPages` and corresponding `spreadProps` to build `<itemref idref="${page.id}"${getPageSpreadProperty(spreadProp)}/>`.

- [ ] **Step 3: Verify syntax and behavior**

Run integration check with python runner.

- [ ] **Step 4: Commit**

```bash
git add src/js/modules/epub-builder.js
git commit -m "refactor(epub-builder): use spread calculator for spine page-spread properties"
```

---

### Task 3: Expand Integration Tests & End-to-End Verification

**Files:**
- Modify: `test/epub-builder.test.js`
- Create: `test/test_epub_builder.py` (Python test suite verifying OPF output against various options)

- [ ] **Step 1: Add integration test scenarios for `createEpub`**

Verify that:
1. `isLandscapeSpread = true, readingDirection = 'rtl'` on images containing single pages and split spreads generates correct `properties="page-spread-..."` in `content.opf`.
2. Center spreads (`isLandscapeSpread = true, isOptimizeEnabled = false`) get `properties="page-spread-center"`.
3. Custom cover page participates in the spread calculation as the first page.
4. `isLandscapeSpread = false` does not add `properties="page-spread-..."` to itemrefs.

- [ ] **Step 5: Run integration tests**

Run: `& 'D:\Programs\Dev\Python\Python312\python.exe' test/test_epub_builder.py`
Expected: ALL INTEGRATION TESTS PASS

- [ ] **Step 6: Commit**

```bash
git add test/epub-builder.test.js test/test_epub_builder.py
git commit -m "test: add integration test suite for EPUB spine landscape spread generation"
```

---

### Task 4: Self-Review, Cleanup & Final Verification

**Files:**
- Verify all modified files in `src/` and `test/`
- Check git status and diff

- [ ] **Step 1: Run complete test suite**

Run: `& 'D:\Programs\Dev\Python\Python312\python.exe' -m unittest discover -s test -p "test_*.py"`
Expected: ALL TESTS PASS

- [ ] **Step 2: Review changes and ensure clean tree**

Run: `git status`

- [ ] **Step 3: Commit final updates if any**
