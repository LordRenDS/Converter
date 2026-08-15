import { describe, it, expect } from '@jest/globals';
import { extractImagesFromCbz } from '../src/js/modules/cbz-reader.js';

describe('cbz-reader module', () => {
    it('should throw an error if JSZip is not available', async () => {
        const dummyFile = new globalThis.Blob([''], { type: 'application/zip' });
        await expect(extractImagesFromCbz(dummyFile, null)).rejects.toThrow('JSZip library is not available');
    });

    it('should extract and naturally sort image files from an archive', async () => {
        const mockEntries = [
            { name: 'chapter/page_10.jpg', dir: false },
            { name: 'chapter/page_2.png', dir: false },
            { name: 'chapter/page_1.jpeg', dir: false },
            { name: 'chapter/metadata.xml', dir: false },
            { name: 'chapter/subfolder/', dir: true }
        ];

        const MockJSZip = class {
            async loadAsync() {
                return {
                    forEach: (callback) => {
                        mockEntries.forEach((entry) => callback(entry.name, entry));
                    }
                };
            }
        };

        const dummyFile = new globalThis.Blob([''], { type: 'application/zip' });
        const result = await extractImagesFromCbz(dummyFile, MockJSZip);

        expect(result).toHaveLength(3);
        expect(result.map(entry => entry.name)).toEqual([
            'chapter/page_1.jpeg',
            'chapter/page_2.png',
            'chapter/page_10.jpg'
        ]);
        expect(result.chapters).toEqual([
            { title: 'chapter', startIndex: 0 }
        ]);
    });

    it('should detect multiple subdirectory chapters in natural order', async () => {
        const mockEntries = [
            { name: 'Chapter 2/01.jpg', dir: false },
            { name: 'Chapter 1/02.jpg', dir: false },
            { name: 'Chapter 1/01.jpg', dir: false },
            { name: 'Chapter 2/02.jpg', dir: false }
        ];

        const MockJSZip = class {
            async loadAsync() {
                return {
                    forEach: (callback) => {
                        mockEntries.forEach((entry) => callback(entry.name, entry));
                    }
                };
            }
        };

        const dummyFile = new globalThis.Blob([''], { type: 'application/zip' });
        const result = await extractImagesFromCbz(dummyFile, MockJSZip);

        expect(result).toHaveLength(4);
        expect(result.chapters).toEqual([
            { title: 'Chapter 1', startIndex: 0 },
            { title: 'Chapter 2', startIndex: 2 }
        ]);
    });

    it('should set empty chapters array for flat image archives', async () => {
        const mockEntries = [
            { name: 'page_02.jpg', dir: false },
            { name: 'page_01.jpg', dir: false }
        ];

        const MockJSZip = class {
            async loadAsync() {
                return {
                    forEach: (callback) => {
                        mockEntries.forEach((entry) => callback(entry.name, entry));
                    }
                };
            }
        };

        const dummyFile = new globalThis.Blob([''], { type: 'application/zip' });
        const result = await extractImagesFromCbz(dummyFile, MockJSZip);

        expect(result).toHaveLength(2);
        expect(result.chapters).toEqual([]);
    });
});
