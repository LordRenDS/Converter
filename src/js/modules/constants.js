/**
 * Application constants and presets
 */

export const DEVICE_PRESETS = {
    ORIGINAL: {
        id: 'original',
        name: 'Original (No resize)',
        width: 0,
        height: 0
    },
    KINDLE_PW12: {
        id: 'kindle_pw12',
        name: 'Kindle Paperwhite 12 (7" - 1272x1696)',
        width: 1272,
        height: 1696
    },
    KINDLE_PW11: {
        id: 'kindle_pw11',
        name: 'Kindle Paperwhite 11 (6.8" - 1236x1648)',
        width: 1236,
        height: 1648
    },
    KINDLE_OASIS: {
        id: 'kindle_oasis',
        name: 'Kindle Oasis 2/3 (7" - 1264x1680)',
        width: 1264,
        height: 1680
    },
    KINDLE_PW34: {
        id: 'kindle_pw34',
        name: 'Kindle Paperwhite 3/4 / Voyage / Basic (6" - 1072x1448)',
        width: 1072,
        height: 1448
    },
    KINDLE_SCRIBE: {
        id: 'kindle_scribe',
        name: 'Kindle Scribe (10.2" - 1860x2480)',
        width: 1860,
        height: 2480
    }
};

export function getDevicePreset(keyOrId) {
    if (!keyOrId) return DEVICE_PRESETS.ORIGINAL;
    if (typeof keyOrId === 'object' && typeof keyOrId.width === 'number' && typeof keyOrId.height === 'number') {
        return keyOrId;
    }
    const normalized = String(keyOrId).toLowerCase().replace(/[-_]/g, '');
    for (const key of Object.keys(DEVICE_PRESETS)) {
        const preset = DEVICE_PRESETS[key];
        const pKeyNorm = key.toLowerCase().replace(/[-_]/g, '');
        const pIdNorm = preset.id.toLowerCase().replace(/[-_]/g, '');
        if (normalized === pKeyNorm || normalized === pIdNorm) {
            return preset;
        }
    }
    return DEVICE_PRESETS.ORIGINAL;
}

export const READING_DIRECTIONS = {
    LTR: 'ltr',
    RTL: 'rtl'
};

export const SPREAD_MODES = {
    OFF: 'off',
    SPLIT: 'split',
    ROTATE: 'rotate',
    BOTH: 'both'
};

export const SPREAD_POSITIONS = {
    AFTER: 'after',
    BEFORE: 'before'
};

export const ROTATION_DIRECTIONS = {
    CCW: 'ccw',
    CW: 'cw'
};

export const COVER_SOURCES = {
    PAGE: 'page',
    CUSTOM: 'custom'
};

export const OUTPUT_FORMATS = {
    ORIGINAL: 'original',
    JPEG: 'jpeg',
    PNG: 'png',
    PNG_8BIT: 'png_8bit',
    PNG_4BIT: 'png_4bit'
};


export const DEFAULT_JPEG_QUALITY = 0.85;

export const AUTO_CROP_THRESHOLD = 0.02;
export const DEFAULT_MAX_CROP_RATIO = 0.10;

export const SUPPORTED_IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp)$/i;

export const MIME_TYPES = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp'
};
