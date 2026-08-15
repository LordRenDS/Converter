/**
 * Pure JavaScript PNG Encoder for 4-bit (16-level grayscale E-Ink) and 8-bit grayscale PNGs.
 * Conforms to W3C PNG (ISO/IEC 15948) specification and KCC 16-level palette standard.
 */

// KCC 16-level grayscale palette (uniform shades 0..255 with step 17)
export const PALETTE_16 = Object.freeze([
    0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255
]);

// Standard PNG 8-byte file signature
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

// Precomputed CRC-32 lookup table (polynomial 0xEDB88320)
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    CRC_TABLE[i] = c >>> 0;
}

/**
 * Computes CRC-32 checksum of buffer slice.
 * @param {Uint8Array} buf 
 * @param {number} [offset=0] 
 * @param {number} [length] 
 * @returns {number} 32-bit unsigned integer
 */
export function crc32(buf, offset = 0, length = buf.length - offset) {
    let crc = 0xFFFFFFFF;
    const end = offset + length;
    for (let i = offset; i < end; i++) {
        crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

const ADLER_MOD = 65521;

/**
 * Computes Adler-32 checksum of buffer slice (RFC 1950).
 * @param {Uint8Array} buf 
 * @param {number} [offset=0] 
 * @param {number} [length] 
 * @returns {number} 32-bit unsigned integer
 */
export function adler32(buf, offset = 0, length = buf.length - offset) {
    let s1 = 1;
    let s2 = 0;
    const end = offset + length;
    let pos = offset;
    while (pos < end) {
        const blockEnd = Math.min(pos + 5550, end);
        while (pos < blockEnd) {
            s1 += buf[pos++];
            s2 += s1;
        }
        s1 %= ADLER_MOD;
        s2 %= ADLER_MOD;
    }
    return (((s2 << 16) | s1) >>> 0);
}

/**
 * Deflates data using RFC 1951 non-compressed (stored) blocks in RFC 1950 Zlib container.
 * Guaranteed to work in all JS environments without external dependencies.
 * @param {Uint8Array} data 
 * @returns {Uint8Array}
 */
export function deflateZlib(data) {
    const maxBlockSize = 65535;
    const len = data.length;
    const numBlocks = Math.ceil(len / maxBlockSize) || 1;
    const totalSize = 2 + (numBlocks * 5) + len + 4;
    const out = new Uint8Array(totalSize);

    // Zlib Header: CMF = 0x78 (deflate, 32KB window), FLG = 0x01 (check bits, level 0)
    out[0] = 0x78;
    out[1] = 0x01;

    let inOffset = 0;
    let outOffset = 2;

    for (let b = 0; b < numBlocks; b++) {
        const isLast = (b === numBlocks - 1);
        const blockSize = Math.min(maxBlockSize, len - inOffset);

        out[outOffset++] = isLast ? 0x01 : 0x00; // BFINAL (1 bit) + BTYPE 00 (stored)
        out[outOffset++] = blockSize & 0xFF;
        out[outOffset++] = (blockSize >>> 8) & 0xFF;
        const nlen = (~blockSize) & 0xFFFF;
        out[outOffset++] = nlen & 0xFF;
        out[outOffset++] = (nlen >>> 8) & 0xFF;

        out.set(data.subarray(inOffset, inOffset + blockSize), outOffset);
        outOffset += blockSize;
        inOffset += blockSize;
    }

    // Adler-32 checksum (4 bytes big-endian)
    const adler = adler32(data);
    out[outOffset++] = (adler >>> 24) & 0xFF;
    out[outOffset++] = (adler >>> 16) & 0xFF;
    out[outOffset++] = (adler >>> 8) & 0xFF;
    out[outOffset++] = adler & 0xFF;

    return out;
}

/**
 * Creates a PNG chunk with length, type, payload, and CRC-32.
 * @param {string} typeStr 4-character ASCII chunk type
 * @param {Uint8Array} dataUint8 Chunk payload
 * @returns {Uint8Array} Complete chunk bytes
 */
function createChunk(typeStr, dataUint8) {
    const length = dataUint8.length;
    const chunk = new Uint8Array(12 + length);
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);

    // 1. Length (4 bytes big-endian)
    view.setUint32(0, length, false);

    // 2. Type (4 bytes ASCII)
    for (let i = 0; i < 4; i++) {
        chunk[4 + i] = typeStr.charCodeAt(i);
    }

    // 3. Data
    if (length > 0) {
        chunk.set(dataUint8, 8);
    }

    // 4. CRC-32 (calculated over type and data)
    const crcVal = crc32(chunk, 4, 4 + length);
    view.setUint32(8 + length, crcVal, false);

    return chunk;
}

/**
 * Combines multiple Uint8Arrays into a single Uint8Array.
 * @param {...Uint8Array} buffers 
 * @returns {Uint8Array}
 */
function concatBuffers(...buffers) {
    let totalLength = 0;
    for (const b of buffers) {
        totalLength += b.length;
    }
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const b of buffers) {
        result.set(b, offset);
        offset += b.length;
    }
    return result;
}

