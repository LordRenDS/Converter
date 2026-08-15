import {
    DEVICE_PRESETS,
    getDevicePreset,
    DEFAULT_JPEG_QUALITY,
    READING_DIRECTIONS,
    SPREAD_MODES,
    SPREAD_POSITIONS,
    ROTATION_DIRECTIONS,
    OUTPUT_FORMATS
} from './constants.js';
import { PAGE_TYPES } from './spread-calculator.js';
import { encode4BitPng, encode8BitPng } from './png-encoder.js';

/**
 * Checks if an image is a wide spread (two-page landscape layout).
 * In KCC, ratio > 1.16 is considered a spread.
 * @param {number} width 
 * @param {number} height 
 * @returns {boolean}
 */
export function isSpread(width, height) {
    return width > height && (width / height) > 1.16;
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
 * Rotates an image or canvas 90 degrees clockwise ('cw') or counter-clockwise ('ccw').
 * Default is CCW (standard in KCC).
 * @param {HTMLCanvasElement | HTMLImageElement} canvasOrImg 
 * @param {string} [direction='ccw'] 
 * @returns {HTMLCanvasElement}
 */
export function rotateImage(canvasOrImg, direction = ROTATION_DIRECTIONS.CCW) {
    const width = canvasOrImg.width;
    const height = canvasOrImg.height;
    const canvas = document.createElement('canvas');
    canvas.width = height;
    canvas.height = width;
    const ctx = canvas.getContext('2d');

    if (ctx) {
        if (direction === ROTATION_DIRECTIONS.CW || direction === 'cw') {
            ctx.translate(height, 0);
            ctx.rotate(Math.PI / 2);
        } else {
            ctx.translate(0, width);
            ctx.rotate(-Math.PI / 2);
        }
        ctx.drawImage(canvasOrImg, 0, 0);
    }

    return canvas;
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
 * Helper to determine mimeType and extension from outputFormat and fallback mimeType.
 * @param {string} outputFormat 
 * @param {string} [defaultMime='image/jpeg'] 
 * @returns {{ mimeType: string, ext: string }}
 */
function getMimeAndExt(outputFormat, defaultMime = 'image/jpeg') {
    if (outputFormat === OUTPUT_FORMATS.PNG_4BIT || outputFormat === OUTPUT_FORMATS.PNG_8BIT || outputFormat === OUTPUT_FORMATS.PNG) {
        return { mimeType: 'image/png', ext: 'png' };
    }
    if (outputFormat === OUTPUT_FORMATS.JPEG) {
        return { mimeType: 'image/jpeg', ext: 'jpg' };
    }
    let mime = defaultMime;
    if (mime && !mime.startsWith('image/')) {
        mime = `image/${mime}`;
    }
    let ext = 'jpg';
    if (mime && mime.includes('png')) ext = 'png';
    else if (mime && mime.includes('webp')) ext = 'webp';
    else if (mime && mime.includes('gif')) ext = 'gif';
    return { mimeType: mime || 'image/jpeg', ext };
}

/**
 * Processes an image with optional device resolution fit, upscale/downscale scaling, grayscale conversion, and format changes.
 * @param {HTMLImageElement | HTMLCanvasElement} img 
 * @param {Blob | null} [originalBlob=null] 
 * @param {boolean | string | { width: number, height: number }} [targetDeviceOrFit=false] 
 * @param {boolean} [isGrayscale=false] 
 * @param {string} [mimeType='image/jpeg'] 
 * @param {string} [outputFormat=OUTPUT_FORMATS.ORIGINAL] 
 * @param {number} [quality=DEFAULT_JPEG_QUALITY] 
 * @param {boolean} [isUpscale=true] 
 * @returns {Promise<{ blob: Blob, width: number, height: number, ext: string, mimeType: string }>}
 */
export async function processImage(
    img,
    originalBlob = null,
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

    const { mimeType: targetMime, ext: targetExt } = getMimeAndExt(outputFormat, mimeType || (originalBlob && originalBlob.type));

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

    if (outputFormat === OUTPUT_FORMATS.JPEG ||
        outputFormat === OUTPUT_FORMATS.PNG ||
        outputFormat === OUTPUT_FORMATS.PNG_8BIT ||
        outputFormat === OUTPUT_FORMATS.PNG_4BIT) {
        needsProcessing = true;
    }

    if (!needsProcessing) {
        if (originalBlob) {
            return { blob: originalBlob, width: img.width, height: img.height, ext: targetExt, mimeType: targetMime };
        }
        return {
            blob: await imageToBlob(img, targetMime, quality),
            width: img.width,
            height: img.height,
            ext: targetExt,
            mimeType: targetMime
        };
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
        ctx.drawImage(img, 0, 0, width, height);

        if (isGrayscale && outputFormat !== OUTPUT_FORMATS.PNG_4BIT && outputFormat !== OUTPUT_FORMATS.PNG_8BIT) {
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
    }

    let blob;
    if (outputFormat === OUTPUT_FORMATS.PNG_4BIT) {
        const encoded = encode4BitPng(canvas, { asBlob: true });
        if (encoded instanceof Blob || (encoded && typeof encoded === 'object' && encoded.type)) {
            blob = encoded;
        } else if (typeof Blob !== 'undefined') {
            blob = new Blob([encoded], { type: 'image/png' });
        } else {
            blob = encoded;
        }
    } else if (outputFormat === OUTPUT_FORMATS.PNG_8BIT) {
        const encoded = encode8BitPng(canvas, { asBlob: true });
        if (encoded instanceof Blob || (encoded && typeof encoded === 'object' && encoded.type)) {
            blob = encoded;
        } else if (typeof Blob !== 'undefined') {
            blob = new Blob([encoded], { type: 'image/png' });
        } else {
            blob = encoded;
        }
    } else {
        blob = await imageToBlob(canvas, targetMime, quality);
    }

    return { blob, width, height, ext: targetExt, mimeType: targetMime };
}

/**
 * Splits a wide spread image into left and right halves.
 * @param {HTMLImageElement | HTMLCanvasElement} img 
 * @param {string} [format=OUTPUT_FORMATS.ORIGINAL] 
 * @param {number} [quality=DEFAULT_JPEG_QUALITY] 
 * @returns {Promise<{ left: Blob, right: Blob, leftCanvas: HTMLCanvasElement, rightCanvas: HTMLCanvasElement, mimeType: string }>}
 */
export async function splitImage(img, format = OUTPUT_FORMATS.ORIGINAL, quality = DEFAULT_JPEG_QUALITY) {
    const width = img.width;
    const height = img.height;
    const halfWidth = Math.floor(width / 2);
    const mimeType = format === OUTPUT_FORMATS.JPEG ? 'image/jpeg' : 'image/png';

    // Left half
    const leftCanvas = document.createElement('canvas');
    leftCanvas.width = halfWidth;
    leftCanvas.height = height;
    const leftCtx = leftCanvas.getContext('2d');
    if (leftCtx) {
        leftCtx.drawImage(img, 0, 0, halfWidth, height, 0, 0, halfWidth, height);
    }
    const leftBlob = await imageToBlob(leftCanvas, mimeType, quality);

    // Right half (accounts for odd widths)
    const rightCanvas = document.createElement('canvas');
    const rightWidth = width - halfWidth;
    rightCanvas.width = rightWidth;
    rightCanvas.height = height;
    const rightCtx = rightCanvas.getContext('2d');
    if (rightCtx) {
        rightCtx.drawImage(img, halfWidth, 0, rightWidth, height, 0, 0, rightWidth, height);
    }
    const rightBlob = await imageToBlob(rightCanvas, mimeType, quality);

    return {
        left: leftBlob,
        right: rightBlob,
        leftCanvas,
        rightCanvas,
        mimeType
    };
}

/**
 * Processes a single page or spread image according to spreadMode and options.
 *
 * @param {HTMLImageElement | HTMLCanvasElement} img 
 * @param {Blob | null} [originalBlob=null] 
 * @param {Object} [options={}]
 * @param {string} [options.spreadMode=SPREAD_MODES.SPLIT] - 'off', 'split', 'rotate', 'both'
 * @param {string} [options.readingDirection=READING_DIRECTIONS.LTR] - 'ltr', 'rtl'
 * @param {boolean} [options.noRotate=false] - If true, do not rotate spread in rotate/both mode
 * @param {boolean} [options.rotateRight=false] - If true, rotate CW instead of CCW
 * @param {string} [options.spreadPosition=SPREAD_POSITIONS.AFTER] - 'after' or 'before' for both mode
 * @param {boolean | string | { width: number, height: number }} [options.targetDeviceOrFit=false]
 * @param {boolean} [options.isGrayscale=false]
 * @param {string} [options.outputFormat=OUTPUT_FORMATS.ORIGINAL]
 * @param {number} [options.quality=DEFAULT_JPEG_QUALITY]
 * @param {boolean} [options.isUpscale=true]
 * @param {string} [options.mimeType='image/jpeg']
 * @returns {Promise<Array<{ blob: Blob, width: number, height: number, ext: string, mimeType: string, suffix: string, type: string }>>}
 */
export async function processSpreadImage(img, originalBlob = null, options = {}) {
    const {
        spreadMode = SPREAD_MODES.SPLIT,
        readingDirection = READING_DIRECTIONS.LTR,
        noRotate = false,
        rotateRight = false,
        spreadPosition = SPREAD_POSITIONS.AFTER,
        targetDeviceOrFit = false,
        isGrayscale = false,
        outputFormat = OUTPUT_FORMATS.ORIGINAL,
        quality = DEFAULT_JPEG_QUALITY,
        isUpscale = true,
        mimeType = 'image/jpeg'
    } = options;

    const isImgSpread = isSpread(img.width, img.height);

    // If NOT spread or spreadMode === OFF
    if (!isImgSpread || spreadMode === SPREAD_MODES.OFF || spreadMode === 'off') {
        const res = await processImage(
            img,
            originalBlob,
            targetDeviceOrFit,
            isGrayscale,
            mimeType,
            outputFormat,
            quality,
            isUpscale
        );
        return [{
            ...res,
            suffix: '',
            type: isImgSpread ? PAGE_TYPES.SPREAD_CENTER : PAGE_TYPES.NORMAL
        }];
    }

    const isRtl = readingDirection === READING_DIRECTIONS.RTL || readingDirection === 'rtl';

    // SPLIT mode helper
    const processSplit = async () => {
        const halves = await splitImage(img, outputFormat, quality);
        const part1Canvas = isRtl ? halves.rightCanvas : halves.leftCanvas;
        const part2Canvas = isRtl ? halves.leftCanvas : halves.rightCanvas;
        const part1Suffix = isRtl ? '_right' : '_left';
        const part2Suffix = isRtl ? '_left' : '_right';

        const res1 = await processImage(
            part1Canvas,
            null,
            targetDeviceOrFit,
            isGrayscale,
            mimeType,
            outputFormat,
            quality,
            isUpscale
        );
        const res2 = await processImage(
            part2Canvas,
            null,
            targetDeviceOrFit,
            isGrayscale,
            mimeType,
            outputFormat,
            quality,
            isUpscale
        );

        const s1 = { ...res1, suffix: part1Suffix, type: PAGE_TYPES.SPREAD_PART_1 };
        const s2 = { ...res2, suffix: part2Suffix, type: PAGE_TYPES.SPREAD_PART_2 };
        return [s1, s2];
    };

    // ROTATE mode helper
    const processRotate = async () => {
        const isRotRight = rotateRight === true || rotateRight === 'cw' || rotateRight === ROTATION_DIRECTIONS.CW;
        const rotDir = isRotRight ? ROTATION_DIRECTIONS.CW : ROTATION_DIRECTIONS.CCW;
        const spreadImg = noRotate ? img : rotateImage(img, rotDir);
        const spreadBlob = noRotate ? originalBlob : null;

        const res = await processImage(
            spreadImg,
            spreadBlob,
            targetDeviceOrFit,
            isGrayscale,
            mimeType,
            outputFormat,
            quality,
            isUpscale
        );

        return { ...res, suffix: '_spread', type: PAGE_TYPES.SPREAD_CENTER };
    };

    if (spreadMode === SPREAD_MODES.SPLIT || spreadMode === 'split') {
        return await processSplit();
    }

    if (spreadMode === SPREAD_MODES.ROTATE || spreadMode === 'rotate') {
        const r = await processRotate();
        return [r];
    }

    if (spreadMode === SPREAD_MODES.BOTH || spreadMode === 'both') {
        const [s1, s2] = await processSplit();
        const r = await processRotate();
        const isBefore = spreadPosition === SPREAD_POSITIONS.BEFORE || spreadPosition === 'before';
        return isBefore ? [r, s1, s2] : [s1, s2, r];
    }

    // Default fallback: single page
    const res = await processImage(
        img,
        originalBlob,
        targetDeviceOrFit,
        isGrayscale,
        mimeType,
        outputFormat,
        quality,
        isUpscale
    );
    return [{
        ...res,
        suffix: '',
        type: isImgSpread ? PAGE_TYPES.SPREAD_CENTER : PAGE_TYPES.NORMAL
    }];
}
