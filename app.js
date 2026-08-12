// Export core logic for testing
const ConverterLogic = {
    isSpread: (width, height) => {
        return width > height;
    },
    getSplitOrder: (direction) => {
        // Returns ['left', 'right'] for ltr, ['right', 'left'] for rtl
        return direction === 'rtl' ? ['right', 'left'] : ['left', 'right'];
    },
    getSpineDirectionAttribute: (direction) => {
        return direction === 'rtl' ? ' page-progression-direction="rtl"' : ' page-progression-direction="ltr"';
    },

    blobToImage: function(blob) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(img.src);
                resolve(img);
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(blob);
        });
    },

    imageToBlob: function(canvasOrImg, mimeType, quality = 0.85) {
        return new Promise((resolve) => {
            let fullMimeType = mimeType;
            if (mimeType && !mimeType.startsWith('image/')) {
                fullMimeType = `image/${mimeType}`;
            }

            if (canvasOrImg instanceof HTMLCanvasElement) {
                canvasOrImg.toBlob(resolve, fullMimeType, quality);
            } else if (canvasOrImg instanceof HTMLImageElement) {
                const canvas = document.createElement('canvas');
                canvas.width = canvasOrImg.width;
                canvas.height = canvasOrImg.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(canvasOrImg, 0, 0);
                canvas.toBlob(resolve, fullMimeType, quality);
            }
        });
    },

    processImage: async function(img, originalBlob, isKindleFit, isGrayscale, mimeType, outputFormat = 'original', quality = 0.85) {
        let width = img.width;
        let height = img.height;
        let needsProcessing = false;

        if (isKindleFit) {
            const targetWidth = 1264;
            const targetHeight = 1680;

            if (width > targetWidth || height > targetHeight) {
                const ratio = Math.min(targetWidth / width, targetHeight / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
                needsProcessing = true;
            }
        }

        if (isGrayscale) {
            needsProcessing = true;
        }
        if (outputFormat === 'jpeg') {
            needsProcessing = true;
            mimeType = 'image/jpeg';
        }


        if (!needsProcessing) {
            if (originalBlob) {
                return { blob: originalBlob, width: img.width, height: img.height };
            } else {
                return { blob: await this.imageToBlob(img, mimeType, quality), width: img.width, height: img.height };
            }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        ctx.drawImage(img, 0, 0, width, height);

        if (isGrayscale) {
            const imgData = ctx.getImageData(0, 0, width, height);
            const data = imgData.data;
            for (let i = 0; i < data.length; i += 4) {
                const avg = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                data[i] = avg;
                data[i + 1] = avg;
                data[i + 2] = avg;
            }
            ctx.putImageData(imgData, 0, 0);
        }

        return { blob: await this.imageToBlob(canvas, mimeType, quality), width, height };
    },

    splitImage: async function(img, format, quality = 0.85) {
        const width = img.width;
        const height = img.height;
        const halfWidth = Math.floor(width / 2);

        const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png'; // Default to png if original doesn't specify well

        // Left half
        const leftCanvas = document.createElement('canvas');
        leftCanvas.width = halfWidth;
        leftCanvas.height = height;
        const leftCtx = leftCanvas.getContext('2d');
        leftCtx.drawImage(img, 0, 0, halfWidth, height, 0, 0, halfWidth, height);
        const leftBlob = await this.imageToBlob(leftCanvas, mimeType, quality);

        // Right half
        const rightCanvas = document.createElement('canvas');
        // Allow for odd-width images
        const rightWidth = width - halfWidth;
        rightCanvas.width = rightWidth;
        rightCanvas.height = height;
        const rightCtx = rightCanvas.getContext('2d');
        rightCtx.drawImage(img, halfWidth, 0, rightWidth, height, 0, 0, rightWidth, height);
        const rightBlob = await this.imageToBlob(rightCanvas, mimeType, quality);

        return { left: leftBlob, right: rightBlob, mimeType };
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ConverterLogic };
}

if (typeof document !== 'undefined') {
    document.addEventListener("DOMContentLoaded", () => {
        const dropZoneElement = document.getElementById("drop-zone");
        const inputElement = document.getElementById("file-input");
        const convertBtn = document.getElementById("convert-btn");
        const progressContainer = document.getElementById("progress-container");
        const progressFill = document.getElementById("progress-fill");
        const statusText = document.getElementById("status-text");
        const titleInput = document.getElementById("title-input");
        const authorInput = document.getElementById("author-input");
        const coverInput = document.getElementById("cover-input");
        const coverPageInput = document.getElementById("cover-page-input");
        const coverSourceRadios = document.querySelectorAll('input[name="cover-source"]');
        const coverPageInputGroup = document.getElementById("cover-page-input-group");
        const coverFileInputGroup = document.getElementById("cover-file-input-group");

        coverSourceRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.value === 'page') {
                    coverPageInputGroup.style.display = 'flex';
                    coverFileInputGroup.style.display = 'none';
                } else {
                    coverPageInputGroup.style.display = 'none';
                    coverFileInputGroup.style.display = 'flex';
                }
            });
        });

        const optimizeCheckbox = document.getElementById("optimize-checkbox");
        const directionSelect = document.getElementById("direction-select");
        const formatSelect = document.getElementById("format-select");
        const kindlePw12Checkbox = document.getElementById("kindle-pw12-checkbox");
        const grayscaleCheckbox = document.getElementById("grayscale-checkbox");
        const formatGroup = document.getElementById("format-group");

        const fileList = document.getElementById("file-list");
        const mergeGroup = document.getElementById("merge-group");
        const mergeCheckbox = document.getElementById("merge-checkbox");
        const qualityGroup = document.getElementById("quality-group");
        if (formatSelect && qualityGroup) {
            formatSelect.addEventListener("change", (e) => {
                if (e.target.value === 'jpeg') {
                    qualityGroup.style.display = 'flex';
                } else {
                    qualityGroup.style.display = 'none';
                }
            });
        }


        let currentFiles = [];

        function updateFileList() {
            fileList.innerHTML = '';
            if (currentFiles.length === 0) {
                fileList.style.display = 'none';
                convertBtn.disabled = true;
                mergeCheckbox.disabled = true;
                return;
            }

            fileList.style.display = 'block';
            convertBtn.disabled = false;

            if (currentFiles.length > 1) {
                mergeCheckbox.disabled = false;
            } else {
                mergeCheckbox.disabled = true;
            }

            currentFiles.forEach((file, index) => {
                const li = document.createElement('li');
                li.draggable = true;
                li.dataset.index = index;

                const nameSpan = document.createElement('span');
                nameSpan.textContent = file.name;

                const removeBtn = document.createElement('button');
                removeBtn.textContent = '×';
                removeBtn.className = 'remove-btn';
                removeBtn.onclick = () => {
                    currentFiles.splice(index, 1);
                    updateFileList();
                };

                li.appendChild(nameSpan);
                li.appendChild(removeBtn);

                // Drag and drop events for reordering
                li.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', index);
                    setTimeout(() => li.style.opacity = '0.5', 0);
                });

                li.addEventListener('dragend', () => {
                    li.style.opacity = '1';
                });

                li.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    li.classList.add('drag-over');
                });

                li.addEventListener('dragleave', () => {
                    li.classList.remove('drag-over');
                });

                li.addEventListener('drop', (e) => {
                    e.preventDefault();
                    li.classList.remove('drag-over');
                    const draggedIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
                    const targetIndex = index;

                    if (draggedIndex !== targetIndex) {
                        const draggedFile = currentFiles[draggedIndex];
                        currentFiles.splice(draggedIndex, 1);
                        currentFiles.splice(targetIndex, 0, draggedFile);
                        updateFileList();
                    }
                });

                fileList.appendChild(li);
            });
        }

        function handleFiles(files) {
            const newFiles = Array.from(files).filter(file => file.name.toLowerCase().endsWith('.cbz') || file.name.toLowerCase().endsWith('.zip'));
            if (newFiles.length > 0) {
                // Add and sort naturally
                currentFiles = [...currentFiles, ...newFiles];
                const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});
                currentFiles.sort((a, b) => collator.compare(a.name, b.name));
                updateFileList();
            }
        }


        // Drag & Drop logic
        dropZoneElement.addEventListener("click", () => {
            inputElement.click();
        });

        dropZoneElement.addEventListener("dragover", (e) => {
            e.preventDefault();
            dropZoneElement.classList.add("drop-zone--over");
        });

        ["dragleave", "dragend"].forEach((type) => {
            dropZoneElement.addEventListener(type, (e) => {
                dropZoneElement.classList.remove("drop-zone--over");
            });
        });

        dropZoneElement.addEventListener("drop", (e) => {
            e.preventDefault();
            dropZoneElement.classList.remove("drop-zone--over");

            if (e.dataTransfer.files.length) {
                handleFiles(e.dataTransfer.files);
            }
        });

        inputElement.addEventListener("change", (e) => {
            if (inputElement.files.length) {
                handleFiles(inputElement.files);
            }
            // Reset input so selecting the same file again triggers change event
            inputElement.value = '';
        });

        function setProgress(percent, text) {
            progressContainer.style.display = "block";
            progressFill.style.width = `${percent}%`;
            statusText.textContent = text;
        }


        // EPUB Generation logic

        async function createEpub(images, title, author, isOptimizeEnabled, readingDirection, outputFormat, customCoverFile, coverSource, coverPageNumber, isKindleFitEnabled, isGrayscaleEnabled, jpegQuality, onProgress, isLandscapeSpread, isOffsetFirstPage) {
            const epubZip = new JSZip();

            epubZip.file("mimetype", "application/epub+zip");

            const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
            epubZip.folder("META-INF").file("container.xml", containerXml);

            const oebps = epubZip.folder("OEBPS");
            const imagesFolder = oebps.folder("Images");
            const textFolder = oebps.folder("Text");

            let manifestItems = "";
            let spineItems = "";
            let globalImageCounter = 0;
            let startSide = readingDirection === 'rtl' ? 'right' : 'left';
            let endSide = readingDirection === 'rtl' ? 'left' : 'right';
            let expectedNextSide = isOffsetFirstPage ? startSide : endSide;
            let coverId = null;
            let maxWidth = 0;
            let maxHeight = 0;

            if (coverSource === 'custom' && customCoverFile) {
                // Process custom cover
                let ext = customCoverFile.name.split('.').pop().toLowerCase();
                let mimeType = ext === 'jpg' ? 'jpeg' : ext;
                let blobData = customCoverFile; // It's already a File/Blob

                const imgName = `cover.${ext}`;
                imagesFolder.file(imgName, blobData);

                coverId = 'cover-image';
                manifestItems += `<item id="${coverId}" href="Images/${imgName}" media-type="image/${mimeType}" properties="cover-image"/>\n`;

                const coverPageName = 'cover.xhtml';
                const img = await ConverterLogic.blobToImage(blobData);
                if (img.width > maxWidth) maxWidth = img.width;
                if (img.height > maxHeight) maxHeight = img.height;
                const xhtml = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Cover</title>
  <meta name="viewport" content="width=${img.width}, height=${img.height}"/>
  <style type="text/css">
    body { margin: 0; padding: 0; width: ${img.width}px; height: ${img.height}px; overflow: hidden; }
    img { width: 100%; height: 100%; display: block; margin: 0; padding: 0; object-fit: cover; }
  </style>
</head>
<body>
  <img src="../Images/${imgName}" alt="Cover" />
</body>
</html>`;
                textFolder.file(coverPageName, xhtml);

                const coverPageId = 'cover-page';
                manifestItems += `<item id="${coverPageId}" href="Text/${coverPageName}" media-type="application/xhtml+xml"/>\n`;
                                let coverSpineProps = '';
                if (isLandscapeSpread) {
                    coverSpineProps = ` properties="page-spread-${expectedNextSide}"`;
                    expectedNextSide = (expectedNextSide === startSide) ? endSide : startSide;
                }
                spineItems += `<itemref idref="${coverPageId}"${coverSpineProps}/>\n`;
            }

            for (let i = 0; i < images.length; i++) {
                const imgData = images[i];
                let ext = imgData.name.split('.').pop().toLowerCase();
                let mimeType = ext === 'jpg' ? 'jpeg' : ext;

                let blobData = await imgData.async("blob");
                let processedImages = [];

                const img = await ConverterLogic.blobToImage(blobData);
                let isSpreadProcessed = false;

                if (isOptimizeEnabled) {
                    if (ConverterLogic.isSpread(img.width, img.height)) {
                        isSpreadProcessed = true;
                        const halves = await ConverterLogic.splitImage(img, outputFormat, jpegQuality);
                        const order = ConverterLogic.getSplitOrder(readingDirection);

                        if (outputFormat === 'jpeg') {
                            ext = 'jpg';
                            mimeType = 'jpeg';
                        } else {
                            ext = 'png';
                            mimeType = 'png';
                        }

                        const leftImg = await ConverterLogic.blobToImage(halves.left);
                        const rightImg = await ConverterLogic.blobToImage(halves.right);

                        const leftRes = await ConverterLogic.processImage(leftImg, halves.left, isKindleFitEnabled, isGrayscaleEnabled, mimeType, outputFormat, jpegQuality);
                        const rightRes = await ConverterLogic.processImage(rightImg, halves.right, isKindleFitEnabled, isGrayscaleEnabled, mimeType, outputFormat, jpegQuality);

                        if (order[0] === 'left') {
                            processedImages.push({ blob: leftRes.blob, ext, mimeType, suffix: '_left', width: leftRes.width, height: leftRes.height, pageSpread: readingDirection === 'rtl' ? 'right' : 'left' });
                            processedImages.push({ blob: rightRes.blob, ext, mimeType, suffix: '_right', width: rightRes.width, height: rightRes.height, pageSpread: readingDirection === 'rtl' ? 'left' : 'right' });
                        } else {
                            processedImages.push({ blob: rightRes.blob, ext, mimeType, suffix: '_right', width: rightRes.width, height: rightRes.height, pageSpread: readingDirection === 'rtl' ? 'right' : 'left' });
                            processedImages.push({ blob: leftRes.blob, ext, mimeType, suffix: '_left', width: leftRes.width, height: leftRes.height, pageSpread: readingDirection === 'rtl' ? 'left' : 'right' });
                        }
                    }
                }

                if (!isSpreadProcessed) {
                    const res = await ConverterLogic.processImage(img, blobData, isKindleFitEnabled, isGrayscaleEnabled, mimeType, outputFormat, jpegQuality);
                    let finalExt = ext;
                    let finalMime = mimeType;
                    if (outputFormat === 'jpeg') {
                        finalExt = 'jpg';
                        finalMime = 'jpeg';
                    }
                    let pageSpreadProp = undefined;
                    // If it's a spread but we are not cutting it, force it to 'center'
                    if (ConverterLogic.isSpread(img.width, img.height)) {
                        pageSpreadProp = 'center';
                    }
                    processedImages.push({ blob: res.blob, ext: finalExt, mimeType: finalMime, suffix: '', width: res.width, height: res.height, pageSpread: pageSpreadProp });
                }

                for (const procImg of processedImages) {
                    if (procImg.width > maxWidth) maxWidth = procImg.width;
                    if (procImg.height > maxHeight) maxHeight = procImg.height;

                    const imgName = `image_${globalImageCounter.toString().padStart(4, '0')}${procImg.suffix}.${procImg.ext}`;
                    imagesFolder.file(imgName, procImg.blob);

                    const id = `img${globalImageCounter}`;
                    let properties = '';

                    if (coverSource === 'page' && globalImageCounter === (coverPageNumber - 1)) {
                        properties = ' properties="cover-image"';
                        coverId = id;
                    }

                    manifestItems += `<item id="${id}" href="Images/${imgName}" media-type="image/${procImg.mimeType}"${properties}/>
`;

                    const pageName = `page_${globalImageCounter.toString().padStart(4, '0')}.xhtml`;
                    const xhtml = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Page ${globalImageCounter}</title>
  <meta name="viewport" content="width=${procImg.width}, height=${procImg.height}"/>
  <style type="text/css">
    body { margin: 0; padding: 0; width: ${procImg.width}px; height: ${procImg.height}px; overflow: hidden; }
    img { width: 100%; height: 100%; display: block; margin: 0; padding: 0; object-fit: cover; }
  </style>
</head>
<body>
  <img src="../Images/${imgName}" alt="Page ${globalImageCounter}" />
</body>
</html>`;
                    textFolder.file(pageName, xhtml);

                    const pageId = `page${globalImageCounter}`;
                    manifestItems += `<item id="${pageId}" href="Text/${pageName}" media-type="application/xhtml+xml"/>
`;

                                        let spineProps = '';
                    if (isLandscapeSpread) {
                        if (procImg.pageSpread === 'center') {
                            spineProps = ' properties="page-spread-center"';
                            // Uncut spread takes full screen, reset expected next side to start of a new spread
                            expectedNextSide = startSide;
                        } else if (procImg.pageSpread !== undefined) {
                            // This is a cut half, strictly use its assigned side
                            spineProps = ` properties="page-spread-${procImg.pageSpread}"`;
                            // Reset queue based on which half it is. If it's the end half, the next normal page should be on startSide.
                            if (procImg.pageSpread === endSide) {
                                expectedNextSide = startSide;
                            } else {
                                expectedNextSide = endSide;
                            }
                        } else {
                            // Normal page
                            spineProps = ` properties="page-spread-${expectedNextSide}"`;
                            expectedNextSide = (expectedNextSide === startSide) ? endSide : startSide;
                        }
                    }
                    spineItems += `<itemref idref="${pageId}"${spineProps}/>\n`;

                    globalImageCounter++;
                }

                if (i % 5 === 0) {
                    onProgress(40 + (i / images.length) * 40);
                }
            }

            onProgress(85);

            const spineDirectionAttr = ConverterLogic.getSpineDirectionAttribute(readingDirection);

            const primaryWritingMode = readingDirection === 'rtl' ? 'horizontal-rl' : 'horizontal-lr';
            const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0" prefix="rendition: http://www.idpf.org/vocab/rendition/#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</dc:title>
    <dc:creator opf:role="aut">${author.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="BookId">urn:uuid:${crypto.randomUUID ? crypto.randomUUID() : '12345-67890'}</dc:identifier>
    ${coverId ? `<meta name="cover" content="${coverId}"/>` : ''}
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta property="rendition:spread">${isLandscapeSpread ? 'landscape' : 'auto'}</meta>
    <meta name="book-type" content="comic"/>
    <meta name="fixed-layout" content="true"/>
    <meta name="primary-writing-mode" content="${primaryWritingMode}"/>
    <meta name="original-resolution" content="${maxWidth}x${maxHeight}"/>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine${spineDirectionAttr}>
    ${spineItems}
  </spine>
</package>`;
            oebps.file("content.opf", contentOpf);

            onProgress(90);

            const epubBlob = await epubZip.generateAsync({
                type: "blob",
                mimeType: "application/epub+zip",
                compression: "DEFLATE",
                compressionOptions: {
                    level: 9
                }
            });

            return epubBlob;
        }

        async function extractImagesFromCbz(file) {
            const jszip = new JSZip();
            const cbzData = await jszip.loadAsync(file);
            const imageFiles = [];
            cbzData.forEach((relativePath, zipEntry) => {
                if (!zipEntry.dir && relativePath.match(/\.(jpe?g|png|gif|webp)$/i)) {
                    imageFiles.push(zipEntry);
                }
            });
            const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});
            imageFiles.sort((a, b) => collator.compare(a.name, b.name));
            return imageFiles;
        }

        function downloadBlob(blob, filename) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        convertBtn.addEventListener("click", async () => {
            if (currentFiles.length === 0) return;

            convertBtn.disabled = true;
            const globalTitle = titleInput.value;
            const globalAuthor = authorInput.value || "Unknown Author";
            const isOptimizeEnabled = optimizeCheckbox ? optimizeCheckbox.checked : false;
            const readingDirection = directionSelect ? directionSelect.value : 'ltr';
            const outputFormat = formatSelect ? formatSelect.value : 'original';
            const qualityInputEl = document.getElementById("quality-input");
            let jpegQuality = 0.85;
            if (qualityInputEl && qualityInputEl.value) {
                const qVal = parseFloat(qualityInputEl.value);
                if (!isNaN(qVal) && qVal >= 1 && qVal <= 100) {
                    jpegQuality = qVal / 100;
                }
            }
            const isMergeMode = (currentFiles.length > 1) && mergeCheckbox && mergeCheckbox.checked;
            const coverSource = document.querySelector('input[name="cover-source"]:checked').value;
            const coverPageNumber = parseInt(coverPageInput.value, 10) || 1;
            const customCoverFile = coverInput && coverInput.files.length > 0 ? coverInput.files[0] : null;
            const isKindleFitEnabled = kindlePw12Checkbox ? kindlePw12Checkbox.checked : false;
            const isGrayscaleEnabled = grayscaleCheckbox ? grayscaleCheckbox.checked : false;
            const landscapeSpreadCheckbox = document.getElementById("landscape-spread-checkbox");
            const isLandscapeSpread = landscapeSpreadCheckbox ? landscapeSpreadCheckbox.checked : false;
            const offsetFirstPageCheckbox = document.getElementById("offset-first-page-checkbox");
            const isOffsetFirstPage = offsetFirstPageCheckbox ? offsetFirstPageCheckbox.checked : false;

            progressContainer.style.display = "block";
            progressFill.style.backgroundColor = 'var(--primary-color)';

            try {
                if (isMergeMode) {
                    setProgress(5, "Merging files: Reading all images...");
                    let allImages = [];
                    for (let i = 0; i < currentFiles.length; i++) {
                        const imgs = await extractImagesFromCbz(currentFiles[i]);
                        allImages = allImages.concat(imgs);
                        setProgress(5 + (i / currentFiles.length) * 20, `Reading file ${i+1}/${currentFiles.length}...`);
                    }

                    if (allImages.length === 0) {
                        throw new Error("No images found in the selected archives.");
                    }

                    const finalTitle = globalTitle || currentFiles[0].name.replace(/\.[^/.]+$/, "");

                    setProgress(30, `Processing ${allImages.length} total images...`);

                    const epubBlob = await createEpub(
                        allImages,
                        finalTitle,
                        globalAuthor,
                        isOptimizeEnabled,
                        readingDirection,
                        outputFormat,
                        customCoverFile,
                        coverSource,
                        coverPageNumber,
                        isKindleFitEnabled,
                        isGrayscaleEnabled,
                        jpegQuality,
                        (percent) => setProgress(percent, "Merging and creating EPUB..."),
                        isLandscapeSpread,
                        isOffsetFirstPage
                    );

                    setProgress(100, "Done! Downloading...");
                    downloadBlob(epubBlob, `${finalTitle}.epub`);

                } else {
                    for (let i = 0; i < currentFiles.length; i++) {
                        const file = currentFiles[i];
                        const fileBaseName = file.name.replace(/\.[^/.]+$/, "");
                        // Use global title if only one file, otherwise use filename
                        const finalTitle = currentFiles.length === 1 ? (globalTitle || fileBaseName) : fileBaseName;

                        setProgress(10, `Processing file ${i+1}/${currentFiles.length}: ${file.name}`);

                        const images = await extractImagesFromCbz(file);
                        if (images.length === 0) {
                            console.warn(`No images found in ${file.name}`);
                            continue;
                        }

                        const epubBlob = await createEpub(
                            images,
                            finalTitle,
                            globalAuthor,
                            isOptimizeEnabled,
                            readingDirection,
                        outputFormat,
                        customCoverFile,
                        coverSource,
                        coverPageNumber,
                        isKindleFitEnabled,
                        isGrayscaleEnabled,
                        jpegQuality,
                        (percent) => setProgress(percent, `Processing file ${i+1}/${currentFiles.length}...`),
                        isLandscapeSpread,
                        isOffsetFirstPage
                        );

                        setProgress(95, `Downloading file ${i+1}/${currentFiles.length}...`);
                        downloadBlob(epubBlob, `${finalTitle}.epub`);
                    }
                    setProgress(100, "All files converted!");
                }

                setTimeout(() => {
                    setProgress(0, "Ready");
                    progressContainer.style.display = "none";
                    convertBtn.disabled = false;
                }, 3000);

            } catch (error) {
                console.error(error);
                setProgress(0, `Error: ${error.message}`);
                progressFill.style.backgroundColor = 'red';
                setTimeout(() => {
                    progressContainer.style.display = "none";
                    progressFill.style.backgroundColor = 'var(--primary-color)';
                    convertBtn.disabled = false;
                }, 5000);
            }
        });
    });
}
