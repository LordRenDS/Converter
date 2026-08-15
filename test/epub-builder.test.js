import { describe, it, expect, jest } from '@jest/globals';
import { getSpineDirectionAttribute, createEpub, buildNcx, buildNav } from '../src/js/modules/epub-builder.js';
import { READING_DIRECTIONS, COVER_SOURCES } from '../src/js/modules/constants.js';

function createMockBlob({ width = 1000, height = 1500, type = 'image/jpeg' } = {}) {
    const blob = new globalThis.Blob([], { type });
    blob.width = width;
    blob.height = height;
    return blob;
}

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
                    async: jest.fn().mockResolvedValue(createMockBlob({ width: 1000, height: 1500, type: 'image/jpeg' }))
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
                { name: 'p1.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'p3.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'p4.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) }
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
            expect(opf).toContain('<itemref idref="page0" linear="yes" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page1" linear="yes" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page2" linear="yes" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page3" linear="yes" properties="page-spread-left"/>');
        });

        it('should set page-spread-left and page-spread-right for LTR single pages', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'p3.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'p4.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) }
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
            expect(opf).toContain('<itemref idref="page0" linear="yes" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page1" linear="yes" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page2" linear="yes" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page3" linear="yes" properties="page-spread-right"/>');
        });

        it('should split wide spread into S1 and S2 and apply backward pass for RTL', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'spread.jpg', async: async () => createMockBlob({ width: 2000, height: 1000 }) },
                { name: 'p2.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) }
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
            expect(opf).toContain('<itemref idref="page0" linear="yes" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page1" linear="yes" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page2" linear="yes" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page3" linear="yes" properties="page-spread-right"/>');
        });

        it('should split wide spread into S1 and S2 and apply backward pass for LTR', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'spread.jpg', async: async () => createMockBlob({ width: 2000, height: 1000 }) },
                { name: 'p2.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) }
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
            expect(opf).toContain('<itemref idref="page0" linear="yes" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page1" linear="yes" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page2" linear="yes" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page3" linear="yes" properties="page-spread-left"/>');
        });

        it('should handle three single pages before spread in RTL', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'p3.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'spread.jpg', async: async () => createMockBlob({ width: 2000, height: 1000 }) }
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
            expect(opf).toContain('<itemref idref="page0" linear="yes" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page1" linear="yes" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page2" linear="yes" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page3" linear="yes" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page4" linear="yes" properties="page-spread-left"/>');
        });
    });

    describe('Scenario 2: Unsplit wide spread with isOptimizeEnabled = false', () => {
        it('should assign properties="page-spread-center" for unsplit wide spreads in RTL', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'spread.jpg', async: async () => createMockBlob({ width: 2000, height: 1000 }) },
                { name: 'p2.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) }
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
            expect(opf).toContain('<itemref idref="page0" linear="yes" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page1" linear="yes" properties="page-spread-center"/>');
            expect(opf).toContain('<itemref idref="page2" linear="yes" properties="page-spread-right"/>');
        });

        it('should assign properties="page-spread-center" for unsplit wide spreads in LTR', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'spread.jpg', async: async () => createMockBlob({ width: 2000, height: 1000 }) },
                { name: 'p2.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) }
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
            expect(opf).toContain('<itemref idref="page0" linear="yes" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page1" linear="yes" properties="page-spread-center"/>');
            expect(opf).toContain('<itemref idref="page2" linear="yes" properties="page-spread-left"/>');
        });
    });

    describe('Scenario 3: Custom cover spread property', () => {
        it('should assign properties="page-spread-right" to custom cover in RTL', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) }
            ];
            const customCover = createMockBlob({
                width: 1000,
                height: 1500,
                type: 'image/jpeg'
            });
            customCover.name = 'custom_cover.jpg';

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
            expect(opf).toContain('<itemref idref="cover-page" linear="yes" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page0" linear="yes" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page1" linear="yes" properties="page-spread-right"/>');
        });

        it('should assign properties="page-spread-left" to custom cover in LTR', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) }
            ];
            const customCover = createMockBlob({
                width: 1000,
                height: 1500,
                type: 'image/jpeg'
            });
            customCover.name = 'custom_cover.jpg';

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
            expect(opf).toContain('<itemref idref="cover-page" linear="yes" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page0" linear="yes" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page1" linear="yes" properties="page-spread-left"/>');
        });
    });

    describe('Scenario 4: Landscape spread disabled (isLandscapeSpread = false)', () => {
        it('should not include page-spread properties on itemref elements and set spread to auto in RTL', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'spread.jpg', async: async () => createMockBlob({ width: 2000, height: 1000 }) },
                { name: 'p2.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) }
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
            expect(opf).toContain('<itemref idref="page0" linear="yes"/>');
            expect(opf).toContain('<itemref idref="page1" linear="yes"/>');
            expect(opf).toContain('<itemref idref="page2" linear="yes"/>');
        });

        it('should not include page-spread properties in LTR when isLandscapeSpread is false', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) }
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
            expect(opf).toContain('<itemref idref="page0" linear="yes"/>');
            expect(opf).toContain('<itemref idref="page1" linear="yes"/>');
        });
    });

    describe('Scenario 5: Landscape spread with isOffsetFirstPage = true', () => {
        it('should offset initial page spread in RTL (left, right, left, right)', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'p3.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'p4.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) }
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
            expect(opf).toContain('<itemref idref="page0" linear="yes" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page1" linear="yes" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page2" linear="yes" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page3" linear="yes" properties="page-spread-right"/>');
        });

        it('should offset initial page spread in LTR (right, left, right, left)', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'p3.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'p4.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) }
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
            expect(opf).toContain('<itemref idref="page0" linear="yes" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page1" linear="yes" properties="page-spread-left"/>');
            expect(opf).toContain('<itemref idref="page2" linear="yes" properties="page-spread-right"/>');
            expect(opf).toContain('<itemref idref="page3" linear="yes" properties="page-spread-left"/>');
        });
    });

    describe('XHTML page alignment and CSS reset', () => {
        it('should include style.css and KCC alignment structure in generated XHTML pages', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'Reset Test',
                author: 'Author Reset',
                jszipLib: MockJSZip
            });

            const styleCss = filesCreated['OEBPS/Text/style.css'];
            expect(styleCss).toContain('@page');
            expect(styleCss).toContain('margin: 0');
            expect(styleCss).toContain('body');
            expect(styleCss).toContain('display: block');

            const page0 = filesCreated['OEBPS/Text/page_0000.xhtml'];
            expect(page0).toContain('<link href="style.css" type="text/css" rel="stylesheet"/>');
            expect(page0).toContain('<div style="text-align:center;">');
            expect(page0).toContain('<div style="display:none;">.</div>');
        });

        it('should always use text-align center for spread pages in RTL landscape (e-reader handles positioning)', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'RTL Alignment Test',
                author: 'Author RTL',
                readingDirection: READING_DIRECTIONS.RTL,
                isLandscapeSpread: true,
                isOffsetFirstPage: false,
                jszipLib: MockJSZip
            });

            const page0 = filesCreated['OEBPS/Text/page_0000.xhtml'];
            const page1 = filesCreated['OEBPS/Text/page_0001.xhtml'];
            const opf = filesCreated['OEBPS/content.opf'];

            expect(page0).toContain('<div style="text-align:center;">');
            expect(page1).toContain('<div style="text-align:center;">');
            // No inline JS orientation detection
            expect(page0).not.toContain('<script');
            expect(page1).not.toContain('<script');
            // No scripted properties in manifest
            expect(opf).not.toContain('properties="scripted"');
        });

        it('should always use text-align center for spread pages in LTR landscape (e-reader handles positioning)', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'LTR Alignment Test',
                author: 'Author LTR',
                readingDirection: READING_DIRECTIONS.LTR,
                isLandscapeSpread: true,
                isOffsetFirstPage: false,
                jszipLib: MockJSZip
            });

            const page0 = filesCreated['OEBPS/Text/page_0000.xhtml'];
            const page1 = filesCreated['OEBPS/Text/page_0001.xhtml'];
            const opf = filesCreated['OEBPS/content.opf'];

            expect(page0).toContain('<div style="text-align:center;">');
            expect(page1).toContain('<div style="text-align:center;">');
            // No inline JS orientation detection
            expect(page0).not.toContain('<script');
            expect(page1).not.toContain('<script');
            // No scripted properties in manifest
            expect(opf).not.toContain('properties="scripted"');
        });

        it('should align unsplit wide spread page to center in landscape mode', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'spread.jpg', async: async () => createMockBlob({ width: 2000, height: 1000 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'Center Wide Spread Alignment',
                author: 'Author Center',
                isOptimizeEnabled: false,
                isLandscapeSpread: true,
                jszipLib: MockJSZip
            });

            const page0 = filesCreated['OEBPS/Text/page_0000.xhtml'];
            expect(page0).toContain('<div style="text-align:center;">');
        });

        it('should include style.css and text-align center in custom cover XHTML', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) }
            ];
            const customCover = createMockBlob({ width: 1000, height: 1500 });
            customCover.name = 'custom_cover.jpg';

            await createEpub({
                images: mockImages,
                title: 'Cover Alignment Test',
                author: 'Author Cover',
                coverSource: COVER_SOURCES.CUSTOM,
                customCoverFile: customCover,
                isLandscapeSpread: true,
                jszipLib: MockJSZip
            });

            const coverPage = filesCreated['OEBPS/Text/cover.xhtml'];
            expect(coverPage).toContain('<link href="style.css" type="text/css" rel="stylesheet"/>');
            expect(coverPage).toContain('<div style="text-align:center;">');
            expect(coverPage).toContain('<div style="display:none;">.</div>');
        });
    });

    describe('Table of Contents and Chapter navigation', () => {
        it('should build Ncx and Nav with single book entry when no chapters provided', () => {
            const ncx = buildNcx({
                title: 'Solo & Book',
                bookUuid: 'uuid-123',
                pages: [{ pageName: 'page_0000.xhtml' }, { pageName: 'page_0001.xhtml' }]
            });
            expect(ncx).toContain('<docTitle><text>Solo &amp; Book</text></docTitle>');
            expect(ncx).toContain('<navPoint id="navPoint-1">');
            expect(ncx).toContain('<navLabel><text>Solo &amp; Book</text></navLabel>');
            expect(ncx).toContain('<content src="Text/page_0000.xhtml"/>');
            expect(ncx).not.toContain('navPoint-2');

            const nav = buildNav({
                title: 'Solo & Book',
                pages: [{ pageName: 'page_0000.xhtml' }, { pageName: 'page_0001.xhtml' }]
            });
            expect(nav).toContain('<nav epub:type="toc" id="toc">');
            expect(nav).toContain('<li><a href="Text/page_0000.xhtml">Solo &amp; Book</a></li>');
            expect(nav).toContain('<nav epub:type="page-list">');
            expect(nav).toContain('<li><a href="Text/page_0000.xhtml">1</a></li>');
            expect(nav).toContain('<li><a href="Text/page_0001.xhtml">2</a></li>');
        });

        it('should build Ncx and Nav with multiple chapter entries when chapters are provided', () => {
            const chapters = [
                { id: 'ch-1', title: 'Chapter 1: Intro', pageName: 'page_0000.xhtml' },
                { id: 'ch-2', title: 'Chapter 2: Climax', pageName: 'page_0005.xhtml' }
            ];
            const pages = [
                { pageName: 'page_0000.xhtml' },
                { pageName: 'page_0001.xhtml' },
                { pageName: 'page_0005.xhtml' }
            ];

            const ncx = buildNcx({ title: 'Manga Vol 1', bookUuid: 'uuid-123', chapters, pages });
            expect(ncx).toContain('<navPoint id="ch-1">');
            expect(ncx).toContain('<navLabel><text>Chapter 1: Intro</text></navLabel>');
            expect(ncx).toContain('<content src="Text/page_0000.xhtml"/>');
            expect(ncx).toContain('<navPoint id="ch-2">');
            expect(ncx).toContain('<navLabel><text>Chapter 2: Climax</text></navLabel>');
            expect(ncx).toContain('<content src="Text/page_0005.xhtml"/>');

            const nav = buildNav({ title: 'Manga Vol 1', chapters, pages });
            expect(nav).toContain('<li><a href="Text/page_0000.xhtml">Chapter 1: Intro</a></li>');
            expect(nav).toContain('<li><a href="Text/page_0005.xhtml">Chapter 2: Climax</a></li>');
            expect(nav).toContain('<li><a href="Text/page_0000.xhtml">1</a></li>');
            expect(nav).toContain('<li><a href="Text/page_0001.xhtml">2</a></li>');
            expect(nav).toContain('<li><a href="Text/page_0005.xhtml">3</a></li>');
        });

        it('should map chapters with startIndex to target generated pageName in createEpub', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) },
                { name: 'spread.jpg', async: async () => createMockBlob({ width: 2000, height: 1000 }) }, // split -> page 1, 2
                { name: 'p2.jpg', async: async () => createMockBlob({ width: 1000, height: 1500 }) } // -> page 3
            ];

            await createEpub({
                images: mockImages,
                chapters: [
                    { title: 'Chapter 1', startIndex: 0 },
                    { title: 'Chapter 2', startIndex: 2 }
                ],
                title: 'Chapter Mapping Test',
                author: 'Author',
                isOptimizeEnabled: true,
                jszipLib: MockJSZip
            });

            const ncx = filesCreated['OEBPS/toc.ncx'];
            const nav = filesCreated['OEBPS/nav.xhtml'];

            expect(ncx).toContain('<navPoint id="navPoint-1">');
            expect(ncx).toContain('<navLabel><text>Chapter 1</text></navLabel>');
            expect(ncx).toContain('<content src="Text/page_0000.xhtml"/>');

            expect(ncx).toContain('<navPoint id="navPoint-2">');
            expect(ncx).toContain('<navLabel><text>Chapter 2</text></navLabel>');
            expect(ncx).toContain('<content src="Text/page_0003.xhtml"/>');

            expect(nav).toContain('<li><a href="Text/page_0000.xhtml">Chapter 1</a></li>');
            expect(nav).toContain('<li><a href="Text/page_0003.xhtml">Chapter 2</a></li>');
        });

        it('should process images concurrently in batches while preserving page order', async () => {
            const { MockJSZip, filesCreated } = createMockZip();
            const mockImages = Array.from({ length: 9 }, (_, i) => ({
                name: `page_${i + 1}.jpg`,
                async: async () => {
                    // simulate variable network/disk latency
                    await new Promise(resolve => setTimeout(resolve, (9 - i) * 5));
                    return createMockBlob({ width: 1000, height: 1500 });
                }
            }));

            await createEpub({
                images: mockImages,
                title: 'Concurrency Order Test',
                author: 'Tester',
                jszipLib: MockJSZip
            });

            for (let i = 0; i < 9; i++) {
                const pageFile = `OEBPS/Text/page_${i.toString().padStart(4, '0')}.xhtml`;
                expect(filesCreated[pageFile]).toBeDefined();
                expect(filesCreated[pageFile]).toContain(`image_${i.toString().padStart(4, '0')}.jpg`);
            }
        });
    });
});
