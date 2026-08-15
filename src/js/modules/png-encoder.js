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
 * BitWriter for packing variable-length bitcodes into byte stream (RFC 1951, LSB-first).
 */
class BitWriter {
    constructor(initialCapacity = 65536) {
        this.buf = new Uint8Array(initialCapacity);
        this.bitPos = 0; // bit offset in current byte (0..7)
        this.bytePos = 0;
    }

    _ensure(extraBytes) {
        if (this.bytePos + extraBytes + 8 > this.buf.length) {
            const next = new Uint8Array(Math.max(this.buf.length * 2, this.bytePos + extraBytes + 65536));
            next.set(this.buf);
            this.buf = next;
        }
    }

    writeBits(value, numBits) {
        this._ensure((numBits + 7) >> 3);
        while (numBits > 0) {
            const bitsFree = 8 - this.bitPos;
            const bitsToWrite = Math.min(numBits, bitsFree);
            const mask = (1 << bitsToWrite) - 1;
            this.buf[this.bytePos] |= (value & mask) << this.bitPos;
            value >>>= bitsToWrite;
            numBits -= bitsToWrite;
            this.bitPos += bitsToWrite;
            if (this.bitPos === 8) {
                this.bitPos = 0;
                this.bytePos++;
            }
        }
    }

    finish() {
        if (this.bitPos > 0) {
            this.bytePos++;
            this.bitPos = 0;
        }
        return this.buf.subarray(0, this.bytePos);
    }
}

/**
 * Helper to reverse bit order for RFC 1951 Huffman code lookup.
 */
function bitReverse(code, len) {
    let res = 0;
    for (let i = 0; i < len; i++) {
        res = (res << 1) | ((code >>> i) & 1);
    }
    return res;
}

// Precomputed RFC 1951 Fixed Huffman tables (bit-reversed for fast direct writing)
const LIT_CODE = new Uint16Array(288);
const LIT_LEN = new Uint8Array(288);

for (let i = 0; i <= 143; i++) {
    LIT_CODE[i] = bitReverse(0x30 + i, 8);
    LIT_LEN[i] = 8;
}
for (let i = 144; i <= 255; i++) {
    LIT_CODE[i] = bitReverse(0x190 + (i - 144), 9);
    LIT_LEN[i] = 9;
}
for (let i = 256; i <= 279; i++) {
    LIT_CODE[i] = bitReverse(i - 256, 7);
    LIT_LEN[i] = 7;
}
for (let i = 280; i <= 287; i++) {
    LIT_CODE[i] = bitReverse(0xC0 + (i - 280), 8);
    LIT_LEN[i] = 8;
}

const DIST_CODE = new Uint16Array(32);
const DIST_LEN = new Uint8Array(32);
for (let i = 0; i < 32; i++) {
    DIST_CODE[i] = bitReverse(i, 5);
    DIST_LEN[i] = 5;
}

// RFC 1951 Length Base & Extra Bits
const LENGTH_BASE = Object.freeze([
    3, 4, 5, 6, 7, 8, 9, 10,
    11, 13, 15, 17, 19, 23, 27, 31,
    35, 43, 51, 59, 67, 83, 99, 115,
    131, 163, 195, 227, 258
]);
const LENGTH_EXTRA_BITS = Object.freeze([
    0, 0, 0, 0, 0, 0, 0, 0,
    1, 1, 1, 1, 2, 2, 2, 2,
    3, 3, 3, 3, 4, 4, 4, 4,
    5, 5, 5, 5, 0
]);

function getLengthCode(len) {
    if (len === 258) return [285, 0, 0];
    let code = 257;
    while (code < 285 && len >= LENGTH_BASE[code - 257 + 1]) {
        code++;
    }
    const extraBits = LENGTH_EXTRA_BITS[code - 257];
    const extraVal = len - LENGTH_BASE[code - 257];
    return [code, extraBits, extraVal];
}

// RFC 1951 Distance Base & Extra Bits
const DIST_BASE = Object.freeze([
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
    257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577
]);
const DIST_EXTRA_BITS = Object.freeze([
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
    7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13
]);

