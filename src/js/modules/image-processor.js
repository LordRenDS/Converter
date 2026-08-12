import { DEVICE_PRESETS, getDevicePreset, DEFAULT_JPEG_QUALITY, READING_DIRECTIONS, OUTPUT_FORMATS } from './constants.js';

/**
 * Checks if an image is a wide spread (two-page landscape layout).
 * @param {number} width 
 * @param {number} height 
 * @returns {boolean}
 */
export function isSpread(width, height) {
    return width > height;
}

/**
 * Returns the splitting order based on reading direction.
 * @param {string} direction - 'ltr' or 'rtl'
 * @returns {['left', 'right'] | ['right', 'left']}
 */
export function getSplitOrder(direction) {
    return direction === READING_DIRECTIONS.RTL ? ['right', 'left'] : ['left', 'right'];
}

/**
 * Converts a Blob to an HTMLImageElement asynchronously.
 * @param {Blob} blob 
 * @returns {Promise<HTMLImageElement>}
 */
export function blobToImage(blob) {
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

/**
 * Converts a canvas or image element to a Blob.
 * @param {HTMLCanvasElement | HTMLImageElement} canvasOrImg 
 * @param {string} mimeType 
 * @param {number} quality 
 * @returns {Promise<Blob>}
 */
export function imageToBlob(canvasOrImg, mimeType, quality = DEFAULT_JPEG_QUALITY) {
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
}

/**
 * Processes an image with optional device resolution fit, upscale/downscale scaling, grayscale conversion, and format changes.
 * @param {HTMLImageElement} img 
 * @param {Blob} originalBlob 
 * @param {boolean | string | { width: number, height: number }} targetDeviceOrFit 
 * @param {boolean} isGrayscale 
 * @param {string} mimeType 
 * @param {string} outputFormat 
 * @param {number} quality 
 * @param {boolean} isUpscale 
 * @returns {Promise<{ blob: Blob, width: number, height: number }>}
 */
export async function processImage(
    img,
    originalBlob,
    targetDeviceOrFit = false,
    isGrayscale = false,
    mimeType = 'image/jpeg',
    outputFormat = OUTPUT_FORMATS.ORIGINAL,
    quality = DEFAULT_JPEG_QUALITY,
    isUpscale = true
) {
    let width = img.width;
    let height = img.height;
    let needsProcessing = false;

    let targetWidth = 0;
    let targetHeight = 0;

    if (targetDeviceOrFit === true) {
        targetWidth = DEVICE_PRESETS.KINDLE_PW12.width;
        targetHeight = DEVICE_PRESETS.KINDLE_PW12.height;
    } else if (targetDeviceOrFit) {
        const preset = getDevicePreset(targetDeviceOrFit);
        targetWidth = preset ? preset.width : 0;
        targetHeight = preset ? preset.height : 0;
    }

    if (targetWidth > 0 && targetHeight > 0) {
        const isLarger = width > targetWidth || height > targetHeight;
        const isSmaller = width < targetWidth && height < targetHeight;

        if (isLarger || (isUpscale && isSmaller)) {
            const ratio = Math.min(targetWidth / width, targetHeight / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
            needsProcessing = true;
        }
    }

    if (isGrayscale) {
        needsProcessing = true;
    }

    if (outputFormat === OUTPUT_FORMATS.JPEG) {
        needsProcessing = true;
        mimeType = 'image/jpeg';
    }

    if (!needsProcessing) {
        if (originalBlob) {
            return { blob: originalBlob, width: img.width, height: img.height };
        }
        return { blob: await imageToBlob(img, mimeType, quality), width: img.width, height: img.height };
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (ctx) {
        if ('imageSmoothingEnabled' in ctx) {
            ctx.imageSmoothingEnabled = true;
        }
        if ('imageSmoothingQuality' in ctx) {
            ctx.imageSmoothingQuality = 'high';
        }
    }

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

    return { blob: await imageToBlob(canvas, mimeType, quality), width, height };
}

/**
 * Splits a wide spread image into left and right halves.
 * @param {HTMLImageElement} img 
 * @param {string} format 
 * @param {number} quality 
 * @returns {Promise<{ left: Blob, right: Blob, mimeType: string }>}
 */
export async function splitImage(img, format, quality = DEFAULT_JPEG_QUALITY) {
    const width = img.width;
    const height = img.height;
    const halfWidth = Math.floor(width / 2);
    const mimeType = format === OUTPUT_FORMATS.JPEG ? 'image/jpeg' : 'image/png';

    // Left half
    const leftCanvas = document.createElement('canvas');
    leftCanvas.width = halfWidth;
    leftCanvas.height = height;
    const leftCtx = leftCanvas.getContext('2d');
    leftCtx.drawImage(img, 0, 0, halfWidth, height, 0, 0, halfWidth, height);
    const leftBlob = await imageToBlob(leftCanvas, mimeType, quality);

    // Right half (accounts for odd widths)
    const rightCanvas = document.createElement('canvas');
    const rightWidth = width - halfWidth;
    rightCanvas.width = rightWidth;
    rightCanvas.height = height;
    const rightCtx = rightCanvas.getContext('2d');
    rightCtx.drawImage(img, halfWidth, 0, rightWidth, height, 0, 0, rightWidth, height);
    const rightBlob = await imageToBlob(rightCanvas, mimeType, quality);

    return { left: leftBlob, right: rightBlob, mimeType };
}