/**
 * Normalizes input image source to { width, height, data }.
 * @param {ImageData|HTMLCanvasElement|{width:number, height:number, data:ArrayLike<number>}} input 
 * @returns {{width: number, height: number, data: ArrayLike<number>}}
 */
function normalizeImageData(input) {
    if (!input) {
        throw new Error('Image data is required');
    }
    if (typeof HTMLCanvasElement !== 'undefined' && input instanceof HTMLCanvasElement) {
        const ctx = input.getContext('2d');
        return ctx.getImageData(0, 0, input.width, input.height);
    }
    if (input.getContext && typeof input.getContext === 'function') {
        const ctx = input.getContext('2d');
        return ctx.getImageData(0, 0, input.width, input.height);
    }
    if (typeof input.width === 'number' && typeof input.height === 'number' && input.data) {
        return input;
    }
    throw new Error('Invalid image data: expected ImageData, canvas, or {width, height, data}');
}

/**
 * Encodes RGBA image data to a 4-bit indexed PNG using the 16-level KCC E-Ink grayscale palette.
 * @param {ImageData|HTMLCanvasElement|Object} imageSource 
 * @param {Object} [options]
 * @param {boolean} [options.asBlob=false]
 * @returns {Uint8Array|Blob}
 */
export function encode4BitPng(imageSource, options = {}) {
    const { width, height, data } = normalizeImageData(imageSource);
    if (width <= 0 || height <= 0) {
        throw new Error(`Invalid image dimensions: ${width}x${height}`);
    }

    // 1. Scanlines: each row has 1 filter byte (0x00) + Math.ceil(width / 2) packed pixel bytes
    const rowBytes = Math.ceil(width / 2);
    const scanlines = new Uint8Array(height * (1 + rowBytes));
    let scanOffset = 0;
    let pixelIndex = 0;

    for (let y = 0; y < height; y++) {
        scanlines[scanOffset++] = 0x00; // Filter type 0 (None)

        for (let x = 0; x < width; x += 2) {
            // First pixel (high nibble)
            const r0 = data[pixelIndex];
            const g0 = data[pixelIndex + 1];
            const b0 = data[pixelIndex + 2];
            pixelIndex += 4;
            const y0 = Math.round(0.299 * r0 + 0.587 * g0 + 0.114 * b0);
            const idx0 = Math.min(15, Math.max(0, Math.round(y0 / 17)));

            // Second pixel (low nibble) if present in row
            let idx1 = 0;
            if (x + 1 < width) {
                const r1 = data[pixelIndex];
                const g1 = data[pixelIndex + 1];
                const b1 = data[pixelIndex + 2];
                pixelIndex += 4;
                const y1 = Math.round(0.299 * r1 + 0.587 * g1 + 0.114 * b1);
                idx1 = Math.min(15, Math.max(0, Math.round(y1 / 17)));
            }

            scanlines[scanOffset++] = (idx0 << 4) | (idx1 & 0x0F);
        }
    }

    // 2. IHDR chunk (13 bytes)
    const ihdrPayload = new Uint8Array(13);
    const ihdrView = new DataView(ihdrPayload.buffer);
    ihdrView.setUint32(0, width, false);
    ihdrView.setUint32(4, height, false);
    ihdrPayload[8] = 4; // Bit depth: 4
    ihdrPayload[9] = 3; // Color type: 3 (Indexed)
    ihdrPayload[10] = 0; // Compression: 0 (Deflate)
    ihdrPayload[11] = 0; // Filter: 0 (Standard)
    ihdrPayload[12] = 0; // Interlace: 0 (None)
    const ihdrChunk = createChunk('IHDR', ihdrPayload);

    // 3. PLTE chunk (48 bytes: 16 RGB triplets)
    const pltePayload = new Uint8Array(48);
    for (let i = 0; i < 16; i++) {
        const val = PALETTE_16[i];
        pltePayload[i * 3] = val;
        pltePayload[i * 3 + 1] = val;
        pltePayload[i * 3 + 2] = val;
    }
    const plteChunk = createChunk('PLTE', pltePayload);

    // 4. IDAT chunk (Deflated scanlines)
    const deflated = deflateZlib(scanlines);
    const idatChunk = createChunk('IDAT', deflated);

    // 5. IEND chunk (0 bytes)
    const iendChunk = createChunk('IEND', new Uint8Array(0));

    // Combine all chunks into PNG
    const pngBytes = concatBuffers(PNG_SIGNATURE, ihdrChunk, plteChunk, idatChunk, iendChunk);

    if (options.asBlob && typeof Blob !== 'undefined') {
        return new Blob([pngBytes], { type: 'image/png' });
    }
    return pngBytes;
}

