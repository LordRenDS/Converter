import { COVER_SOURCES, OUTPUT_FORMATS, DEFAULT_JPEG_QUALITY, getDevicePreset, SPREAD_MODES, SPREAD_POSITIONS, ROTATION_DIRECTIONS } from '../modules/constants.js';
import { extractImagesFromCbz } from '../modules/cbz-reader.js';
import { createEpub } from '../modules/epub-builder.js';
import { downloadBlob } from '../modules/file-downloader.js';

export class UIController {
    constructor() {
        this.currentFiles = [];
        this.initDOMElements();
        this.bindEvents();
    }

    initDOMElements() {
        this.dropZoneElement = document.getElementById('drop-zone');
        this.inputElement = document.getElementById('file-input');
        this.convertBtn = document.getElementById('convert-btn');
        this.progressContainer = document.getElementById('progress-container');
        this.progressFill = document.getElementById('progress-fill');
        this.statusText = document.getElementById('status-text');
        this.titleInput = document.getElementById('title-input');
        this.authorInput = document.getElementById('author-input');
        this.coverInput = document.getElementById('cover-input');
        this.coverPageInput = document.getElementById('cover-page-input');
        this.coverSourceRadios = document.querySelectorAll('input[name="cover-source"]');
        this.coverPageInputGroup = document.getElementById('cover-page-input-group');
        this.coverFileInputGroup = document.getElementById('cover-file-input-group');
        this.optimizeCheckbox = document.getElementById('optimize-checkbox');
        this.spreadModeSelect = document.getElementById('spread-mode-select');
        this.spreadSuboptionsGroup = document.getElementById('spread-suboptions-group');
        this.spreadNoRotateGroup = document.getElementById('spread-no-rotate-group');
        this.spreadNoRotateCheckbox = document.getElementById('spread-no-rotate-checkbox');
        this.spreadRotateRightGroup = document.getElementById('spread-rotate-right-group');
        this.spreadRotateRightCheckbox = document.getElementById('spread-rotate-right-checkbox');
        this.spreadPositionGroup = document.getElementById('spread-position-group');
        this.spreadPositionSelect = document.getElementById('spread-position-select');
        this.directionSelect = document.getElementById('direction-select');
        this.formatSelect = document.getElementById('format-select');
        this.deviceSelect = document.getElementById('device-select');
        this.upscaleCheckbox = document.getElementById('upscale-checkbox');
        this.grayscaleCheckbox = document.getElementById('grayscale-checkbox');
        this.formatGroup = document.getElementById('format-group');
        this.fileList = document.getElementById('file-list');
        this.mergeGroup = document.getElementById('merge-group');
        this.mergeCheckbox = document.getElementById('merge-checkbox');
        this.qualityGroup = document.getElementById('quality-group');
        this.qualityInputEl = document.getElementById('quality-input');
        this.cropMarginsCheckbox = document.getElementById('crop-margins-checkbox');
        this.landscapeSpreadCheckbox = document.getElementById('landscape-spread-checkbox');
        this.offsetFirstPageCheckbox = document.getElementById('offset-first-page-checkbox');
    }

    updateSpreadSuboptions() {
        if (!this.spreadModeSelect || !this.spreadSuboptionsGroup) return;

        const mode = this.spreadModeSelect.value;
        const noRotate = this.spreadNoRotateCheckbox ? this.spreadNoRotateCheckbox.checked : false;

        if (mode === SPREAD_MODES.OFF || mode === SPREAD_MODES.SPLIT) {
            this.spreadSuboptionsGroup.style.display = 'none';
        } else if (mode === SPREAD_MODES.ROTATE) {
            this.spreadSuboptionsGroup.style.display = 'flex';
            if (this.spreadNoRotateGroup) this.spreadNoRotateGroup.style.display = 'flex';
            if (this.spreadRotateRightGroup) this.spreadRotateRightGroup.style.display = noRotate ? 'none' : 'flex';
            if (this.spreadPositionGroup) this.spreadPositionGroup.style.display = 'none';
        } else if (mode === SPREAD_MODES.BOTH) {
            this.spreadSuboptionsGroup.style.display = 'flex';
            if (this.spreadNoRotateGroup) this.spreadNoRotateGroup.style.display = 'flex';
            if (this.spreadRotateRightGroup) this.spreadRotateRightGroup.style.display = noRotate ? 'none' : 'flex';
            if (this.spreadPositionGroup) this.spreadPositionGroup.style.display = 'flex';
        }
    }

