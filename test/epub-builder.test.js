import { describe, it, expect, jest } from '@jest/globals';
import { getSpineDirectionAttribute, createEpub } from '../src/js/modules/epub-builder.js';
import { READING_DIRECTIONS, COVER_SOURCES } from '../src/js/modules/constants.js';

// Setup environment mocks
if (typeof globalThis.Blob === 'undefined') {
    globalThis.Blob = class Blob {
        constructor(parts = [], options = {}) {
            this.parts = parts;
            this.type = options?.type || '';
            this.width = options?.width || (parts && parts[0] && parts[0].width) || 1000;
            this.height = options?.height || (parts && parts[0] && parts[0].height) || 1500;
        }
    };
}

globalThis.HTMLCanvasElement = class HTMLCanvasElement {
    constructor() {
        this.width = 0;
        this.height = 0;
    }
    getContext() {
        return {
            drawImage: jest.fn(),
            getImageData: jest.fn(() => ({ data: new Uint8ClampedArray(4) })),
            putImageData: jest.fn()
        };
    }
    toBlob(cb, mimeType) {
        const blob = new globalThis.Blob(['mock-canvas'], {
            type: mimeType,
            width: this.width,
            height: this.height
        });
        setTimeout(() => cb(blob), 0);
    }
};

globalThis.HTMLImageElement = class HTMLImageElement {
    constructor() {
        this.width = 1000;
        this.height = 1500;
    }
};

