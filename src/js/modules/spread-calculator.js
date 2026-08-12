/**
 * Spread calculation module ported from Kindle Comic Converter (KCC)
 * Implements two-pass landscape spread determination for fixed-layout EPUBs.
 */

export const PAGE_TYPES = {
    NORMAL: 'N',
    SPREAD_PART_1: 'S1',
    SPREAD_PART_2: 'S2',
    SPREAD_CENTER: 'R'
};

/**
 * Calculates page-spread properties ('left', 'right', 'center', or '') for a sequence of pages.
 *
 * @param {Object} params
 * @param {Array<{type?: string}>} [params.pages=[]] - Array of page descriptors with `type` property
 * @param {string} [params.readingDirection='ltr'] - 'ltr' or 'rtl'
 * @param {boolean} [params.isLandscapeSpread=false] - Whether landscape spread mode is enabled
 * @param {boolean} [params.isOffsetFirstPage=false] - Whether first page is offset
 * @returns {string[]} Array of spread property strings ('left', 'right', 'center', or '')
 */
export function calculatePageSpreads({
    pages = [],
    readingDirection = 'ltr',
    isLandscapeSpread = false,
    isOffsetFirstPage = false
} = {}) {
    if (!isLandscapeSpread || !pages || pages.length === 0) {
        return Array(pages ? pages.length : 0).fill('');
    }

    const startSide = readingDirection === 'rtl' ? 'right' : 'left';
    const oppositeSide = readingDirection === 'rtl' ? 'left' : 'right';
    const initialPageSide = isOffsetFirstPage ? oppositeSide : startSide;

    // Forward pass
    let pageside = initialPageSide;
    const result = [];

    for (let i = 0; i < pages.length; i++) {
        const page = pages[i] || {};
        const pageType = page.type || PAGE_TYPES.NORMAL;

        if (pageType === PAGE_TYPES.SPREAD_CENTER) {
            result.push('center');
            pageside = startSide;
        } else if (pageType === PAGE_TYPES.SPREAD_PART_1) {
            result.push(startSide);
            pageside = startSide;
        } else if (pageType === PAGE_TYPES.SPREAD_PART_2) {
            result.push(oppositeSide);
            pageside = startSide;
        } else {
            // Normal page
            result.push(pageside);
            pageside = (pageside === 'right' ? 'left' : 'right');
        }
    }

    // Backward pass
    let spreadSeen = false;
    let backwardPageSide = oppositeSide;

    for (let i = pages.length - 1; i >= 0; i--) {
        const page = pages[i] || {};
        const pageType = page.type || PAGE_TYPES.NORMAL;

        if (pageType !== PAGE_TYPES.NORMAL) {
            spreadSeen = true;
            backwardPageSide = oppositeSide;
        } else if (spreadSeen) {
            result[i] = backwardPageSide;
            backwardPageSide = (backwardPageSide === 'right' ? 'left' : 'right');
        }
    }

    return result;
}

/**
 * Returns formatted EPUB spine itemref properties attribute for page-spread.
 *
 * @param {string} spreadProp - 'left', 'right', 'center', or empty string/falsy
 * @param {boolean} [isKindle=false] - Optional Kindle-specific flag
 * @returns {string} Attribute string e.g. ' properties="page-spread-left"' or ''
 */
export function getPageSpreadProperty(spreadProp, isKindle = false) {
    if (!spreadProp) {
        return '';
    }
    return ` properties="page-spread-${spreadProp}"`;
}