    bindEvents() {
        // Cover source radio buttons
        this.coverSourceRadios.forEach((radio) => {
            radio.addEventListener('change', (e) => {
                const isPage = e.target.value === COVER_SOURCES.PAGE;
                if (this.coverPageInputGroup) this.coverPageInputGroup.style.display = isPage ? 'flex' : 'none';
                if (this.coverFileInputGroup) this.coverFileInputGroup.style.display = isPage ? 'none' : 'flex';
            });
        });

        // Spread mode change & no-rotate checkbox change
        if (this.spreadModeSelect) {
            this.spreadModeSelect.addEventListener('change', () => this.updateSpreadSuboptions());
        }
        if (this.spreadNoRotateCheckbox) {
            this.spreadNoRotateCheckbox.addEventListener('change', () => this.updateSpreadSuboptions());
        }
        this.updateSpreadSuboptions();

        // Format select toggle for JPEG quality
        if (this.formatSelect && this.qualityGroup) {
            this.formatSelect.addEventListener('change', (e) => {
                this.qualityGroup.style.display = e.target.value === OUTPUT_FORMATS.JPEG ? 'flex' : 'none';
            });
        }

        // Drag & Drop for file zone
        if (this.dropZoneElement) {
            this.dropZoneElement.addEventListener('click', () => {
                if (this.inputElement) this.inputElement.click();
            });

            this.dropZoneElement.addEventListener('dragover', (e) => {
                e.preventDefault();
                this.dropZoneElement.classList.add('drop-zone--over');
            });

            ['dragleave', 'dragend'].forEach((type) => {
                this.dropZoneElement.addEventListener(type, () => {
                    this.dropZoneElement.classList.remove('drop-zone--over');
                });
            });

            this.dropZoneElement.addEventListener('drop', (e) => {
                e.preventDefault();
                this.dropZoneElement.classList.remove('drop-zone--over');
                if (e.dataTransfer.files.length) {
                    this.handleFiles(e.dataTransfer.files);
                }
            });
        }

        // File input change
        if (this.inputElement) {
            this.inputElement.addEventListener('change', (e) => {
                if (e.target.files.length) {
                    this.handleFiles(e.target.files);
                }
                this.inputElement.value = '';
            });
        }

        // Convert button click
        if (this.convertBtn) {
            this.convertBtn.addEventListener('click', () => this.handleConvert());
        }
    }

    handleFiles(files) {
        const newFiles = Array.from(files).filter(
            (file) => file.name.toLowerCase().endsWith('.cbz') || file.name.toLowerCase().endsWith('.zip')
        );

        if (newFiles.length > 0) {
            this.currentFiles = [...this.currentFiles, ...newFiles];
            const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
            this.currentFiles.sort((a, b) => collator.compare(a.name, b.name));
            this.updateFileList();
        }
    }

