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

        const optimizeCheckbox = document.getElementById("optimize-checkbox");
        const directionSelect = document.getElementById("direction-select");
        const formatSelect = document.getElementById("format-select");
        const formatGroup = document.getElementById("format-group");

        const fileList = document.getElementById("file-list");
        const mergeGroup = document.getElementById("merge-group");
        const mergeCheckbox = document.getElementById("merge-checkbox");

        if (optimizeCheckbox && formatGroup && formatSelect) {
            optimizeCheckbox.addEventListener("change", (e) => {
                if (e.target.checked) {
                    formatGroup.style.opacity = "1";
                    formatGroup.style.pointerEvents = "auto";
                    formatSelect.disabled = false;
                } else {
                    formatGroup.style.opacity = "0.5";
                    formatGroup.style.pointerEvents = "none";
                    formatSelect.disabled = true;
                }
            });
        }

        let currentFiles = [];

        function updateFileList() {
            fileList.innerHTML = '';
            if (currentFiles.length === 0) {
                fileList.style.display = 'none';
                convertBtn.disabled = true;
                mergeGroup.style.display = 'none';
                return;
            }

            fileList.style.display = 'block';
            convertBtn.disabled = false;

            if (currentFiles.length > 1) {
                mergeGroup.style.display = 'flex';
            } else {
                mergeGroup.style.display = 'none';
                mergeCheckbox.checked = false;
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

        function blobToImage(blob) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    URL.revokeObjectURL(img.src);
                    resolve(img);
                };
                img.onerror = reject;
                img.src = URL.createObjectURL(blob);
            });
        }

        function imageToBlob(canvas, mimeType) {
            return new Promise((resolve) => {
                canvas.toBlob(resolve, mimeType, 0.9);
            });
        }

        async function splitImage(img, format) {
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
            const leftBlob = await imageToBlob(leftCanvas, mimeType);

            // Right half
            const rightCanvas = document.createElement('canvas');
            // Allow for odd-width images
            const rightWidth = width - halfWidth;
            rightCanvas.width = rightWidth;
            rightCanvas.height = height;
            const rightCtx = rightCanvas.getContext('2d');
            rightCtx.drawImage(img, halfWidth, 0, rightWidth, height, 0, 0, rightWidth, height);
            const rightBlob = await imageToBlob(rightCanvas, mimeType);

            return { left: leftBlob, right: rightBlob, mimeType };
        }

        // EPUB Generation logic

        async function createEpub(images, title, author, isOptimizeEnabled, readingDirection, splitFormat, onProgress) {
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

            for (let i = 0; i < images.length; i++) {
                const imgData = images[i];
                let ext = imgData.name.split('.').pop().toLowerCase();
                let mimeType = ext === 'jpg' ? 'jpeg' : ext;

                let blobData = await imgData.async("blob");
                let processedImages = [];

                if (isOptimizeEnabled) {
                    const img = await blobToImage(blobData);
                    if (ConverterLogic.isSpread(img.width, img.height)) {
                        const halves = await splitImage(img, splitFormat);
                        const order = ConverterLogic.getSplitOrder(readingDirection);

                        if (splitFormat === 'jpeg') {
                            ext = 'jpg';
                            mimeType = 'jpeg';
                        } else {
                            ext = 'png';
                            mimeType = 'png';
                        }

                        if (order[0] === 'left') {
                            processedImages.push({ blob: halves.left, ext, mimeType, suffix: '_left' });
                            processedImages.push({ blob: halves.right, ext, mimeType, suffix: '_right' });
                        } else {
                            processedImages.push({ blob: halves.right, ext, mimeType, suffix: '_right' });
                            processedImages.push({ blob: halves.left, ext, mimeType, suffix: '_left' });
                        }
                    } else {
                        processedImages.push({ blob: blobData, ext, mimeType, suffix: '' });
                    }
                } else {
                    processedImages.push({ blob: blobData, ext, mimeType, suffix: '' });
                }

                for (const procImg of processedImages) {
                    const imgName = `image_${globalImageCounter.toString().padStart(4, '0')}${procImg.suffix}.${procImg.ext}`;
                    imagesFolder.file(imgName, procImg.blob);

                    const id = `img${globalImageCounter}`;
                    manifestItems += `<item id="${id}" href="Images/${imgName}" media-type="image/${procImg.mimeType}"/>
`;

                    const pageName = `page_${globalImageCounter.toString().padStart(4, '0')}.xhtml`;
                    const xhtml = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>Page ${globalImageCounter}</title>
  <style type="text/css">
    body { margin: 0; padding: 0; text-align: center; }
    img { max-width: 100%; max-height: 100vh; height: auto; object-fit: contain; }
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
                    spineItems += `<itemref idref="${pageId}"/>
`;

                    globalImageCounter++;
                }

                if (i % 5 === 0) {
                    onProgress(40 + (i / images.length) * 40);
                }
            }

            onProgress(85);

            const spineDirectionAttr = isOptimizeEnabled ? ConverterLogic.getSpineDirectionAttribute(readingDirection) : ' page-progression-direction="ltr"';

            const contentOpf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</dc:title>
    <dc:creator opf:role="aut">${author.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="BookId">urn:uuid:${crypto.randomUUID ? crypto.randomUUID() : '12345-67890'}</dc:identifier>
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
            const splitFormat = formatSelect ? formatSelect.value : 'original';
            const isMergeMode = mergeCheckbox && mergeCheckbox.checked;

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
                        splitFormat,
                        (percent) => setProgress(percent, "Merging and creating EPUB...")
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
                            splitFormat,
                            (percent) => setProgress(percent, `Processing file ${i+1}/${currentFiles.length}...`)
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
