import { READING_DIRECTIONS, COVER_SOURCES, OUTPUT_FORMATS, DEFAULT_JPEG_QUALITY, DEVICE_PRESETS, getDevicePreset } from './constants.js';
import { isSpread, getSplitOrder, blobToImage, processImage, splitImage } from './image-processor.js';
import { PAGE_TYPES, calculatePageSpreads, getPageSpreadProperty } from './spread-calculator.js';

/**
 * Returns the EPUB spine attribute for page progression direction.
 * @param {string} direction - 'ltr' or 'rtl'
 * @returns {string}
 */
export function getSpineDirectionAttribute(direction) {
    return direction === READING_DIRECTIONS.RTL
        ? ' page-progression-direction="rtl"'
        : ' page-progression-direction="ltr"';
}

/**
 * Creates an EPUB 3 Blob from a list of image entries and settings.
 * @param {Object} options
 * @param {Array<import('jszip').JSZipObject>} options.images
 * @param {string} options.title
 * @param {string} options.author
 * @param {boolean} [options.isOptimizeEnabled=false]
 * @param {string} [options.readingDirection='ltr']
 * @param {string} [options.outputFormat='original']
 * @param {File|Blob|null} [options.customCoverFile=null]
 * @param {string} [options.coverSource='page']
 * @param {number} [options.coverPageNumber=1]
 * @param {string|Object|null} [options.targetDevice=null]
 * @param {boolean} [options.isUpscaleEnabled=true]
 * @param {boolean} [options.isKindleFitEnabled=false]
 * @param {boolean} [options.isGrayscaleEnabled=false]
 * @param {number} [options.jpegQuality=0.85]
 * @param {boolean} [options.isLandscapeSpread=false]
 * @param {boolean} [options.isOffsetFirstPage=false]
 * @param {(percent: number, message?: string) => void} [options.onProgress]
 * @param {typeof import('jszip')} [options.jszipLib]
 * @returns {Promise<Blob>}
 */
