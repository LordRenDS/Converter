document.addEventListener("DOMContentLoaded", () => {
    const dropZoneElement = document.getElementById("drop-zone");
    const inputElement = document.getElementById("file-input");
    const convertBtn = document.getElementById("convert-btn");
    const progressContainer = document.getElementById("progress-container");
    const progressFill = document.getElementById("progress-fill");
    const statusText = document.getElementById("status-text");
    const titleInput = document.getElementById("title-input");
    const authorInput = document.getElementById("author-input");

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

    // EPUB Generation logic
    convertBtn.addEventListener("click", async () => {
        if (!currentFile) return;

        convertBtn.disabled = true;
        try {
            const title = titleInput.value || "Unknown Title";
            const author = authorInput.value || "Unknown Author";

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

            setProgress(30, `Found ${imageFiles.length} images. Creating EPUB...`);

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

            setProgress(40, "Extracting and writing images...");

            for (let i = 0; i < imageFiles.length; i++) {
                const imgFile = imageFiles[i];
                const ext = imgFile.name.split('.').pop().toLowerCase();
                const mimeType = ext === 'jpg' ? 'jpeg' : ext; // very basic mime type guess

                // Read image data from cbz
                const imgData = await imgFile.async("blob");

                // Write image to epub
                const imgName = `image_${i.toString().padStart(4, '0')}.${ext}`;
                imagesFolder.file(imgName, imgData);

                const id = `img${i}`;
                manifestItems += `<item id="${id}" href="Images/${imgName}" media-type="image/${mimeType}"/>\n`;

                // Create XHTML page for image
                const pageName = `page_${i.toString().padStart(4, '0')}.xhtml`;
                const xhtml = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>Page ${i}</title>
  <style type="text/css">
    body { margin: 0; padding: 0; text-align: center; }
    img { max-width: 100%; max-height: 100vh; height: auto; object-fit: contain; }
  </style>
</head>
<body>
  <img src="../Images/${imgName}" alt="Page ${i}" />
</body>
</html>`;
                textFolder.file(pageName, xhtml);

                const pageId = `page${i}`;
                manifestItems += `<item id="${pageId}" href="Text/${pageName}" media-type="application/xhtml+xml"/>\n`;
                spineItems += `<itemref idref="${pageId}"/>\n`;

                if (i % 10 === 0) {
                    setProgress(40 + (i / imageFiles.length) * 40, `Processing image ${i+1}/${imageFiles.length}...`);
                }
            }

            setProgress(85, "Writing metadata...");

            // 4. content.opf
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
  <spine>
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
