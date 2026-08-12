import { describe, it, expect } from '@jest/globals';
import {
    PAGE_TYPES,
    calculatePageSpreads,
    getPageSpreadProperty
} from '../src/js/modules/spread-calculator.js';

describe('spread-calculator module', () => {
    describe('PAGE_TYPES', () => {
        it('should define correct page type constants', () => {
            expect(PAGE_TYPES.NORMAL).toBe('N');
            expect(PAGE_TYPES.SPREAD_PART_1).toBe('S1');
            expect(PAGE_TYPES.SPREAD_PART_2).toBe('S2');
            expect(PAGE_TYPES.SPREAD_CENTER).toBe('R');
        });
    });

    describe('calculatePageSpreads', () => {
        it('should return empty strings when isLandscapeSpread is false', () => {
            const pages = [
                { type: PAGE_TYPES.NORMAL },
                { type: PAGE_TYPES.SPREAD_PART_1 },
                { type: PAGE_TYPES.SPREAD_PART_2 },
                { type: PAGE_TYPES.NORMAL }
            ];
            const result = calculatePageSpreads({
                pages,
                readingDirection: 'rtl',
                isLandscapeSpread: false,
                isOffsetFirstPage: false
            });
            expect(result).toEqual(['', '', '', '']);
        });

        it('should return empty array for empty pages array', () => {
            const result = calculatePageSpreads({
                pages: [],
                readingDirection: 'rtl',
                isLandscapeSpread: true,
                isOffsetFirstPage: false
            });
            expect(result).toEqual([]);
        });

        it('should handle LTR single pages without offset [N, N, N, N]', () => {
            const pages = [
                { type: PAGE_TYPES.NORMAL },
                { type: PAGE_TYPES.NORMAL },
                { type: PAGE_TYPES.NORMAL },
                { type: PAGE_TYPES.NORMAL }
            ];
            const result = calculatePageSpreads({
                pages,
                readingDirection: 'ltr',
                isLandscapeSpread: true,
                isOffsetFirstPage: false
            });
            expect(result).toEqual(['left', 'right', 'left', 'right']);
        });

        it('should handle RTL single pages without offset [N, N, N, N]', () => {
            const pages = [
                { type: PAGE_TYPES.NORMAL },
                { type: PAGE_TYPES.NORMAL },
                { type: PAGE_TYPES.NORMAL },
                { type: PAGE_TYPES.NORMAL }
            ];
            const result = calculatePageSpreads({
                pages,
                readingDirection: 'rtl',
                isLandscapeSpread: true,
                isOffsetFirstPage: false
            });
            expect(result).toEqual(['right', 'left', 'right', 'left']);
        });

        it('should handle RTL single pages with isOffsetFirstPage = true', () => {
            const pages = [
                { type: PAGE_TYPES.NORMAL },
                { type: PAGE_TYPES.NORMAL },
                { type: PAGE_TYPES.NORMAL },
                { type: PAGE_TYPES.NORMAL }
            ];
            const result = calculatePageSpreads({
                pages,
                readingDirection: 'rtl',
                isLandscapeSpread: true,
                isOffsetFirstPage: true
            });
            expect(result).toEqual(['left', 'right', 'left', 'right']);
        });

        it('should handle LTR single pages with isOffsetFirstPage = true', () => {
            const pages = [
                { type: PAGE_TYPES.NORMAL },
                { type: PAGE_TYPES.NORMAL },
                { type: PAGE_TYPES.NORMAL },
                { type: PAGE_TYPES.NORMAL }
            ];
            const result = calculatePageSpreads({
                pages,
                readingDirection: 'ltr',
                isLandscapeSpread: true,
                isOffsetFirstPage: true
            });
            expect(result).toEqual(['right', 'left', 'right', 'left']);
        });

        it('should handle LTR split spread [N, S1, S2, N] with backward pass', () => {
            const pages = [
                { type: PAGE_TYPES.NORMAL },
                { type: PAGE_TYPES.SPREAD_PART_1 },
                { type: PAGE_TYPES.SPREAD_PART_2 },
                { type: PAGE_TYPES.NORMAL }
            ];
            const result = calculatePageSpreads({
                pages,
                readingDirection: 'ltr',
                isLandscapeSpread: true,
                isOffsetFirstPage: false
            });
            expect(result).toEqual(['right', 'left', 'right', 'left']);
        });

        it('should handle RTL split spread [N, S1, S2, N] with backward pass', () => {
            const pages = [
                { type: PAGE_TYPES.NORMAL },
                { type: PAGE_TYPES.SPREAD_PART_1 },
                { type: PAGE_TYPES.SPREAD_PART_2 },
                { type: PAGE_TYPES.NORMAL }
            ];
            const result = calculatePageSpreads({
                pages,
                readingDirection: 'rtl',
                isLandscapeSpread: true,
                isOffsetFirstPage: false
            });
            expect(result).toEqual(['left', 'right', 'left', 'right']);
        });

        it('should handle center spread [N, R, N] in RTL', () => {
            const pages = [
                { type: PAGE_TYPES.NORMAL },
                { type: PAGE_TYPES.SPREAD_CENTER },
                { type: PAGE_TYPES.NORMAL }
            ];
            const result = calculatePageSpreads({
                pages,
                readingDirection: 'rtl',
                isLandscapeSpread: true,
                isOffsetFirstPage: false
            });
            expect(result).toEqual(['left', 'center', 'right']);
        });

        it('should handle center spread [N, R, N] in LTR', () => {
            const pages = [
                { type: PAGE_TYPES.NORMAL },
                { type: PAGE_TYPES.SPREAD_CENTER },
                { type: PAGE_TYPES.NORMAL }
            ];
            const result = calculatePageSpreads({
                pages,
                readingDirection: 'ltr',
                isLandscapeSpread: true,
                isOffsetFirstPage: false
            });
            expect(result).toEqual(['right', 'center', 'left']);
        });

        it('should perform backward pass correctly on odd single pages before spread in RTL [N, N, N, S1, S2]', () => {
            const pages = [
                { type: PAGE_TYPES.NORMAL },
                { type: PAGE_TYPES.NORMAL },
                { type: PAGE_TYPES.NORMAL },
                { type: PAGE_TYPES.SPREAD_PART_1 },
                { type: PAGE_TYPES.SPREAD_PART_2 }
            ];
            const result = calculatePageSpreads({
                pages,
                readingDirection: 'rtl',
                isLandscapeSpread: true,
                isOffsetFirstPage: false
            });
            expect(result).toEqual(['left', 'right', 'left', 'right', 'left']);
        });

        it('should perform backward pass correctly on multiple spread clusters in RTL', () => {
            const pages = [
                { type: PAGE_TYPES.NORMAL }, // 0: N -> fixed to 'left'
                { type: PAGE_TYPES.SPREAD_PART_1 }, // 1: S1 -> 'right'
                { type: PAGE_TYPES.SPREAD_PART_2 }, // 2: S2 -> 'left'
                { type: PAGE_TYPES.NORMAL }, // 3: N -> fixed to 'left'
                { type: PAGE_TYPES.SPREAD_PART_1 }, // 4: S1 -> 'right'
                { type: PAGE_TYPES.SPREAD_PART_2 }  // 5: S2 -> 'left'
            ];
            const result = calculatePageSpreads({
                pages,
                readingDirection: 'rtl',
                isLandscapeSpread: true,
                isOffsetFirstPage: false
            });
            expect(result).toEqual(['left', 'right', 'left', 'left', 'right', 'left']);
        });
    });

    describe('getPageSpreadProperty', () => {
        it('should return empty string for falsy spread properties', () => {
            expect(getPageSpreadProperty('')).toBe('');
            expect(getPageSpreadProperty(null)).toBe('');
            expect(getPageSpreadProperty(undefined)).toBe('');
        });

        it('should return formatted page-spread property attribute', () => {
            expect(getPageSpreadProperty('left')).toBe(' properties="page-spread-left"');
            expect(getPageSpreadProperty('right')).toBe(' properties="page-spread-right"');
            expect(getPageSpreadProperty('center')).toBe(' properties="page-spread-center"');
        });
    });
});
