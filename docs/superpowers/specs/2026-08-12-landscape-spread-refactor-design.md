# Design Document: Landscape Spread Calculation Refactor

## 1. Overview
The goal of this refactor is to port and accurately implement the double-page landscape spread determination algorithm from [Kindle Comic Converter (KCC)](https://github.com/ciromattia/kcc) into this web application.

Currently, the EPUB generator (`epub-builder.js`) relies on a naive sequential alternator for `page-spread-left` and `page-spread-right`, ignoring page classification and causing two-page spreads to split across physical page-turns on e-readers (such as Kindle and Kobo).

## 2. Architecture & Modules

### 2.1. New Module: `src/js/modules/spread-calculator.js`
This module encapsulates all spread calculation logic as pure, standalone functions.

#### Constants & Types
```javascript
export const PAGE_TYPES = {
    NORMAL: 'N',          // Standard single portrait page
    SPREAD_PART_1: 'S1',  // First half of a split wide spread (Right in RTL, Left in LTR)
    SPREAD_PART_2: 'S2',  // Second half of a split wide spread (Left in RTL, Right in LTR)
    SPREAD_CENTER: 'R'    // Unsplit wide spread or centered landscape page
};
```

#### Public Functions
- `calculatePageSpreads({ pages, readingDirection, isLandscapeSpread, isOffsetFirstPage })`: Returns an array of `page-spread` strings (`'left'`, `'right'`, `'center'`, or `''` if landscape spread is disabled) matching each page index in `pages`.
- `getPageSpreadProperty(spreadProp, isKindle = false)`: Returns the EPUB spine attribute string (e.g. ` properties="page-spread-left"`).

### 2.2. Changes in `src/js/modules/epub-builder.js`
- Integrate `PAGE_TYPES` and `calculatePageSpreads`.
- Pass custom cover (if any) as `PAGE_TYPES.NORMAL`.
- Tag split spread halves as `PAGE_TYPES.SPREAD_PART_1` and `PAGE_TYPES.SPREAD_PART_2`.
- Tag unsplit wide spreads (`isSpread` without splitting) as `PAGE_TYPES.SPREAD_CENTER`.
- Tag standard pages as `PAGE_TYPES.NORMAL`.
- Perform two-pass spread calculation before building spine `<itemref>` elements.
- Apply computed `page-spread-*` properties to the OPF spine.

## 3. Algorithm Specification (KCC Two-Pass Spread Calculation)

### 3.1. Initialization
- `startSide`: `'right'` for `RTL`, `'left'` for `LTR`.
- `oppositeSide`: `'left'` for `RTL`, `'right'` for `LTR`.
- `initialPageSide`: If `isOffsetFirstPage` is `true`, `initialPageSide = oppositeSide`; otherwise `initialPageSide = startSide`.

### 3.2. Forward Pass
Iterate sequentially through the list of pages with variable `pageside = initialPageSide`:
- **If `page.type === PAGE_TYPES.SPREAD_CENTER` (`R`)**:
  - Assign property `'center'`.
  - Set `pageside = startSide`.
- **If `page.type === PAGE_TYPES.SPREAD_PART_1` (`S1`)**:
  - Assign property `startSide` (`'right'` for RTL, `'left'` for LTR).
  - Set `pageside = startSide`.
- **If `page.type === PAGE_TYPES.SPREAD_PART_2` (`S2`)**:
  - Assign property `oppositeSide` (`'left'` for RTL, `'right'` for LTR).
  - Set `pageside = startSide`.
- **If `page.type === PAGE_TYPES.NORMAL` (`N`)**:
  - Assign property `pageside`.
  - Toggle `pageside = (pageside === 'right') ? 'left' : 'right'`.

### 3.3. Backward Pass
Iterate backwards from `index = pages.length - 1` down to `0`:
- Maintain state `spread_seen = false` and `backwardPageSide = oppositeSide`.
- If `page.type !== PAGE_TYPES.NORMAL`:
  - `spread_seen = true`
  - `backwardPageSide = oppositeSide`
- Else if `spread_seen === true`:
  - `result[index] = backwardPageSide`
  - Toggle `backwardPageSide = (backwardPageSide === 'right') ? 'left' : 'right'`

### 3.4. Output Mapping
If `isLandscapeSpread` is `false`, return an empty string for all pages.
Otherwise return the computed properties array (`'left'`, `'right'`, or `'center'`).

## 4. Error Handling & Edge Cases
- **Empty pages list**: returns empty array `[]`.
- **Book with only single portrait pages**: clean alternating left/right sequence based on `readingDirection` and `isOffsetFirstPage`.
- **Consecutive spreads**: every spread retains correct alignment without displacing adjacent spreads.
- **Odd number of single pages before a spread**: backward pass ensures the single page directly before the spread does not land on the wrong side of the viewport.

## 5. Testing & Verification
1. Unit tests in `test/spread-calculator.test.js` covering:
   - RTL / LTR pure single pages (with & without offset).
   - RTL / LTR split spreads (`S1`, `S2`).
   - Center spreads (`R`).
   - Mixed sequences with backward pass alignment.
   - Disabled landscape spread.
2. Integration tests in `test/epub-builder.test.js` verifying OPF `<spine>` generation.
3. Automated verification script via Python testing framework and browser verification.
