import { SUPPORTED_IMAGE_EXTENSIONS } from './constants.js';

/**
 * Extracts and naturally sorts image files from a CBZ or ZIP archive.
 * @param {File | Blob} file 
 * @param {typeof import('jszip')} [jszipLib] 
 * @returns {Promise<Array<import('jszip').JSZipObject>>}
 */
export async function extractImagesFromCbz(file, jszipLib) {
    const ZipConstructor = jszipLib || (typeof window !== 'undefined' ? window.JSZip : globalThis.JSZip);
    if (!ZipConstructor) {
        throw new Error('JSZip library is not available');
    }

    const jszip = new ZipConstructor();
    const cbzData = await jszip.loadAsync(file);
    const imageFiles = [];

    cbzData.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir && relativePath.match(SUPPORTED_IMAGE_EXTENSIONS)) {
            imageFiles.push(zipEntry);
        }
    });

    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    imageFiles.sort((a, b) => collator.compare(a.name, b.name));

    const chapters = [];
    let currentDir = null;

    for (let i = 0; i < imageFiles.length; i++) {
        const normName = imageFiles[i].name.replace(/\\/g, '/');
        const slashIdx = normName.lastIndexOf('/');
        const dir = slashIdx !== -1 ? normName.substring(0, slashIdx) : '';

        if (dir) {
            if (dir !== currentDir) {
                currentDir = dir;
                chapters.push({
                    title: dir,
                    startIndex: i
                });
            }
        } else {
            currentDir = '';
        }
    }

    imageFiles.chapters = chapters;
    return imageFiles;
}