globalThis.Image = class Image extends globalThis.HTMLImageElement {
    constructor() {
        super();
        this._width = 1000;
        this._height = 1500;
        this.onload = null;
        this.onerror = null;
    }
    get width() { return this._width; }
    set width(w) { this._width = w; }
    get height() { return this._height; }
    set height(h) { this._height = h; }
    get src() { return this._src; }
    set src(val) {
        this._src = val;
        if (val && val.includes('?w=')) {
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

globalThis.document = {
    createElement: (tag) => {
        if (tag === 'canvas') {
            return new globalThis.HTMLCanvasElement();
        }
        return {};
    }
};

globalThis.URL = {
    createObjectURL: jest.fn((blob) => {
        const w = blob?.width || 1000;
        const h = blob?.height || 1500;
        return `blob:mock?w=${w}&h=${h}`;
    }),
    revokeObjectURL: jest.fn()
};

function createMockZip() {
    const filesCreated = {};
    const MockJSZip = class {
        file(path, content) {
            filesCreated[path] = content;
            return this;
        }
        folder(name) {
            return {
                file: (subPath, content) => {
                    filesCreated[`${name}/${subPath}`] = content;
                    return this;
                },
                folder: (nestedName) => {
                    return {
                        file: (nestedPath, content) => {
                            filesCreated[`${name}/${nestedName}/${nestedPath}`] = content;
                            return this;
                        }
                    };
                }
            };
        }
        async generateAsync(options) {
            return new globalThis.Blob(['mock-epub'], { type: options?.mimeType || 'application/epub+zip' });
        }
    };
    return { MockJSZip, filesCreated };
}

describe('epub-builder module', () => {
    describe('getSpineDirectionAttribute', () => {
        it('should return page-progression-direction="ltr" for LTR', () => {
            expect(getSpineDirectionAttribute(READING_DIRECTIONS.LTR)).toBe(' page-progression-direction="ltr"');
        });

        it('should return page-progression-direction="rtl" for RTL', () => {
            expect(getSpineDirectionAttribute(READING_DIRECTIONS.RTL)).toBe(' page-progression-direction="rtl"');
        });
    });

    describe('createEpub core structure', () => {
        it('should throw an error if JSZip is not available', async () => {
            await expect(createEpub({ images: [], jszipLib: null })).rejects.toThrow('JSZip library is not available');
        });

        it('should build EPUB structure with OPF and manifest', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                {
                    name: 'page_1.jpg',
                    async: jest.fn().mockResolvedValue(new globalThis.Blob([], { width: 1000, height: 1500, type: 'image/jpeg' }))
                }
            ];

            const onProgress = jest.fn();

            const result = await createEpub({
                images: mockImages,
                title: 'Test Manga',
                author: 'Test Author',
                readingDirection: READING_DIRECTIONS.RTL,
                onProgress,
                jszipLib: MockJSZip
            });

            expect(result).toBeDefined();
            expect(filesCreated['mimetype']).toBe('application/epub+zip');
            expect(filesCreated['META-INF/container.xml']).toBeDefined();
            expect(filesCreated['OEBPS/content.opf']).toContain('<dc:title>Test Manga</dc:title>');
            expect(filesCreated['OEBPS/content.opf']).toContain('<dc:creator opf:role="aut">Test Author</dc:creator>');
            expect(filesCreated['OEBPS/content.opf']).toContain('page-progression-direction="rtl"');
            expect(filesCreated['OEBPS/Text/page_0000.xhtml']).toBeDefined();
            expect(onProgress).toHaveBeenCalled();
        });
    });

    describe('Scenario 1: Landscape spread with single pages and split spreads', () => {
        it('should set page-spread-right and page-spread-left for RTL single pages', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p3.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p4.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'RTL Single Pages',
                author: 'Author A',
                readingDirection: READING_DIRECTIONS.RTL,
                isLandscapeSpread: true,
                isOffsetFirstPage: false,
                jszipLib: MockJSZip
            });

            const opf = filesCreated['OEBPS/content.opf'];
            expect(opf).toContain('<meta property="rendition:spread">landscape</meta>');
            expect(opf).toContain('<itemref idref="page0" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page1" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page2" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page3" properties="page-spread-left"/>');
        });

        it('should set page-spread-left and page-spread-right for LTR single pages', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p3.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p4.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'LTR Single Pages',
                author: 'Author LTR',
                readingDirection: READING_DIRECTIONS.LTR,
                isLandscapeSpread: true,
                isOffsetFirstPage: false,
                jszipLib: MockJSZip
            });

            const opf = filesCreated['OEBPS/content.opf'];
            expect(opf).toContain('<meta property="rendition:spread">landscape</meta>');
            expect(opf).toContain('<itemref idref="page0" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page1" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page2" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page3" properties="page-spread-right"/>');
        });

        it('should split wide spread into S1 and S2 and apply backward pass for RTL', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'spread.jpg', async: async () => new globalThis.Blob([], { width: 2000, height: 1000 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'RTL Split Spread',
                author: 'Author RTL',
                isOptimizeEnabled: true,
                readingDirection: READING_DIRECTIONS.RTL,
                isLandscapeSpread: true,
                isOffsetFirstPage: false,
                jszipLib: MockJSZip
            });

            const opf = filesCreated['OEBPS/content.opf'];
            // [N, S1, S2, N] -> backward pass makes page0='left', S1='right', S2='left', page3='right'
            expect(opf).toContain('<itemref idref="page0" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page1" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page2" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page3" properties="page-spread-right"/>');
        });

        it('should split wide spread into S1 and S2 and apply backward pass for LTR', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'spread.jpg', async: async () => new globalThis.Blob([], { width: 2000, height: 1000 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'LTR Split Spread',
                author: 'Author LTR',
                isOptimizeEnabled: true,
                readingDirection: READING_DIRECTIONS.LTR,
                isLandscapeSpread: true,
                isOffsetFirstPage: false,
                jszipLib: MockJSZip
            });

            const opf = filesCreated['OEBPS/content.opf'];
            // [N, S1, S2, N] in LTR -> backward pass makes page0='right', S1='left', S2='right', page3='left'
            expect(opf).toContain('<itemref idref="page0" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page1" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page2" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page3" properties="page-spread-left"/>');
        });

        it('should handle three single pages before spread in RTL', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p3.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'spread.jpg', async: async () => new globalThis.Blob([], { width: 2000, height: 1000 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'RTL 3 Single Pages',
                author: 'Author RTL Multi',
                isOptimizeEnabled: true,
                readingDirection: READING_DIRECTIONS.RTL,
                isLandscapeSpread: true,
                isOffsetFirstPage: false,
                jszipLib: MockJSZip
            });

            const opf = filesCreated['OEBPS/content.opf'];
            // [N, N, N, S1, S2] in RTL -> backward pass: page0=left, page1=right, page2=left, page3=right, page4=left
            expect(opf).toContain('<itemref idref="page0" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page1" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page2" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page3" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page4" properties="page-spread-left"/>');
        });
    });

    describe('Scenario 2: Unsplit wide spread with isOptimizeEnabled = false', () => {
        it('should assign properties="page-spread-center" for unsplit wide spreads in RTL', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'spread.jpg', async: async () => new globalThis.Blob([], { width: 2000, height: 1000 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'Center Spread RTL',
                author: 'Author RTL Center',
                isOptimizeEnabled: false,
                readingDirection: READING_DIRECTIONS.RTL,
                isLandscapeSpread: true,
                isOffsetFirstPage: false,
                jszipLib: MockJSZip
            });

            const opf = filesCreated['OEBPS/content.opf'];
            // [N, R, N] in RTL -> page0=left, page1=center, page2=right
            expect(opf).toContain('<itemref idref="page0" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page1" properties="page-spread-center"/>');
            expect(opf).toContain('<itemref idref="page2" properties="page-spread-right"/>');
        });

        it('should assign properties="page-spread-center" for unsplit wide spreads in LTR', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'spread.jpg', async: async () => new globalThis.Blob([], { width: 2000, height: 1000 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'Center Spread LTR',
                author: 'Author LTR Center',
                isOptimizeEnabled: false,
                readingDirection: READING_DIRECTIONS.LTR,
                isLandscapeSpread: true,
                isOffsetFirstPage: false,
                jszipLib: MockJSZip
            });

            const opf = filesCreated['OEBPS/content.opf'];
            // [N, R, N] in LTR -> page0=right, page1=center, page2=left
            expect(opf).toContain('<itemref idref="page0" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page1" properties="page-spread-center"/>');
            expect(opf).toContain('<itemref idref="page2" properties="page-spread-left"/>');
        });
    });

    describe('Scenario 3: Custom cover spread property', () => {
        it('should assign properties="page-spread-right" to custom cover in RTL', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];
            const customCover = {
                name: 'custom_cover.jpg',
                width: 1000,
                height: 1500
            };

            await createEpub({
                images: mockImages,
                title: 'Custom Cover RTL',
                author: 'Author Cover RTL',
                coverSource: COVER_SOURCES.CUSTOM,
                customCoverFile: customCover,
                readingDirection: READING_DIRECTIONS.RTL,
                isLandscapeSpread: true,
                isOffsetFirstPage: false,
                jszipLib: MockJSZip
            });

            const opf = filesCreated['OEBPS/content.opf'];
            expect(opf).toContain('<itemref idref="cover-page" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page0" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page1" properties="page-spread-right"/>');
        });

        it('should assign properties="page-spread-left" to custom cover in LTR', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];
            const customCover = {
                name: 'custom_cover.jpg',
                width: 1000,
                height: 1500
            };

            await createEpub({
                images: mockImages,
                title: 'Custom Cover LTR',
                author: 'Author Cover LTR',
                coverSource: COVER_SOURCES.CUSTOM,
                customCoverFile: customCover,
                readingDirection: READING_DIRECTIONS.LTR,
                isLandscapeSpread: true,
                isOffsetFirstPage: false,
                jszipLib: MockJSZip
            });

            const opf = filesCreated['OEBPS/content.opf'];
            expect(opf).toContain('<itemref idref="cover-page" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page0" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page1" properties="page-spread-left"/>');
        });
    });

    describe('Scenario 4: Landscape spread disabled (isLandscapeSpread = false)', () => {
        it('should not include page-spread properties on itemref elements and set spread to auto in RTL', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'spread.jpg', async: async () => new globalThis.Blob([], { width: 2000, height: 1000 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'No Landscape RTL',
                author: 'Author NoSpread RTL',
                isOptimizeEnabled: false,
                readingDirection: READING_DIRECTIONS.RTL,
                isLandscapeSpread: false,
                jszipLib: MockJSZip
            });

            const opf = filesCreated['OEBPS/content.opf'];
            expect(opf).toContain('<meta property="rendition:spread">auto</meta>');
            expect(opf).not.toContain('page-spread-right');
            expect(opf).not.toContain('page-spread-left');
            expect(opf).not.toContain('page-spread-center');
            expect(opf).toContain('<itemref idref="page0"/>');
            expect(opf).toContain('<itemref idref="page1"/>');
            expect(opf).toContain('<itemref idref="page2"/>');
        });

        it('should not include page-spread properties in LTR when isLandscapeSpread is false', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'No Landscape LTR',
                author: 'Author NoSpread LTR',
                readingDirection: READING_DIRECTIONS.LTR,
                isLandscapeSpread: false,
                jszipLib: MockJSZip
            });

            const opf = filesCreated['OEBPS/content.opf'];
            expect(opf).toContain('<meta property="rendition:spread">auto</meta>');
            expect(opf).not.toContain('page-spread-right');
            expect(opf).not.toContain('page-spread-left');
            expect(opf).not.toContain('page-spread-center');
            expect(opf).toContain('<itemref idref="page0"/>');
            expect(opf).toContain('<itemref idref="page1"/>');
        });
    });

    describe('Scenario 5: Landscape spread with isOffsetFirstPage = true', () => {
        it('should offset initial page spread in RTL (left, right, left, right)', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p3.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p4.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'RTL Offset Pages',
                author: 'Author Offset RTL',
                readingDirection: READING_DIRECTIONS.RTL,
                isLandscapeSpread: true,
                isOffsetFirstPage: true,
                jszipLib: MockJSZip
            });

            const opf = filesCreated['OEBPS/content.opf'];
            expect(opf).toContain('<itemref idref="page0" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page1" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page2" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page3" properties="page-spread-right"/>');
        });

        it('should offset initial page spread in LTR (right, left, right, left)', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p3.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p4.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'LTR Offset Pages',
                author: 'Author Offset LTR',
                readingDirection: READING_DIRECTIONS.LTR,
                isLandscapeSpread: true,
                isOffsetFirstPage: true,
                jszipLib: MockJSZip
            });

            const opf = filesCreated['OEBPS/content.opf'];
            expect(opf).toContain('<itemref idref="page0" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page1" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page2" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page3" properties="page-spread-left"/>');
        });
    });
});
