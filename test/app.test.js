const { ConverterLogic } = require('../app.js');

// Mock browser objects
global.Image = class {
    constructor() {
        this.onload = null;
        this.onerror = null;
        this.src = '';
        setTimeout(() => {
            if (this.onload) this.onload();
        }, 0);
    }
};

global.URL = {
    createObjectURL: jest.fn(() => 'mock-url'),
    revokeObjectURL: jest.fn(),
};

global.HTMLCanvasElement = class HTMLCanvasElement {
    constructor() {
        this.width = 0;
        this.height = 0;
    }
    getContext() {
        return {
            drawImage: jest.fn(),
            getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(400) })),
            putImageData: jest.fn(),
        };
    }
    toBlob(callback, type, quality) {
        setTimeout(() => callback(new Blob([], { type })), 0);
    }
};

global.HTMLImageElement = class HTMLImageElement {
    constructor() {
        this.width = 100;
        this.height = 100;
    }
};

global.Blob = class Blob {
    constructor(content, options) {
        this.type = options?.type || '';
    }
};

global.document = {
    createElement: (tag) => {
        if (tag === 'canvas') return new global.HTMLCanvasElement();
        if (tag === 'a') return {};
        return {};
    },
    body: {
        appendChild: jest.fn(),
        removeChild: jest.fn()
    },
    addEventListener: jest.fn(),
    getElementById: jest.fn()
};


describe('ConverterLogic', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

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

    describe('blobToImage', () => {
        it('should resolve with an Image object and revoke object URL', async () => {
            const blob = new Blob(['dummy'], { type: 'image/jpeg' });
            const img = await ConverterLogic.blobToImage(blob);

            expect(img).toBeDefined();
            expect(global.URL.createObjectURL).toHaveBeenCalledWith(blob);
            expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('mock-url');
        });
    });

    describe('imageToBlob', () => {
        it('should handle HTMLCanvasElement', async () => {
            const canvas = new HTMLCanvasElement();
            const blob = await ConverterLogic.imageToBlob(canvas, 'image/jpeg');

            expect(blob).toBeDefined();
            expect(blob.type).toBe('image/jpeg');
        });

        it('should handle HTMLImageElement', async () => {
            const img = new HTMLImageElement();
            const blob = await ConverterLogic.imageToBlob(img, 'image/png');

            expect(blob).toBeDefined();
            expect(blob.type).toBe('image/png');
        });
    });

    describe('processImage', () => {
        it('should resize for Kindle if image is too large', async () => {
            const img = { width: 2000, height: 3000 };
            const originalBlob = new Blob([''], { type: 'image/jpeg' });

            const result = await ConverterLogic.processImage(img, originalBlob, true, false, 'image/jpeg');

            expect(result.width).toBeLessThan(2000);
            expect(result.height).toBeLessThan(3000);
            expect(result.blob).toBeDefined();
        });

        it('should not resize for Kindle if image is smaller than target', async () => {
            const img = { width: 1000, height: 1000 };
            const originalBlob = new Blob([''], { type: 'image/jpeg' });

            const result = await ConverterLogic.processImage(img, originalBlob, true, false, 'image/jpeg');

            expect(result.width).toBe(1000);
            expect(result.height).toBe(1000);
            // It should return original blob
            expect(result.blob).toBe(originalBlob);
        });

        it('should apply grayscale conversion', async () => {
            const img = { width: 100, height: 100 };
            const originalBlob = new Blob([''], { type: 'image/jpeg' });

            const result = await ConverterLogic.processImage(img, originalBlob, false, true, 'image/jpeg');

            expect(result.width).toBe(100);
            expect(result.height).toBe(100);
            expect(result.blob).toBeDefined();
            expect(result.blob).not.toBe(originalBlob);
        });

        it('should return original blob if no processing needed', async () => {
            const img = { width: 100, height: 100 };
            const originalBlob = new Blob([''], { type: 'image/jpeg' });

            const result = await ConverterLogic.processImage(img, originalBlob, false, false, 'image/jpeg');

            expect(result.blob).toBe(originalBlob);
            expect(result.width).toBe(100);
            expect(result.height).toBe(100);
        });
    });

    describe('splitImage', () => {
        it('should split image into two halves', async () => {
            const img = { width: 2000, height: 1500 };

            const result = await ConverterLogic.splitImage(img, 'jpeg');

            expect(result.left).toBeDefined();
            expect(result.right).toBeDefined();
            expect(result.mimeType).toBe('image/jpeg');

            // Checking the size of left and right blobs is hard because of our mock,
            // but we know the function calls imageToBlob which returns a Blob.
            expect(result.left instanceof Blob).toBe(true);
            expect(result.right instanceof Blob).toBe(true);
        });
    });
});
