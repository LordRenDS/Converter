import { READING_DIRECTIONS, COVER_SOURCES, OUTPUT_FORMATS, DEFAULT_JPEG_QUALITY, DEVICE_PRESETS, getDevicePreset, SPREAD_MODES, SPREAD_POSITIONS } from './constants.js';
import { blobToImage, processSpreadImage } from './image-processor.js';
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
 * Builds the NCX Table of Contents (EPUB 2 / Kindle).
 * @param {Object} options
 * @param {string} options.title
 * @param {string} options.bookUuid
 * @param {Array<{id: string, pageName: string, title?: string}>} options.pages
 * @returns {string}
 */
export function buildNcx({ title = 'Untitled', bookUuid = '12345-67890', pages = [] }) {
    const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const navPoints = pages.map((page, index) => {
        const safePageTitle = (page.title || `Page ${index}`).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const navId = page.id || `navPoint-${index + 1}`;
        return `    <navPoint id="${navId}">\n      <navLabel><text>${safePageTitle}</text></navLabel>\n      <content src="Text/${page.pageName}"/>\n    </navPoint>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<ncx version="2005-1" xml:lang="en" xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${bookUuid}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
    <meta name="generated" content="true"/>
  </head>
  <docTitle><text>${safeTitle}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`;
}

/**
 * Builds the EPUB 3 Navigation Document (nav.xhtml).
 * @param {Object} options
 * @param {string} options.title
 * @param {Array<{pageName: string, title?: string}>} options.pages
 * @returns {string}
 */
export function buildNav({ title = 'Untitled', pages = [] }) {
    const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const listItems = pages.map((page, index) => {
        const safePageTitle = (page.title || `Page ${index}`).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `      <li><a href="Text/${page.pageName}">${safePageTitle}</a></li>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>${safeTitle}</title>
  <meta charset="utf-8"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <ol>
${listItems}
    </ol>
  </nav>
  <nav epub:type="page-list">
    <ol>
${listItems}
    </ol>
  </nav>
</body>
</html>`;
}

/**
 * Creates an EPUB 3 Blob from a list of image entries and settings.
 * @param {Object} options
 * @param {Array<import('jszip').JSZipObject>} options.images
 * @param {string} options.title
 * @param {string} options.author
 * @param {boolean} [options.isOptimizeEnabled=false]
 * @param {string} [options.spreadMode=SPREAD_MODES.SPLIT]
 * @param {boolean} [options.spreadNoRotate=false]
 * @param {boolean} [options.spreadRotateRight=false]
 * @param {string} [options.spreadPosition='after']
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
    spreadMode = undefined,
    spreadNoRotate = false,
    spreadRotateRight = false,
    spreadPosition = SPREAD_POSITIONS.AFTER,
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

    const effectiveSpreadMode = spreadMode !== undefined
        ? spreadMode
        : (isOptimizeEnabled ? SPREAD_MODES.SPLIT : SPREAD_MODES.OFF);

    let effectiveDevice = null;
    if (targetDevice) {
        effectiveDevice = getDevicePreset(targetDevice);
    } else if (isKindleFitEnabled) {
        effectiveDevice = DEVICE_PRESETS.KINDLE_PW12;
    }

    const epubZip = new ZipConstructor();

    epubZip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

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

    const styleCss = `@page {
  margin: 0;
}
body {
  display: block;
  margin: 0;
  padding: 0;
}
`;
    textFolder.file('style.css', styleCss);

    let manifestItems = `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\n<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>\n<item id="css" href="Text/style.css" media-type="text/css"/>\n`;
    const spinePages = [];
    const pagesToGenerate = [];
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
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Cover</title>
  <link href="style.css" type="text/css" rel="stylesheet"/>
  <meta name="viewport" content="width=${img.width}, height=${img.height}"/>
</head>
<body>
  <div style="text-align:center;">
    <div style="display:none;">.</div>
    <img width="${img.width}" height="${img.height}" src="../Images/${imgName}" />
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
        const blobData = await imgData.async('blob');
        const img = await blobToImage(blobData);

        const processedImages = await processSpreadImage(img, blobData, {
            spreadMode: effectiveSpreadMode,
            readingDirection,
            noRotate: spreadNoRotate,
            rotateRight: spreadRotateRight,
            spreadPosition,
            targetDeviceOrFit: effectiveDevice,
            isGrayscale: isGrayscaleEnabled,
            outputFormat,
            quality: jpegQuality,
            isUpscale: isUpscaleEnabled
        });

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

            const mediaType = procImg.mimeType.startsWith('image/')
                ? procImg.mimeType
                : `image/${procImg.mimeType}`;

            manifestItems += `<item id="${id}" href="Images/${imgName}" media-type="${mediaType}"${properties}/>\n`;

            const pageName = `page_${globalImageCounter.toString().padStart(4, '0')}.xhtml`;
            const pageId = `page${globalImageCounter}`;

            const spineIndex = spinePages.length;
            spinePages.push({ id: pageId, type: procImg.type });

            pagesToGenerate.push({
                pageName,
                pageId,
                spineIndex,
                title: `Page ${globalImageCounter}`,
                width: procImg.width,
                height: procImg.height,
                imgName,
                globalImageCounter
            });

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

    for (const page of pagesToGenerate) {
        manifestItems += `<item id="${page.pageId}" href="Text/${page.pageName}" media-type="application/xhtml+xml"/>\n`;

        const xhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>${page.title}</title>
  <link href="style.css" type="text/css" rel="stylesheet"/>
  <meta name="viewport" content="width=${page.width}, height=${page.height}"/>
</head>
<body>
  <div style="text-align:center;">
    <div style="display:none;">.</div>
    <img width="${page.width}" height="${page.height}" src="../Images/${page.imgName}" />
  </div>
</body>
</html>`;
        textFolder.file(page.pageName, xhtml);
    }

    let spineItems = '';
    for (let i = 0; i < spinePages.length; i++) {
        const pageEntry = spinePages[i];
        const spreadProp = spreadProps[i];
        const propAttr = getPageSpreadProperty(spreadProp);
        spineItems += `<itemref idref="${pageEntry.id}" linear="yes"${propAttr}/>\n`;
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
    const isoDate = new Date().toISOString().slice(0, 19) + 'Z';

    const navPages = [];
    if (coverSource === COVER_SOURCES.CUSTOM && customCoverFile) {
        navPages.push({ id: 'cover-page', pageName: 'cover.xhtml', title: 'Cover' });
    }
    for (const page of pagesToGenerate) {
        navPages.push({ id: page.pageId, pageName: page.pageName, title: page.title });
    }

    const ncxContent = buildNcx({ title, bookUuid, pages: navPages });
    oebps.file('toc.ncx', ncxContent);

    const navContent = buildNav({ title, pages: navPages });
    oebps.file('nav.xhtml', navContent);

    const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0" prefix="rendition: http://www.idpf.org/vocab/rendition/#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${safeTitle}</dc:title>
    <dc:creator opf:role="aut">${safeAuthor}</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="BookId">urn:uuid:${bookUuid}</dc:identifier>
    <meta property="dcterms:modified">${isoDate}</meta>
    ${coverId ? `<meta name="cover" content="${coverId}"/>` : ''}
    <meta name="fixed-layout" content="true"/>
    <meta name="original-resolution" content="${opfResolution}"/>
    <meta name="book-type" content="comic"/>
    <meta name="primary-writing-mode" content="${primaryWritingMode}"/>
    <meta name="zero-gutter" content="true"/>
    <meta name="zero-margin" content="true"/>
    <meta name="ke-border-color" content="#FFFFFF"/>
    <meta name="ke-border-width" content="0"/>
    <meta name="orientation-lock" content="none"/>
    <meta name="region-mag" content="false"/>
    <meta property="rendition:spread">${isLandscapeSpread ? 'landscape' : 'auto'}</meta>
    <meta property="rendition:layout">pre-paginated</meta>
  </metadata>
  <manifest>
    ${manifestItems}  </manifest>
  <spine${spineDirectionAttr} toc="ncx">
    ${spineItems}  </spine>
</package>`;
    oebps.file('content.opf', contentOpf);

    onProgress(90);

    const epubBlob = await epubZip.generateAsync({
        type: 'blob',
        mimeType: 'application/epub+zip',
        compression: 'STORE'
    });

    return epubBlob;
}

