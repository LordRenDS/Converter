/**
 * Application constants and presets
 */

export const DEVICE_PRESETS = {
    KINDLE_PW12: {
        width: 1264,
        height: 1680
    }
};

export const READING_DIRECTIONS = {
    LTR: 'ltr',
    RTL: 'rtl'
};

export const COVER_SOURCES = {
    PAGE: 'page',
    CUSTOM: 'custom'
};

export const OUTPUT_FORMATS = {
    ORIGINAL: 'original',
    JPEG: 'jpeg'
};

export const DEFAULT_JPEG_QUALITY = 0.85;

export const SUPPORTED_IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp)$/i;

export const MIME_TYPES = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp'
};