export async function createEpub({
    images,
    title = 'Untitled',
    author = 'Unknown Author',
    isOptimizeEnabled = false,
    readingDirection = READING_DIRECTIONS.LTR,
    outputFormat = OUTPUT_FORMATS.ORIGINAL,
    customCoverFile = null,
    coverSource = COVER_SOURCES.PAGE,
    coverPageNumber = 1,
    targetDevice = null,
    isUpscaleEnabled = true,
    isKindleFitEnabled = false,
    isGrayscaleEnabled = false,
    jpegQuality = DEFAULT_JPEG_QUALITY,
    isLandscapeSpread = false,
    isOffsetFirstPage = false,
    onProgress = () => {},
    jszipLib
}) {
    const ZipConstructor = jszipLib || (typeof window !== 'undefined' ? window.JSZip : globalThis.JSZip);
    if (!ZipConstructor) {
        throw new Error('JSZip library is not available');
    }

    let effectiveDevice = null;
    if (targetDevice) {
        effectiveDevice = getDevicePreset(targetDevice);
    } else if (isKindleFitEnabled) {
        effectiveDevice = DEVICE_PRESETS.KINDLE_PW12;
    }

    const epubZip = new ZipConstructor();

    epubZip.file('mimetype', 'application/epub+zip');

    const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
    epubZip.folder('META-INF').file('container.xml', containerXml);

    const oebps = epubZip.folder('OEBPS');
    const imagesFolder = oebps.folder('Images');
    const textFolder = oebps.folder('Text');

    let manifestItems = '';
    const spinePages = [];
    let globalImageCounter = 0;
    let coverId = null;
    let maxWidth = 0;
    let maxHeight = 0;

    // Process custom cover if selected
    if (coverSource === COVER_SOURCES.CUSTOM && customCoverFile) {
        const ext = customCoverFile.name.split('.').pop().toLowerCase();
        const mimeType = ext === 'jpg' ? 'jpeg' : ext;
        const blobData = customCoverFile;

        const imgName = `cover.${ext}`;
        imagesFolder.file(imgName, blobData);

        coverId = 'cover-image';
        manifestItems += `<item id="${coverId}" href="Images/${imgName}" media-type="image/${mimeType}" properties="cover-image"/>\n`;

        const coverPageName = 'cover.xhtml';
        const img = await blobToImage(blobData);
        if (img.width > maxWidth) maxWidth = img.width;
        if (img.height > maxHeight) maxHeight = img.height;

        const xhtml = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Cover</title>
  <meta name="viewport" content="width=${img.width}, height=${img.height}"/>
  <style type="text/css">
    body { margin: 0; padding: 0; background-color: #FFFFFF; }
    div.page-container { text-align: center; margin: 0; padding: 0; }
    img { margin: 0; padding: 0; }
  </style>
</head>
<body>
  <div class="page-container">
    <img width="${img.width}" height="${img.height}" src="../Images/${imgName}" alt="Cover" />
  </div>
</body>
</html>`;
        textFolder.file(coverPageName, xhtml);

        const coverPageId = 'cover-page';
        manifestItems += `<item id="${coverPageId}" href="Text/${coverPageName}" media-type="application/xhtml+xml"/>\n`;

        spinePages.push({ id: coverPageId, type: PAGE_TYPES.NORMAL });
    }

    // Process images
    for (let i = 0; i < images.length; i++) {
        const imgData = images[i];
        let ext = imgData.name.split('.').pop().toLowerCase();
        let mimeType = ext === 'jpg' ? 'jpeg' : ext;

        const blobData = await imgData.async('blob');
        const processedImages = [];

        const img = await blobToImage(blobData);
        let isSpreadProcessed = false;

        if (isOptimizeEnabled) {
            if (isSpread(img.width, img.height)) {
                isSpreadProcessed = true;
                const halves = await splitImage(img, outputFormat, jpegQuality);
                const order = getSplitOrder(readingDirection);

                if (outputFormat === OUTPUT_FORMATS.JPEG) {
                    ext = 'jpg';
                    mimeType = 'jpeg';
                } else {
                    ext = 'png';
                    mimeType = 'png';
                }

                const leftImg = await blobToImage(halves.left);
                const rightImg = await blobToImage(halves.right);

                const leftRes = await processImage(leftImg, halves.left, effectiveDevice, isGrayscaleEnabled, mimeType, outputFormat, jpegQuality, isUpscaleEnabled);
                const rightRes = await processImage(rightImg, halves.right, effectiveDevice, isGrayscaleEnabled, mimeType, outputFormat, jpegQuality, isUpscaleEnabled);

                if (order[0] === 'left') {
                    processedImages.push({ blob: leftRes.blob, ext, mimeType, suffix: '_left', width: leftRes.width, height: leftRes.height, type: PAGE_TYPES.SPREAD_PART_1 });
                    processedImages.push({ blob: rightRes.blob, ext, mimeType, suffix: '_right', width: rightRes.width, height: rightRes.height, type: PAGE_TYPES.SPREAD_PART_2 });
                } else {
                    processedImages.push({ blob: rightRes.blob, ext, mimeType, suffix: '_right', width: rightRes.width, height: rightRes.height, type: PAGE_TYPES.SPREAD_PART_1 });
                    processedImages.push({ blob: leftRes.blob, ext, mimeType, suffix: '_left', width: leftRes.width, height: leftRes.height, type: PAGE_TYPES.SPREAD_PART_2 });
                }
            }
        }

        if (!isSpreadProcessed) {
            const res = await processImage(img, blobData, effectiveDevice, isGrayscaleEnabled, mimeType, outputFormat, jpegQuality, isUpscaleEnabled);
            let finalExt = ext;
            let finalMime = mimeType;
            if (outputFormat === OUTPUT_FORMATS.JPEG) {
                finalExt = 'jpg';
                finalMime = 'jpeg';
            }
            const pageType = isSpread(img.width, img.height) ? PAGE_TYPES.SPREAD_CENTER : PAGE_TYPES.NORMAL;
            processedImages.push({ blob: res.blob, ext: finalExt, mimeType: finalMime, suffix: '', width: res.width, height: res.height, type: pageType });
        }

        for (const procImg of processedImages) {
            if (procImg.width > maxWidth) maxWidth = procImg.width;
            if (procImg.height > maxHeight) maxHeight = procImg.height;

            const imgName = `image_${globalImageCounter.toString().padStart(4, '0')}${procImg.suffix}.${procImg.ext}`;
            imagesFolder.file(imgName, procImg.blob);

            const id = `img${globalImageCounter}`;
            let properties = '';

            if (coverSource === COVER_SOURCES.PAGE && globalImageCounter === (coverPageNumber - 1)) {
                properties = ' properties="cover-image"';
                coverId = id;
            }

            manifestItems += `<item id="${id}" href="Images/${imgName}" media-type="image/${procImg.mimeType}"${properties}/>\n`;

            const pageName = `page_${globalImageCounter.toString().padStart(4, '0')}.xhtml`;
            const xhtml = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Page ${globalImageCounter}</title>
  <meta name="viewport" content="width=${procImg.width}, height=${procImg.height}"/>
  <style type="text/css">
    body { margin: 0; padding: 0; background-color: #FFFFFF; }
    div.page-container { text-align: center; margin: 0; padding: 0; }
    img { margin: 0; padding: 0; }
  </style>
</head>
<body>
  <div class="page-container">
    <img width="${procImg.width}" height="${procImg.height}" src="../Images/${imgName}" alt="Page ${globalImageCounter}" />
  </div>
</body>
</html>`;
            textFolder.file(pageName, xhtml);

            const pageId = `page${globalImageCounter}`;
            manifestItems += `<item id="${pageId}" href="Text/${pageName}" media-type="application/xhtml+xml"/>\n`;

            spinePages.push({ id: pageId, type: procImg.type });

            globalImageCounter++;
        }

        if (i % 5 === 0) {
            onProgress(40 + (i / images.length) * 40);
        }
    }

    onProgress(85);

    const spreadProps = calculatePageSpreads({
        pages: spinePages,
        readingDirection,
        isLandscapeSpread,
        isOffsetFirstPage
    });

    let spineItems = '';
    for (let i = 0; i < spinePages.length; i++) {
        const pageEntry = spinePages[i];
        const spreadProp = spreadProps[i];
        const propAttr = getPageSpreadProperty(spreadProp);
        spineItems += `<itemref idref="${pageEntry.id}"${propAttr}/>\n`;
    }

    const spineDirectionAttr = getSpineDirectionAttribute(readingDirection);
    const primaryWritingMode = readingDirection === READING_DIRECTIONS.RTL ? 'horizontal-rl' : 'horizontal-lr';

    let opfResolution;
    if (effectiveDevice && effectiveDevice.width > 0 && effectiveDevice.height > 0) {
        opfResolution = `${effectiveDevice.width}x${effectiveDevice.height}`;
    } else {
        opfResolution = `${maxWidth}x${maxHeight}`;
    }

    const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeAuthor = author.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const bookUuid = (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
        ? globalThis.crypto.randomUUID()
        : '12345-67890';

    const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0" prefix="rendition: http://www.idpf.org/vocab/rendition/#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${safeTitle}</dc:title>
    <dc:creator opf:role="aut">${safeAuthor}</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="BookId">urn:uuid:${bookUuid}</dc:identifier>
    ${coverId ? `<meta name="cover" content="${coverId}"/>` : ''}
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta property="rendition:spread">${isLandscapeSpread ? 'landscape' : 'auto'}</meta>
    <meta name="book-type" content="comic"/>
    <meta name="fixed-layout" content="true"/>
    <meta name="zero-gutter" content="true"/>
    <meta name="zero-margin" content="true"/>
    <meta name="ke-border-color" content="#FFFFFF"/>
    <meta name="ke-border-width" content="0"/>
    <meta name="orientation-lock" content="none"/>
    <meta name="primary-writing-mode" content="${primaryWritingMode}"/>
    <meta name="original-resolution" content="${opfResolution}"/>
  </metadata>
  <manifest>
    ${manifestItems}  </manifest>
  <spine${spineDirectionAttr}>
    ${spineItems}  </spine>
</package>`;
    oebps.file('content.opf', contentOpf);

    onProgress(90);

    const epubBlob = await epubZip.generateAsync({
        type: 'blob',
        mimeType: 'application/epub+zip',
        compression: 'DEFLATE',
        compressionOptions: {
            level: 9
        }
    });

    return epubBlob;
}
