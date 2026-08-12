import { jest } from '@jest/globals';

/**
 * Reusable browser environment mocks for Jest
 */
export function setupBrowserMocks() {
    globalThis.Image = class Image {
        constructor() {
            this.onload = null;
            this.onerror = null;
            this.src = '';
            this.width = 100;
            this.height = 100;
            setTimeout(() => {
                if (this.onload) this.onload();
            }, 0);
        }
    };

    globalThis.URL = {
        createObjectURL: jest.fn(() => 'mock-url'),
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
        toBlob(callback, type, quality) {
            setTimeout(() => callback(new globalThis.Blob([], { type })), 0);
        }
    };

    globalThis.HTMLImageElement = class HTMLImageElement {
        constructor() {
            this.width = 100;
            this.height = 100;
        }
    };

    if (typeof globalThis.Blob === 'undefined') {
        globalThis.Blob = class Blob {
            constructor(content = [], options = {}) {
                this.content = content;
                this.type = options?.type || '';
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
