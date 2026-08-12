import { jest } from '@jest/globals';

/**
 * Reusable browser environment mocks for Jest
 */
export function setupBrowserMocks() {
    globalThis.HTMLImageElement = class HTMLImageElement {
        constructor() {
            this.width = 1000;
            this.height = 1500;
        }
    };

    globalThis.Image = class Image extends (globalThis.HTMLImageElement || Object) {
        constructor() {
            super();
            this._width = 1000;
            this._height = 1500;
            this.onload = null;
            this.onerror = null;
            this._src = '';
        }
        get width() { return this._width; }
        set width(w) { this._width = w; }
        get height() { return this._height; }
        set height(h) { this._height = h; }
        get src() { return this._src; }
        set src(val) {
            this._src = val;
            if (val && typeof val === 'string' && val.includes('?w=')) {
                const match = val.match(/w=(\d+)&h=(\d+)/);
                if (match) {
                    this._width = parseInt(match[1], 10);
                    this._height = parseInt(match[2], 10);
                }
            }
            setTimeout(() => {
                if (this.onload) this.onload();
            }, 0);
        }
    };

    globalThis.URL = {
        createObjectURL: jest.fn((blob) => {
            const w = blob?.width || (blob && blob.width) || 1000;
            const h = blob?.height || (blob && blob.height) || 1500;
            return `blob:mock?w=${w}&h=${h}`;
        }),
        revokeObjectURL: jest.fn(),
    };

    globalThis.HTMLCanvasElement = class HTMLCanvasElement {
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
        toBlob(callback, type = 'image/jpeg', quality) {
            let blob;
            if (typeof globalThis.Blob !== 'undefined') {
                blob = new globalThis.Blob(['mock-canvas'], { type });
            } else {
                blob = { type };
            }
            blob.width = this.width || 1000;
            blob.height = this.height || 1500;
            setTimeout(() => callback(blob), 0);
        }
    };

    if (typeof globalThis.Blob === 'undefined') {
        globalThis.Blob = class Blob {
            constructor(content = [], options = {}) {
                this.content = content;
                this.type = options?.type || '';
                this.width = options?.width || 1000;
                this.height = options?.height || 1500;
            }
        };
    }

    globalThis.document = {
        createElement: (tag) => {
            if (tag === 'canvas') return new globalThis.HTMLCanvasElement();
            if (tag === 'a') return { href: '', download: '', click: jest.fn() };
            return {};
        },
        body: {
            appendChild: jest.fn(),
            removeChild: jest.fn()
        },
        addEventListener: jest.fn(),
        getElementById: jest.fn()
    };
}

// Auto-run when included via setupFilesAfterEnv
setupBrowserMocks();
