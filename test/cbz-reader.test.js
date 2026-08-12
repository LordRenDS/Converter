import { setupBrowserMocks } from './mocks/browser-mocks.js';
import { extractImagesFromCbz } from '../src/js/modules/cbz-reader.js';

setupBrowserMocks();

describe('cbz-reader module', () => {
    it('should throw an error if JSZip is not available', async () => {
        const dummyFile = new Blob([''], { type: 'application/zip' });
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

        const dummyFile = new Blob([''], { type: 'application/zip' });
        const result = await extractImagesFromCbz(dummyFile, MockJSZip);

        expect(result).toHaveLength(3);
        expect(result.map(entry => entry.name)).toEqual([
            'chapter/page_1.jpeg',
            'chapter/page_2.png',
            'chapter/page_10.jpg'
        ]);
    });
});