    updateFileList() {
        if (!this.fileList) return;

        this.fileList.innerHTML = '';
        if (this.currentFiles.length === 0) {
            this.fileList.style.display = 'none';
            if (this.convertBtn) this.convertBtn.disabled = true;
            if (this.mergeCheckbox) this.mergeCheckbox.disabled = true;
            return;
        }

        this.fileList.style.display = 'block';
        if (this.convertBtn) this.convertBtn.disabled = false;
        if (this.mergeCheckbox) this.mergeCheckbox.disabled = this.currentFiles.length <= 1;

        this.currentFiles.forEach((file, index) => {
            const li = document.createElement('li');
            li.draggable = true;
            li.dataset.index = index;

            const nameSpan = document.createElement('span');
            nameSpan.textContent = file.name;

            const removeBtn = document.createElement('button');
            removeBtn.textContent = '×';
            removeBtn.className = 'remove-btn';
            removeBtn.onclick = () => {
                this.currentFiles.splice(index, 1);
                this.updateFileList();
            };

            li.appendChild(nameSpan);
            li.appendChild(removeBtn);

            // Drag and drop for reordering files
            li.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', index);
                setTimeout(() => { li.style.opacity = '0.5'; }, 0);
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
                    const draggedFile = this.currentFiles[draggedIndex];
                    this.currentFiles.splice(draggedIndex, 1);
                    this.currentFiles.splice(targetIndex, 0, draggedFile);
                    this.updateFileList();
                }
            });

