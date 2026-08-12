import { describe, it, expect, jest, afterEach } from '@jest/globals';
import {
    isSpread,
    getSplitOrder,
    blobToImage,
    imageToBlob,
    processImage,
    splitImage
} from '../src/js/modules/image-processor.js';
import { READING_DIRECTIONS, OUTPUT_FORMATS } from '../src/js/modules/constants.js';

describe('image-processor module', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('isSpread', () => {
        it('should return true for a wide image (spread)', () => {
            expect(isSpread(2000, 1000)).toBe(true);
        });

        it('should return false for a tall image (single page)', () => {
            expect(isSpread(1000, 2000)).toBe(false);
        });

        it('should return false for a square image', () => {
            expect(isSpread(1000, 1000)).toBe(false);
        });
    });

    describe('getSplitOrder', () => {
        it('should return [left, right] for LTR', () => {
            expect(getSplitOrder(READING_DIRECTIONS.LTR)).toEqual(['left', 'right']);
        });

        it('should return [right, left] for RTL', () => {
            expect(getSplitOrder(READING_DIRECTIONS.RTL)).toEqual(['right', 'left']);
        });
    });

    describe('blobToImage', () => {
        it('should resolve with an Image object and revoke object URL', async () => {
            const blob = new globalThis.Blob(['dummy'], { type: 'image/jpeg' });
            const img = await blobToImage(blob);

            expect(img).toBeDefined();
            expect(globalThis.URL.createObjectURL).toHaveBeenCalledWith(blob);
            expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('mock-url');
        });
    });

    describe('imageToBlob', () => {
        it('should handle HTMLCanvasElement', async () => {
            const canvas = new globalThis.HTMLCanvasElement();
            const blob = await imageToBlob(canvas, 'image/jpeg');

            expect(blob).toBeDefined();
            expect(blob.type).toBe('image/jpeg');
        });

        it('should handle HTMLImageElement', async () => {
            const img = new globalThis.HTMLImageElement();
            const blob = await imageToBlob(img, 'image/png');

            expect(blob).toBeDefined();
            expect(blob.type).toBe('image/png');
        });
    });

    describe('processImage', () => {
        it('should resize for Kindle if image is too large', async () => {
            const img = { width: 2000, height: 3000 };
            const originalBlob = new globalThis.Blob([''], { type: 'image/jpeg' });

            const result = await processImage(img, originalBlob, true, false, 'image/jpeg');

            expect(result.width).toBeLessThan(2000);
            expect(result.height).toBeLessThan(3000);
            expect(result.blob).toBeDefined();
        });

        it('should not resize for Kindle if image is smaller than target', async () => {
            const img = { width: 1000, height: 1000 };
            const originalBlob = new globalThis.Blob([''], { type: 'image/jpeg' });

            const result = await processImage(img, originalBlob, true, false, 'image/jpeg');

            expect(result.width).toBe(1000);
            expect(result.height).toBe(1000);
            expect(result.blob).toBe(originalBlob);
        });

        it('should apply grayscale conversion', async () => {
            const img = { width: 100, height: 100 };
            const originalBlob = new globalThis.Blob([''], { type: 'image/jpeg' });

            const result = await processImage(img, originalBlob, false, true, 'image/jpeg');

            expect(result.width).toBe(100);
            expect(result.height).toBe(100);
            expect(result.blob).toBeDefined();
            expect(result.blob).not.toBe(originalBlob);
        });

        it('should return original blob if no processing needed', async () => {
            const img = { width: 100, height: 100 };
            const originalBlob = new globalThis.Blob([''], { type: 'image/jpeg' });

            const result = await processImage(img, originalBlob, false, false, 'image/jpeg', OUTPUT_FORMATS.ORIGINAL);

            expect(result.blob).toBe(originalBlob);
            expect(result.width).toBe(100);
            expect(result.height).toBe(100);
        });
    });

    describe('splitImage', () => {
        it('should split image into two halves', async () => {
            const img = { width: 2000, height: 1500 };

            const result = await splitImage(img, OUTPUT_FORMATS.JPEG);

            expect(result.left).toBeDefined();
            expect(result.right).toBeDefined();
            expect(result.mimeType).toBe('image/jpeg');
            expect(result.left).toBeDefined();
            expect(result.right).toBeDefined();
        });
    });
});
