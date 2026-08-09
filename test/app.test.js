const { ConverterLogic } = require('../app.js');

describe('ConverterLogic', () => {
    describe('isSpread', () => {
        it('should return true for a wide image (spread)', () => {
            expect(ConverterLogic.isSpread(2000, 1000)).toBe(true);
        });

        it('should return false for a tall image (single page)', () => {
            expect(ConverterLogic.isSpread(1000, 2000)).toBe(false);
        });

        it('should return false for a square image', () => {
            expect(ConverterLogic.isSpread(1000, 1000)).toBe(false);
        });
    });

    describe('getSplitOrder', () => {
        it('should return [left, right] for ltr', () => {
            expect(ConverterLogic.getSplitOrder('ltr')).toEqual(['left', 'right']);
        });

        it('should return [right, left] for rtl', () => {
            expect(ConverterLogic.getSplitOrder('rtl')).toEqual(['right', 'left']);
        });
    });

    describe('getSpineDirectionAttribute', () => {
        it('should return page-progression-direction="ltr" for ltr', () => {
            expect(ConverterLogic.getSpineDirectionAttribute('ltr')).toBe(' page-progression-direction="ltr"');
        });

        it('should return page-progression-direction="rtl" for rtl', () => {
            expect(ConverterLogic.getSpineDirectionAttribute('rtl')).toBe(' page-progression-direction="rtl"');
        });
    });
});