            this.fileList.appendChild(li);
        });
    }

    setProgress(percent, text) {
        if (!this.progressContainer || !this.progressFill || !this.statusText) return;
        this.progressContainer.style.display = 'block';
        this.progressFill.style.width = `${percent}%`;
        this.statusText.textContent = text;
    }

    async handleConvert() {
        if (this.currentFiles.length === 0) return;

        this.convertBtn.disabled = true;
        const globalTitle = this.titleInput ? this.titleInput.value.trim() : '';
        const globalAuthor = (this.authorInput && this.authorInput.value.trim()) || 'Unknown Author';
        const spreadMode = this.spreadModeSelect
            ? this.spreadModeSelect.value
            : (this.optimizeCheckbox && this.optimizeCheckbox.checked ? SPREAD_MODES.SPLIT : SPREAD_MODES.OFF);
        const spreadNoRotate = this.spreadNoRotateCheckbox ? this.spreadNoRotateCheckbox.checked : false;
        const spreadRotateRight = this.spreadRotateRightCheckbox ? this.spreadRotateRightCheckbox.checked : false;
        const spreadPosition = this.spreadPositionSelect ? this.spreadPositionSelect.value : SPREAD_POSITIONS.AFTER;
        const readingDirection = this.directionSelect ? this.directionSelect.value : 'ltr';
        const outputFormat = this.formatSelect ? this.formatSelect.value : 'original';

        let jpegQuality = DEFAULT_JPEG_QUALITY;
        if (this.qualityInputEl && this.qualityInputEl.value) {
            const qVal = parseFloat(this.qualityInputEl.value);
            if (!isNaN(qVal) && qVal >= 1 && qVal <= 100) {
                jpegQuality = qVal / 100;
            }
        }

        const isMergeMode = (this.currentFiles.length > 1) && this.mergeCheckbox && this.mergeCheckbox.checked;
        const selectedCoverRadio = document.querySelector('input[name="cover-source"]:checked');
        const coverSource = selectedCoverRadio ? selectedCoverRadio.value : COVER_SOURCES.PAGE;
        const coverPageNumber = parseInt(this.coverPageInput ? this.coverPageInput.value : '1', 10) || 1;
        const customCoverFile = this.coverInput && this.coverInput.files.length > 0 ? this.coverInput.files[0] : null;
        const selectedDeviceId = this.deviceSelect ? this.deviceSelect.value : 'original';
        const targetDevice = getDevicePreset(selectedDeviceId);
        const isUpscaleEnabled = this.upscaleCheckbox ? this.upscaleCheckbox.checked : true;
        const isGrayscaleEnabled = this.grayscaleCheckbox ? this.grayscaleCheckbox.checked : false;
        const isCropMarginsEnabled = this.cropMarginsCheckbox ? this.cropMarginsCheckbox.checked : true;
        const isLandscapeSpread = this.landscapeSpreadCheckbox ? this.landscapeSpreadCheckbox.checked : false;
        const isOffsetFirstPage = this.offsetFirstPageCheckbox ? this.offsetFirstPageCheckbox.checked : false;

        this.progressContainer.style.display = 'block';
        this.progressFill.style.backgroundColor = 'var(--primary-color)';

        try {
            if (isMergeMode) {
                this.setProgress(5, 'Merging files: Reading all images...');
                let allImages = [];
                for (let i = 0; i < this.currentFiles.length; i++) {
                    const imgs = await extractImagesFromCbz(this.currentFiles[i]);
                    allImages = allImages.concat(imgs);
                    this.setProgress(5 + (i / this.currentFiles.length) * 20, `Reading file ${i + 1}/${this.currentFiles.length}...`);
                }

                if (allImages.length === 0) {
                    throw new Error('No images found in the selected archives.');
                }

                const finalTitle = globalTitle || this.currentFiles[0].name.replace(/\.[^/.]+$/, '');
                this.setProgress(30, `Processing ${allImages.length} total images...`);

                const epubBlob = await createEpub({
                    images: allImages,
                    title: finalTitle,
                    author: globalAuthor,
                    spreadMode,
                    spreadNoRotate,
                    spreadRotateRight,
                    spreadPosition,
                    readingDirection,
                    outputFormat,
                    customCoverFile,
                    coverSource,
                    coverPageNumber,
                    targetDevice,
                    isUpscaleEnabled,
                    isGrayscaleEnabled,
                    jpegQuality,
                    isCropMarginsEnabled,
                    isLandscapeSpread,
                    isOffsetFirstPage,
                    onProgress: (percent) => this.setProgress(percent, 'Merging and creating EPUB...')
                });

                this.setProgress(100, 'Done! Downloading...');
                downloadBlob(epubBlob, `${finalTitle}.epub`);

            } else {
                for (let i = 0; i < this.currentFiles.length; i++) {
                    const file = this.currentFiles[i];
                    const fileBaseName = file.name.replace(/\.[^/.]+$/, '');
                    const finalTitle = this.currentFiles.length === 1 ? (globalTitle || fileBaseName) : fileBaseName;

                    this.setProgress(10, `Processing file ${i + 1}/${this.currentFiles.length}: ${file.name}`);

                    const images = await extractImagesFromCbz(file);
                    if (images.length === 0) {
                        console.warn(`No images found in ${file.name}`);
                        continue;
                    }

                    const epubBlob = await createEpub({
                        images,
                        title: finalTitle,
                        author: globalAuthor,
                        spreadMode,
                        spreadNoRotate,
                        spreadRotateRight,
                        spreadPosition,
                        readingDirection,
                        outputFormat,
                        customCoverFile,
                        coverSource,
                        coverPageNumber,
                        targetDevice,
                        isUpscaleEnabled,
                        isGrayscaleEnabled,
                        jpegQuality,
                        isCropMarginsEnabled,
                        isLandscapeSpread,
                        isOffsetFirstPage,
                        onProgress: (percent) => this.setProgress(percent, `Processing file ${i + 1}/${this.currentFiles.length}...`)
                    });

                    this.setProgress(95, `Downloading file ${i + 1}/${this.currentFiles.length}...`);
                    downloadBlob(epubBlob, `${finalTitle}.epub`);
                }
                this.setProgress(100, 'All files converted!');
            }

            setTimeout(() => {
                this.setProgress(0, 'Ready');
                this.progressContainer.style.display = 'none';
                this.convertBtn.disabled = false;
            }, 3000);

        } catch (error) {
            console.error(error);
            this.setProgress(0, `Error: ${error.message}`);
            this.progressFill.style.backgroundColor = 'red';
            setTimeout(() => {
                this.progressContainer.style.display = 'none';
                this.progressFill.style.backgroundColor = 'var(--primary-color)';
                this.convertBtn.disabled = false;
            }, 5000);
        }
    }
}