/**
 * Encodes RGBA image data to an 8-bit grayscale PNG.
 * @param {ImageData|HTMLCanvasElement|Object} imageSource 
 * @param {Object} [options]
 * @param {boolean} [options.asBlob=false]
 * @returns {Uint8Array|Blob}
 */
export function encode8BitPng(imageSource, options = {}) {
    const { width, height, data } = normalizeImageData(imageSource);
    if (width <= 0 || height <= 0) {
        throw new Error(`Invalid image dimensions: ${width}x${height}`);
    }

    // 1. Scanlines: each row has 1 filter byte (0x00) + width luminance bytes
    const scanlines = new Uint8Array(height * (1 + width));
    let scanOffset = 0;
    let pixelIndex = 0;

    for (let y = 0; y < height; y++) {
        scanlines[scanOffset++] = 0x00; // Filter type 0 (None)

        for (let x = 0; x < width; x++) {
            const r = data[pixelIndex];
            const g = data[pixelIndex + 1];
            const b = data[pixelIndex + 2];
            pixelIndex += 4;
            const lum = Math.min(255, Math.max(0, Math.round(0.299 * r + 0.587 * g + 0.114 * b)));
            scanlines[scanOffset++] = lum;
        }
    }

    // 2. IHDR chunk (13 bytes)
    const ihdrPayload = new Uint8Array(13);
    const ihdrView = new DataView(ihdrPayload.buffer);
    ihdrView.setUint32(0, width, false);
    ihdrView.setUint32(4, height, false);
    ihdrPayload[8] = 8; // Bit depth: 8
    ihdrPayload[9] = 0; // Color type: 0 (Grayscale)
    ihdrPayload[10] = 0; // Compression: 0 (Deflate)
    ihdrPayload[11] = 0; // Filter: 0 (Standard)
    ihdrPayload[12] = 0; // Interlace: 0 (None)
    const ihdrChunk = createChunk('IHDR', ihdrPayload);

    // 3. IDAT chunk (Deflated scanlines)
    const deflated = deflateZlib(scanlines);
    const idatChunk = createChunk('IDAT', deflated);

    // 4. IEND chunk (0 bytes)
    const iendChunk = createChunk('IEND', new Uint8Array(0));

    // Combine all chunks into PNG
    const pngBytes = concatBuffers(PNG_SIGNATURE, ihdrChunk, idatChunk, iendChunk);

    if (options.asBlob && typeof Blob !== 'undefined') {
        return new Blob([pngBytes], { type: 'image/png' });
    }
    return pngBytes;
}