function getDistCode(dist) {
    let code = 0;
    while (code < 29 && dist >= DIST_BASE[code + 1]) {
        code++;
    }
    const extraBits = DIST_EXTRA_BITS[code];
    const extraVal = dist - DIST_BASE[code];
    return [code, extraBits, extraVal];
}

/**
 * Deflates data using RFC 1951 Deflate compression (LZ77 + Fixed Huffman) in RFC 1950 Zlib container.
 * High performance, zero external dependencies.
 * @param {Uint8Array} data 
 * @returns {Uint8Array}
 */
export function deflateZlib(data) {
    const writer = new BitWriter(Math.max(1024, (data.length >> 1) + 128));

    // Zlib Header: CMF = 0x78 (deflate, 32KB window), FLG = 0x9C (default compression level)
    // Verification: (0x78 * 256 + 0x9C) % 31 === 0
    writer.buf[0] = 0x78;
    writer.buf[1] = 0x9C;
    writer.bytePos = 2;

    // Block Header: BFINAL = 1, BTYPE = 01 (Fixed Huffman) -> 3 bits: 011 (0x03)
    writer.writeBits(0x03, 3);

    const len = data.length;
    const HASH_SIZE = 32768;
    const HASH_MASK = HASH_SIZE - 1;
    const head = new Int32Array(HASH_SIZE).fill(-1);
    const prev = new Int32Array(32768);

    let pos = 0;
    while (pos < len) {
        let matchLength = 0;
        let matchDist = 0;

        if (pos + 3 <= len) {
            const h = ((data[pos] << 10) ^ (data[pos + 1] << 5) ^ data[pos + 2]) & HASH_MASK;
            let cur = head[h];
            prev[pos & 32767] = cur;
            head[h] = pos;

            let chainLen = 32; // Optimized search depth for speed & high compression ratio
            while (cur !== -1 && (pos - cur) <= 32768 && chainLen-- > 0) {
                const dist = pos - cur;
                if (data[cur + matchLength] === data[pos + matchLength]) {
                    let k = 0;
                    const maxK = Math.min(258, len - pos);
                    while (k < maxK && data[cur + k] === data[pos + k]) {
                        k++;
                    }
                    if (k > matchLength && k >= 3) {
                        matchLength = k;
                        matchDist = dist;
                        if (matchLength === 258) break;
                    }
                }
                cur = prev[cur & 32767];
            }
        }

        if (matchLength >= 3) {
            // Encode Length
            const [lenCode, lenExtraBits, lenExtraVal] = getLengthCode(matchLength);
            writer.writeBits(LIT_CODE[lenCode], LIT_LEN[lenCode]);
            if (lenExtraBits > 0) {
                writer.writeBits(lenExtraVal, lenExtraBits);
            }

            // Encode Distance
            const [distCode, distExtraBits, distExtraVal] = getDistCode(matchDist);
            writer.writeBits(DIST_CODE[distCode], DIST_LEN[distCode]);
            if (distExtraBits > 0) {
                writer.writeBits(distExtraVal, distExtraBits);
            }

            // Insert skipped match positions into hash table
            for (let i = 1; i < matchLength && (pos + i + 2) < len; i++) {
                const h = ((data[pos + i] << 10) ^ (data[pos + i + 1] << 5) ^ data[pos + i + 2]) & HASH_MASK;
                prev[(pos + i) & 32767] = head[h];
                head[h] = pos + i;
            }
            pos += matchLength;
        } else {
            const byte = data[pos++];
            writer.writeBits(LIT_CODE[byte], LIT_LEN[byte]);
        }
    }

    // End of block: code 256 (7 bits: 0000000)
    writer.writeBits(LIT_CODE[256], LIT_LEN[256]);
    const compressed = writer.finish();

    // Append 4-byte Adler-32 checksum (RFC 1950)
    const adler = adler32(data);
    const result = new Uint8Array(compressed.length + 4);
    result.set(compressed, 0);
    result[compressed.length] = (adler >>> 24) & 0xFF;
    result[compressed.length + 1] = (adler >>> 16) & 0xFF;
    result[compressed.length + 2] = (adler >>> 8) & 0xFF;
    result[compressed.length + 3] = adler & 0xFF;

    return result;
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
