import { setupBrowserMocks } from './mocks/browser-mocks.js';
import { getSpineDirectionAttribute, createEpub } from '../src/js/modules/epub-builder.js';
import { READING_DIRECTIONS } from '../src/js/modules/constants.js';

setupBrowserMocks();

describe('epub-builder module', () => {
    describe('getSpineDirectionAttribute', () => {
        it('should return page-progression-direction="ltr" for LTR', () => {
            expect(getSpineDirectionAttribute(READING_DIRECTIONS.LTR)).toBe(' page-progression-direction="ltr"');
        });

        it('should return page-progression-direction="rtl" for RTL', () => {
            expect(getSpineDirectionAttribute(READING_DIRECTIONS.RTL)).toBe(' page-progression-direction="rtl"');
        });
    });

    describe('createEpub', () => {
        it('should throw an error if JSZip is not available', async () => {
            await expect(createEpub({ images: [], jszipLib: null })).rejects.toThrow('JSZip library is not available');
        });

        it('should build EPUB structure with OPF and manifest', async () => {
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
                    return new globalThis.Blob(['mock-epub'], { type: options.mimeType });
                }
            };

            const mockImages = [
                {
                    name: 'page_1.jpg',
                    async: jest.fn().mockResolvedValue(new globalThis.Blob([], { type: 'image/jpeg' }))
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
});
