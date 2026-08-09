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

        let currentFile = null;

        // Drag & Drop logic
        dropZoneElement.addEventListener("click", () => {
            inputElement.click();
        });

        inputElement.addEventListener("change", (e) => {
            if (inputElement.files.length) {
                updateThumbnail(dropZoneElement, inputElement.files[0]);
            }
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
            if (e.dataTransfer.files.length) {
                inputElement.files = e.dataTransfer.files;
                updateThumbnail(dropZoneElement, e.dataTransfer.files[0]);
            }
            dropZoneElement.classList.remove("drop-zone--over");
        });

        function updateThumbnail(dropZoneElement, file) {
            let prompt = dropZoneElement.querySelector(".drop-zone__prompt");
            if (dropZoneElement.querySelector(".drop-zone__thumb")) {
                dropZoneElement.querySelector(".drop-zone__thumb").remove();
            }
            if (prompt) {
                prompt.style.display = "none";
            }

            const thumbElement = document.createElement("div");
            thumbElement.classList.add("drop-zone__thumb");
            thumbElement.textContent = file.name;
            dropZoneElement.appendChild(thumbElement);

            currentFile = file;
            convertBtn.disabled = false;

            // Auto-fill title if empty
            if (!titleInput.value) {
                titleInput.value = file.name.replace(/\.[^/.]+$/, ""); // Remove extension
            }
        }

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
        convertBtn.addEventListener("click", async () => {
            if (!currentFile) return;

            convertBtn.disabled = true;
            try {
                const title = titleInput.value || "Unknown Title";
                const author = authorInput.value || "Unknown Author";
                const isOptimizeEnabled = optimizeCheckbox ? optimizeCheckbox.checked : false;
                const readingDirection = directionSelect ? directionSelect.value : 'ltr';
                const splitFormat = formatSelect ? formatSelect.value : 'original';

                setProgress(10, "Reading CBZ file...");

                const jszip = new JSZip();
                const cbzData = await jszip.loadAsync(currentFile);

                // Filter images
                const imageFiles = [];
                cbzData.forEach((relativePath, file) => {
                    if (!file.dir && relativePath.match(/\.(jpe?g|png|gif|webp)$/i)) {
                        imageFiles.push(file);
                    }
                });

                if (imageFiles.length === 0) {
                    throw new Error("No images found in the archive.");
                }

                // Sort naturally
                const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});
                imageFiles.sort((a, b) => collator.compare(a.name, b.name));

                setProgress(30, `Found ${imageFiles.length} images. Processing and Creating EPUB...`);

                const epubZip = new JSZip();

                // 1. mimetype (must be uncompressed in standard, but JSZip handles it well enough usually)
                epubZip.file("mimetype", "application/epub+zip");

                // 2. META-INF/container.xml
                const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
                epubZip.folder("META-INF").file("container.xml", containerXml);

                // 3. OEBPS folder
                const oebps = epubZip.folder("OEBPS");
                const imagesFolder = oebps.folder("Images");
                const textFolder = oebps.folder("Text");

                let manifestItems = "";
                let spineItems = "";
                let globalImageCounter = 0;

                setProgress(40, "Extracting and writing images...");

                for (let i = 0; i < imageFiles.length; i++) {
                    const imgFile = imageFiles[i];
                    let ext = imgFile.name.split('.').pop().toLowerCase();
                    let mimeType = ext === 'jpg' ? 'jpeg' : ext; // very basic mime type guess

                    // Read image data from cbz
                    let imgData = await imgFile.async("blob");

                    let processedImages = [];

                    if (isOptimizeEnabled) {
                        const img = await blobToImage(imgData);
                        if (ConverterLogic.isSpread(img.width, img.height)) {
                            const halves = await splitImage(img, splitFormat);
                            const order = ConverterLogic.getSplitOrder(readingDirection);

                            // Adjust ext and mimeType if we converted to JPEG
                            if (splitFormat === 'jpeg') {
                                ext = 'jpg';
                                mimeType = 'jpeg';
                            } else {
                                // Default split format uses image/png, update extension
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
                            processedImages.push({ blob: imgData, ext, mimeType, suffix: '' });
                        }
                    } else {
                        processedImages.push({ blob: imgData, ext, mimeType, suffix: '' });
                    }

                    for (const procImg of processedImages) {
                        const imgName = `image_${globalImageCounter.toString().padStart(4, '0')}${procImg.suffix}.${procImg.ext}`;
                        imagesFolder.file(imgName, procImg.blob);

                        const id = `img${globalImageCounter}`;
                        manifestItems += `<item id="${id}" href="Images/${imgName}" media-type="image/${procImg.mimeType}"/>\n`;

                        // Create XHTML page for image
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
                        manifestItems += `<item id="${pageId}" href="Text/${pageName}" media-type="application/xhtml+xml"/>\n`;
                        spineItems += `<itemref idref="${pageId}"/>\n`;

                        globalImageCounter++;
                    }

                    if (i % 10 === 0) {
                        setProgress(40 + (i / imageFiles.length) * 40, `Processing image ${i+1}/${imageFiles.length}...`);
                    }
                }

                setProgress(85, "Writing metadata...");

                // 4. content.opf
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

                setProgress(90, "Compressing EPUB...");

                const epubBlob = await epubZip.generateAsync({
                    type: "blob",
                    mimeType: "application/epub+zip",
                    compression: "DEFLATE",
                    compressionOptions: {
                        level: 9
                    }
                });

                setProgress(100, "Done! Downloading...");

                // Trigger download
                const url = URL.createObjectURL(epubBlob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${title}.epub`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

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
