import unittest
import json
import subprocess
import shutil
import base64
import struct
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = REPO_ROOT / 'src' / 'js' / 'modules' / 'image-processor.js'

def get_node_executable():
    for candidate in [
        shutil.which('node'),
        shutil.which('agy-node.cmd'),
        r'C:\Users\serge\AppData\Roaming\Antigravity\bin\agy-node.cmd',
        r'C:\Program Files\nodejs\node.exe'
    ]:
        if candidate and Path(candidate).exists():
            return str(candidate)
    raise RuntimeError("No Node.js / agy-node executable found on system.")

NODE_EXE = get_node_executable()

def run_js_eval(code: str):
    """Executes a JS script using node and returns JSON parsed output."""
    cmd = [NODE_EXE, '--input-type=module']
    result = subprocess.run(
        cmd,
        input=code,
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        check=False
    )
    if result.returncode != 0:
        raise RuntimeError(f"JS execution error (code {result.returncode}):\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}")
    return json.loads(result.stdout.strip())

class TestImageProcessor(unittest.TestCase):
    def setUp(self):
        self.mock_env = r"""
        globalThis.Blob = class Blob {
            constructor(parts = [], options = {}) {
                this.parts = parts;
                this.type = options?.type || '';
                this.size = parts.reduce((acc, p) => acc + (p.length || p.byteLength || 0), 0);
            }
            arrayBuffer() {
                let totalLen = 0;
                for (const p of this.parts) {
                    totalLen += p.byteLength || p.length || 0;
                }
                const buf = new Uint8Array(totalLen);
                let offset = 0;
                for (const p of this.parts) {
                    if (p instanceof Uint8Array) {
                        buf.set(p, offset);
                        offset += p.length;
                    } else if (typeof p === 'string') {
                        const encoded = new TextEncoder().encode(p);
                        buf.set(encoded, offset);
                        offset += encoded.length;
                    }
                }
                return Promise.resolve(buf.buffer);
            }
        };

        globalThis.HTMLCanvasElement = class HTMLCanvasElement {
            constructor() {
                this.width = 0;
                this.height = 0;
                this._transforms = [];
                this._pixels = null;
            }
            _ensurePixels() {
                const len = (this.width || 1) * (this.height || 1) * 4;
                if (!this._pixels || this._pixels.length !== len) {
                    this._pixels = new Uint8ClampedArray(len);
                    for (let i = 0; i < len; i += 4) {
                        this._pixels[i] = 128;
                        this._pixels[i + 1] = 128;
                        this._pixels[i + 2] = 128;
                        this._pixels[i + 3] = 255;
                    }
                }
                return this._pixels;
            }
            getContext(type) {
                const self = this;
                return {
                    translate: (x, y) => self._transforms.push({ op: 'translate', x, y }),
                    rotate: (rad) => self._transforms.push({ op: 'rotate', rad }),
                    drawImage: (img, ...args) => {
                        self._drawn = { img, args };
                        self._ensurePixels();
                        if (img && img._pixels) {
                            if (args.length === 8) {
                                const [sx, sy, sw, sh, dx, dy, dw, dh] = args;
                                for (let r = 0; r < dh; r++) {
                                    for (let c = 0; c < dw; c++) {
                                        const srcX = Math.floor(sx + (c / dw) * sw);
                                        const srcY = Math.floor(sy + (r / dh) * sh);
                                        const dstX = Math.floor(dx + c);
                                        const dstY = Math.floor(dy + r);
                                        if (dstX >= 0 && dstX < self.width && dstY >= 0 && dstY < self.height &&
                                            srcX >= 0 && srcX < img.width && srcY >= 0 && srcY < img.height) {
                                            const srcIdx = (srcY * img.width + srcX) * 4;
                                            const dstIdx = (dstY * self.width + dstX) * 4;
                                            for (let k = 0; k < 4; k++) {
                                                self._pixels[dstIdx + k] = img._pixels[srcIdx + k];
                                            }
                                        }
                                    }
                                }
                            } else if (args.length === 4) {
                                const [dx, dy, dw, dh] = args;
                                for (let r = 0; r < dh; r++) {
                                    for (let c = 0; c < dw; c++) {
                                        const srcX = Math.floor((c / dw) * img.width);
                                        const srcY = Math.floor((r / dh) * img.height);
                                        const dstX = Math.floor(dx + c);
                                        const dstY = Math.floor(dy + r);
                                        if (dstX >= 0 && dstX < self.width && dstY >= 0 && dstY < self.height &&
                                            srcX >= 0 && srcX < img.width && srcY >= 0 && srcY < img.height) {
                                            const srcIdx = (srcY * img.width + srcX) * 4;
                                            const dstIdx = (dstY * self.width + dstX) * 4;
                                            for (let k = 0; k < 4; k++) {
                                                self._pixels[dstIdx + k] = img._pixels[srcIdx + k];
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    getImageData: (sx, sy, sw, sh) => {
                        const pixels = self._ensurePixels();
                        const len = (sw || self.width || 1) * (sh || self.height || 1) * 4;
                        if (sx === 0 && sy === 0 && (sw === self.width || !sw) && (sh === self.height || !sh)) {
                            return { width: self.width, height: self.height, data: pixels };
                        }
                        const subData = new Uint8ClampedArray(len);
                        for (let r = 0; r < sh; r++) {
                            for (let c = 0; c < sw; c++) {
                                const srcX = sx + c;
                                const srcY = sy + r;
                                const dstIdx = (r * sw + c) * 4;
                                if (srcX >= 0 && srcX < self.width && srcY >= 0 && srcY < self.height) {
                                    const srcIdx = (srcY * self.width + srcX) * 4;
                                    for (let k = 0; k < 4; k++) {
                                        subData[dstIdx + k] = pixels[srcIdx + k];
                                    }
                                }
                            }
                        }
                        return { width: sw, height: sh, data: subData };
                    },
                    putImageData: (imgData, dx, dy) => {
                        self._putData = { imgData, dx, dy };
                        self._pixels = new Uint8ClampedArray(imgData.data);
                    }
                };
            }
            toBlob(callback, type = 'image/jpeg', quality) {
                const blob = new globalThis.Blob([`mock-canvas-${this.width}x${this.height}`], { type });
                setTimeout(() => callback(blob), 0);
            }
        };

        globalThis.HTMLImageElement = class HTMLImageElement {
            constructor(w = 1000, h = 1500) {
                this.width = w;
                this.height = h;
            }
        };

        globalThis.document = {
            createElement: (tag) => {
                if (tag === 'canvas') return new globalThis.HTMLCanvasElement();
                return {};
            }
        };
        """

    def test_module_exists(self):
        self.assertTrue(MODULE_PATH.exists(), f"Module file must exist at {MODULE_PATH}")

    # --- isSpread tests ---
    def test_is_spread_threshold(self):
        code = f"""
        {self.mock_env}
        import {{ isSpread }} from './src/js/modules/image-processor.js';
        const results = {{
            wide_1200_1000: isSpread(1200, 1000),     // ratio 1.2 > 1.16 -> true
            wide_1161_1000: isSpread(1161, 1000),     // ratio 1.161 > 1.16 -> true
            border_1160_1000: isSpread(1160, 1000),   // ratio 1.160 <= 1.16 -> false
            narrow_1100_1000: isSpread(1100, 1000),   // ratio 1.10 <= 1.16 -> false
            square_1000_1000: isSpread(1000, 1000),   // ratio 1.00 <= 1.16 -> false
            tall_1000_1200: isSpread(1000, 1200),     // portrait -> false
            wide_2000_1000: isSpread(2000, 1000)      // ratio 2.0 > 1.16 -> true
        }};
        console.log(JSON.stringify(results));
        """
        res = run_js_eval(code)
        self.assertTrue(res['wide_1200_1000'])
        self.assertTrue(res['wide_1161_1000'])
        self.assertFalse(res['border_1160_1000'])
        self.assertFalse(res['narrow_1100_1000'])
        self.assertFalse(res['square_1000_1000'])
        self.assertFalse(res['tall_1000_1200'])
        self.assertTrue(res['wide_2000_1000'])

    # --- rotateImage tests ---
    def test_rotate_image_ccw_default(self):
        code = f"""
        {self.mock_env}
        import {{ rotateImage }} from './src/js/modules/image-processor.js';
        const img = new HTMLImageElement(2000, 1000);
        const canvas = rotateImage(img); // default 'ccw'
        console.log(JSON.stringify({{
            width: canvas.width,
            height: canvas.height,
            transforms: canvas._transforms
        }}));
        """
        res = run_js_eval(code)
        self.assertEqual(res['width'], 1000)
        self.assertEqual(res['height'], 2000)
        self.assertEqual(len(res['transforms']), 2)
        self.assertEqual(res['transforms'][0], {'op': 'translate', 'x': 0, 'y': 2000})
        self.assertAlmostEqual(res['transforms'][1]['rad'], -1.5707963267948966, places=5)

    def test_rotate_image_cw(self):
        code = f"""
        {self.mock_env}
        import {{ rotateImage }} from './src/js/modules/image-processor.js';
        const img = new HTMLImageElement(2000, 1000);
        const canvas = rotateImage(img, 'cw');
        console.log(JSON.stringify({{
            width: canvas.width,
            height: canvas.height,
            transforms: canvas._transforms
        }}));
        """
        res = run_js_eval(code)
        self.assertEqual(res['width'], 1000)
        self.assertEqual(res['height'], 2000)
        self.assertEqual(len(res['transforms']), 2)
        self.assertEqual(res['transforms'][0], {'op': 'translate', 'x': 1000, 'y': 0})
        self.assertAlmostEqual(res['transforms'][1]['rad'], 1.5707963267948966, places=5)

    # --- processImage format tests ---
    def test_process_image_png_4bit(self):
        code = f"""
        {self.mock_env}
        import {{ processImage }} from './src/js/modules/image-processor.js';
        import {{ OUTPUT_FORMATS }} from './src/js/modules/constants.js';

        async function run() {{
            const img = new HTMLImageElement(100, 200);
            const res = await processImage(
                img,
                null,
                false,
                false,
                'image/jpeg',
                OUTPUT_FORMATS.PNG_4BIT
            );
            const buf = await res.blob.arrayBuffer();
            const b64 = Buffer.from(buf).toString('base64');
            console.log(JSON.stringify({{
                width: res.width,
                height: res.height,
                ext: res.ext,
                mimeType: res.mimeType,
                b64: b64
            }}));
        }}
        run();
        """
        res = run_js_eval(code)
        self.assertEqual(res['width'], 100)
        self.assertEqual(res['height'], 200)
        self.assertEqual(res['ext'], 'png')
        self.assertEqual(res['mimeType'], 'image/png')

        png_bytes = base64.b64decode(res['b64'])
        self.assertTrue(png_bytes.startswith(b'\x89PNG\r\n\x1a\n'))
        # Check IHDR color type is 3 (indexed) and bit depth is 4
        ihdr_offset = 8
        ihdr_len = struct.unpack('>I', png_bytes[ihdr_offset:ihdr_offset+4])[0]
        ihdr_data = png_bytes[ihdr_offset+8:ihdr_offset+8+ihdr_len]
        w, h, bit_depth, color_type = struct.unpack('>IIBB', ihdr_data[:10])
        self.assertEqual(w, 100)
        self.assertEqual(h, 200)
        self.assertEqual(bit_depth, 4)
        self.assertEqual(color_type, 3)

    def test_process_image_png_8bit(self):
        code = f"""
        {self.mock_env}
        import {{ processImage }} from './src/js/modules/image-processor.js';
        import {{ OUTPUT_FORMATS }} from './src/js/modules/constants.js';

        async function run() {{
            const img = new HTMLImageElement(120, 180);
            const res = await processImage(
                img,
                null,
                false,
                false,
                'image/jpeg',
                OUTPUT_FORMATS.PNG_8BIT
            );
            const buf = await res.blob.arrayBuffer();
            const b64 = Buffer.from(buf).toString('base64');
            console.log(JSON.stringify({{
                width: res.width,
                height: res.height,
                ext: res.ext,
                mimeType: res.mimeType,
                b64: b64
            }}));
        }}
        run();
        """
        res = run_js_eval(code)
        self.assertEqual(res['width'], 120)
        self.assertEqual(res['height'], 180)
        self.assertEqual(res['ext'], 'png')
        self.assertEqual(res['mimeType'], 'image/png')

        png_bytes = base64.b64decode(res['b64'])
        self.assertTrue(png_bytes.startswith(b'\x89PNG\r\n\x1a\n'))
        # Check IHDR color type is 0 (grayscale) and bit depth is 8
        ihdr_offset = 8
        ihdr_len = struct.unpack('>I', png_bytes[ihdr_offset:ihdr_offset+4])[0]
        ihdr_data = png_bytes[ihdr_offset+8:ihdr_offset+8+ihdr_len]
        w, h, bit_depth, color_type = struct.unpack('>IIBB', ihdr_data[:10])
        self.assertEqual(w, 120)
        self.assertEqual(h, 180)
        self.assertEqual(bit_depth, 8)
        self.assertEqual(color_type, 0)

    def test_process_image_jpeg_and_png(self):
        code = f"""
        {self.mock_env}
        import {{ processImage }} from './src/js/modules/image-processor.js';
        import {{ OUTPUT_FORMATS }} from './src/js/modules/constants.js';

        async function run() {{
            const img = new HTMLImageElement(100, 100);
            const jpegRes = await processImage(img, null, false, false, 'image/jpeg', OUTPUT_FORMATS.JPEG);
            const pngRes = await processImage(img, null, false, false, 'image/png', OUTPUT_FORMATS.PNG);
            console.log(JSON.stringify({{
                jpeg: {{ ext: jpegRes.ext, mimeType: jpegRes.mimeType }},
                png: {{ ext: pngRes.ext, mimeType: pngRes.mimeType }}
            }}));
        }}
        run();
        """
        res = run_js_eval(code)
        self.assertEqual(res['jpeg']['ext'], 'jpg')
        self.assertEqual(res['jpeg']['mimeType'], 'image/jpeg')
        self.assertEqual(res['png']['ext'], 'png')
        self.assertEqual(res['png']['mimeType'], 'image/png')

    # --- processSpreadImage tests ---
    def test_process_spread_image_portrait_normal(self):
        code = f"""
        {self.mock_env}
        import {{ processSpreadImage }} from './src/js/modules/image-processor.js';
        import {{ SPREAD_MODES }} from './src/js/modules/constants.js';

        async function run() {{
            const img = new HTMLImageElement(1000, 1500); // Portrait
            const originalBlob = new Blob(['orig'], {{ type: 'image/jpeg' }});
            const pages = await processSpreadImage(img, originalBlob, {{
                spreadMode: SPREAD_MODES.SPLIT
            }});
            console.log(JSON.stringify(pages.map(p => ({{
                suffix: p.suffix,
                type: p.type,
                width: p.width,
                height: p.height,
                ext: p.ext,
                mimeType: p.mimeType
            }}))));
        }}
        run();
        """
        res = run_js_eval(code)
        self.assertEqual(len(res), 1)
        self.assertEqual(res[0]['suffix'], '')
        self.assertEqual(res[0]['type'], 'N')
        self.assertEqual(res[0]['width'], 1000)
        self.assertEqual(res[0]['height'], 1500)

    def test_process_spread_image_mode_off(self):
        code = f"""
        {self.mock_env}
        import {{ processSpreadImage }} from './src/js/modules/image-processor.js';
        import {{ SPREAD_MODES }} from './src/js/modules/constants.js';

        async function run() {{
            const img = new HTMLImageElement(2000, 1000); // Spread
            const originalBlob = new Blob(['orig'], {{ type: 'image/jpeg' }});
            const pages = await processSpreadImage(img, originalBlob, {{
                spreadMode: SPREAD_MODES.OFF
            }});
            console.log(JSON.stringify(pages.map(p => ({{
                suffix: p.suffix,
                type: p.type,
                width: p.width,
                height: p.height
            }}))));
        }}
        run();
        """
        res = run_js_eval(code)
        self.assertEqual(len(res), 1)
        self.assertEqual(res[0]['suffix'], '')
        self.assertEqual(res[0]['type'], 'R') # Landscape treated as spread center
        self.assertEqual(res[0]['width'], 2000)
        self.assertEqual(res[0]['height'], 1000)

    def test_process_spread_image_split_ltr(self):
        code = f"""
        {self.mock_env}
        import {{ processSpreadImage }} from './src/js/modules/image-processor.js';
        import {{ SPREAD_MODES, READING_DIRECTIONS }} from './src/js/modules/constants.js';

        async function run() {{
            const img = new HTMLImageElement(2000, 1000);
            const originalBlob = new Blob(['orig'], {{ type: 'image/jpeg' }});
            const pages = await processSpreadImage(img, originalBlob, {{
                spreadMode: SPREAD_MODES.SPLIT,
                readingDirection: READING_DIRECTIONS.LTR
            }});
            console.log(JSON.stringify(pages.map(p => ({{
                suffix: p.suffix,
                type: p.type,
                width: p.width,
                height: p.height
            }}))));
        }}
        run();
        """
        res = run_js_eval(code)
        self.assertEqual(len(res), 2)
        self.assertEqual(res[0]['suffix'], '_left')
        self.assertEqual(res[0]['type'], 'S1')
        self.assertEqual(res[0]['width'], 1000)
        self.assertEqual(res[0]['height'], 1000)
        self.assertEqual(res[1]['suffix'], '_right')
        self.assertEqual(res[1]['type'], 'S2')
        self.assertEqual(res[1]['width'], 1000)
        self.assertEqual(res[1]['height'], 1000)

    def test_process_spread_image_split_rtl(self):
        code = f"""
        {self.mock_env}
        import {{ processSpreadImage }} from './src/js/modules/image-processor.js';
        import {{ SPREAD_MODES, READING_DIRECTIONS }} from './src/js/modules/constants.js';

        async function run() {{
            const img = new HTMLImageElement(2000, 1000);
            const originalBlob = new Blob(['orig'], {{ type: 'image/jpeg' }});
            const pages = await processSpreadImage(img, originalBlob, {{
                spreadMode: SPREAD_MODES.SPLIT,
                readingDirection: READING_DIRECTIONS.RTL
            }});
            console.log(JSON.stringify(pages.map(p => ({{
                suffix: p.suffix,
                type: p.type,
                width: p.width,
                height: p.height
            }}))));
        }}
        run();
        """
        res = run_js_eval(code)
        self.assertEqual(len(res), 2)
        self.assertEqual(res[0]['suffix'], '_right')
        self.assertEqual(res[0]['type'], 'S1')
        self.assertEqual(res[0]['width'], 1000)
        self.assertEqual(res[0]['height'], 1000)
        self.assertEqual(res[1]['suffix'], '_left')
        self.assertEqual(res[1]['type'], 'S2')
        self.assertEqual(res[1]['width'], 1000)
        self.assertEqual(res[1]['height'], 1000)

    def test_process_spread_image_rotate_ccw_and_cw(self):
        code = f"""
        {self.mock_env}
        import {{ processSpreadImage }} from './src/js/modules/image-processor.js';
        import {{ SPREAD_MODES }} from './src/js/modules/constants.js';

        async function run() {{
            const img = new HTMLImageElement(2000, 1000);
            const originalBlob = new Blob(['orig'], {{ type: 'image/jpeg' }});
            
            const ccwPages = await processSpreadImage(img, originalBlob, {{
                spreadMode: SPREAD_MODES.ROTATE,
                rotateRight: false,
                noRotate: false
            }});

            const cwPages = await processSpreadImage(img, originalBlob, {{
                spreadMode: SPREAD_MODES.ROTATE,
                rotateRight: true,
                noRotate: false
            }});

            const noRotPages = await processSpreadImage(img, originalBlob, {{
                spreadMode: SPREAD_MODES.ROTATE,
                noRotate: true
            }});

            console.log(JSON.stringify({{
                ccw: ccwPages.map(p => ({{ suffix: p.suffix, type: p.type, width: p.width, height: p.height }})),
                cw: cwPages.map(p => ({{ suffix: p.suffix, type: p.type, width: p.width, height: p.height }})),
                noRot: noRotPages.map(p => ({{ suffix: p.suffix, type: p.type, width: p.width, height: p.height }}))
            }}));
        }}
        run();
        """
        res = run_js_eval(code)
        # CCW (90 left): 2000x1000 -> 1000x2000
        self.assertEqual(res['ccw'], [{ 'suffix': '_spread', 'type': 'R', 'width': 1000, 'height': 2000 }])
        # CW (90 right): 2000x1000 -> 1000x2000
        self.assertEqual(res['cw'], [{ 'suffix': '_spread', 'type': 'R', 'width': 1000, 'height': 2000 }])
        # noRotate: 2000x1000 stays 2000x1000
        self.assertEqual(res['noRot'], [{ 'suffix': '_spread', 'type': 'R', 'width': 2000, 'height': 1000 }])

    def test_process_spread_image_both_after_and_before(self):
        code = f"""
        {self.mock_env}
        import {{ processSpreadImage }} from './src/js/modules/image-processor.js';
        import {{ SPREAD_MODES, SPREAD_POSITIONS, READING_DIRECTIONS }} from './src/js/modules/constants.js';

        async function run() {{
            const img = new HTMLImageElement(2000, 1000);
            const originalBlob = new Blob(['orig'], {{ type: 'image/jpeg' }});
            
            const afterPages = await processSpreadImage(img, originalBlob, {{
                spreadMode: SPREAD_MODES.BOTH,
                readingDirection: READING_DIRECTIONS.LTR,
                spreadPosition: SPREAD_POSITIONS.AFTER
            }});

            const beforePages = await processSpreadImage(img, originalBlob, {{
                spreadMode: SPREAD_MODES.BOTH,
                readingDirection: READING_DIRECTIONS.LTR,
                spreadPosition: SPREAD_POSITIONS.BEFORE
            }});

            console.log(JSON.stringify({{
                after: afterPages.map(p => ({{ suffix: p.suffix, type: p.type }})),
                before: beforePages.map(p => ({{ suffix: p.suffix, type: p.type }}))
            }}));
        }}
        run();
        """
        res = run_js_eval(code)
        # SPREAD_POSITIONS.AFTER: [S1, S2, R]
        self.assertEqual(res['after'], [
            { 'suffix': '_left', 'type': 'S1' },
            { 'suffix': '_right', 'type': 'S2' },
            { 'suffix': '_spread', 'type': 'R' }
        ])
        # SPREAD_POSITIONS.BEFORE: [R, S1, S2]
        self.assertEqual(res['before'], [
            { 'suffix': '_spread', 'type': 'R' },
            { 'suffix': '_left', 'type': 'S1' },
            { 'suffix': '_right', 'type': 'S2' }
        ])

    def test_process_spread_image_options_propagation(self):
        code = f"""
        {self.mock_env}
        import {{ processSpreadImage }} from './src/js/modules/image-processor.js';
        import {{ SPREAD_MODES, OUTPUT_FORMATS }} from './src/js/modules/constants.js';

        async function run() {{
            const img = new HTMLImageElement(2000, 1000);
            const originalBlob = new Blob(['orig'], {{ type: 'image/jpeg' }});
            
            const pages = await processSpreadImage(img, originalBlob, {{
                spreadMode: SPREAD_MODES.SPLIT,
                outputFormat: OUTPUT_FORMATS.PNG_4BIT,
                targetDeviceOrFit: 'kindle_pw12' // 1272x1696
            }});

            console.log(JSON.stringify(pages.map(p => ({{
                ext: p.ext,
                mimeType: p.mimeType,
                width: p.width,
                height: p.height
            }}))));
        }}
        run();
        """
        res = run_js_eval(code)
        self.assertEqual(len(res), 2)
        # Each half is 1000x1000, scaled to Kindle PW12 (1272x1696 max -> 1272x1272)
        self.assertEqual(res[0]['ext'], 'png')
        self.assertEqual(res[0]['mimeType'], 'image/png')
        self.assertEqual(res[0]['width'], 1272)
        self.assertEqual(res[0]['height'], 1272)
        self.assertEqual(res[1]['ext'], 'png')
        self.assertEqual(res[1]['mimeType'], 'image/png')
        self.assertEqual(res[1]['width'], 1272)
        self.assertEqual(res[1]['height'], 1272)

    def test_detect_and_crop_margins_white_border(self):
        code = f"""
        {self.mock_env}
        import {{ detectAndCropMargins }} from './src/js/modules/image-processor.js';

        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 100;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.getImageData(0, 0, 100, 100);
        // Fill white (255)
        for (let i = 0; i < imgData.data.length; i += 4) {{
            imgData.data[i] = 255;
            imgData.data[i + 1] = 255;
            imgData.data[i + 2] = 255;
            imgData.data[i + 3] = 255;
        }}
        // Draw black box (x=10..89, y=10..89)
        for (let y = 10; y < 90; y++) {{
            for (let x = 10; x < 90; x++) {{
                const idx = (y * 100 + x) * 4;
                imgData.data[idx] = 0;
                imgData.data[idx + 1] = 0;
                imgData.data[idx + 2] = 0;
            }}
        }}
        ctx.putImageData(imgData, 0, 0);

        const cropped = detectAndCropMargins(canvas);
        console.log(JSON.stringify({{
            width: cropped.width,
            height: cropped.height
        }}));
        """
        res = run_js_eval(code)
        self.assertEqual(res['width'], 80)
        self.assertEqual(res['height'], 80)

    def test_detect_and_crop_margins_black_border(self):
        code = f"""
        {self.mock_env}
        import {{ detectAndCropMargins }} from './src/js/modules/image-processor.js';

        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 100;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.getImageData(0, 0, 100, 100);
        // Fill black (0)
        for (let i = 0; i < imgData.data.length; i += 4) {{
            imgData.data[i] = 0;
            imgData.data[i + 1] = 0;
            imgData.data[i + 2] = 0;
            imgData.data[i + 3] = 255;
        }}
        // Draw white box (x=10..89, y=10..89)
        for (let y = 10; y < 90; y++) {{
            for (let x = 10; x < 90; x++) {{
                const idx = (y * 100 + x) * 4;
                imgData.data[idx] = 255;
                imgData.data[idx + 1] = 255;
                imgData.data[idx + 2] = 255;
            }}
        }}
        ctx.putImageData(imgData, 0, 0);

        const cropped = detectAndCropMargins(canvas);
        console.log(JSON.stringify({{
            width: cropped.width,
            height: cropped.height
        }}));
        """
        res = run_js_eval(code)
        self.assertEqual(res['width'], 80)
        self.assertEqual(res['height'], 80)

    def test_detect_and_crop_margins_respects_max_crop_ratio(self):
        code = f"""
        {self.mock_env}
        import {{ detectAndCropMargins }} from './src/js/modules/image-processor.js';

        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 100;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.getImageData(0, 0, 100, 100);
        // Fill white (255)
        for (let i = 0; i < imgData.data.length; i += 4) {{
            imgData.data[i] = 255;
            imgData.data[i + 1] = 255;
            imgData.data[i + 2] = 255;
            imgData.data[i + 3] = 255;
        }}
        // Draw black box with 30% margin on all sides (x=30..69, y=30..69)
        for (let y = 30; y < 70; y++) {{
            for (let x = 30; x < 70; x++) {{
                const idx = (y * 100 + x) * 4;
                imgData.data[idx] = 0;
                imgData.data[idx + 1] = 0;
                imgData.data[idx + 2] = 0;
            }}
        }}
        ctx.putImageData(imgData, 0, 0);

        // Default maxCropRatio is 0.10, so max 10px crop from each edge
        const cropped = detectAndCropMargins(canvas);
        console.log(JSON.stringify({{
            width: cropped.width,
            height: cropped.height
        }}));
        """
        res = run_js_eval(code)
        self.assertEqual(res['width'], 80)
        self.assertEqual(res['height'], 80)

    def test_detect_and_crop_margins_disabled(self):
        code = f"""
        {self.mock_env}
        import {{ detectAndCropMargins }} from './src/js/modules/image-processor.js';

        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 100;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.getImageData(0, 0, 100, 100);
        for (let i = 0; i < imgData.data.length; i += 4) {{
            imgData.data[i] = 255;
            imgData.data[i + 1] = 255;
            imgData.data[i + 2] = 255;
            imgData.data[i + 3] = 255;
        }}
        for (let y = 10; y < 90; y++) {{
            for (let x = 10; x < 90; x++) {{
                const idx = (y * 100 + x) * 4;
                imgData.data[idx] = 0;
                imgData.data[idx + 1] = 0;
                imgData.data[idx + 2] = 0;
            }}
        }}
        ctx.putImageData(imgData, 0, 0);

        const cropped = detectAndCropMargins(canvas, {{ isCropMarginsEnabled: false }});
        console.log(JSON.stringify({{
            width: cropped.width,
            height: cropped.height
        }}));
        """
        res = run_js_eval(code)
        self.assertEqual(res['width'], 100)
        self.assertEqual(res['height'], 100)

    def test_detect_and_crop_margins_uniform_image(self):
        code = f"""
        {self.mock_env}
        import {{ detectAndCropMargins }} from './src/js/modules/image-processor.js';

        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 100;
        const ctx = canvas.getContext('2d');
        const imgData = ctx.getImageData(0, 0, 100, 100);
        for (let i = 0; i < imgData.data.length; i += 4) {{
            imgData.data[i] = 255;
            imgData.data[i + 1] = 255;
            imgData.data[i + 2] = 255;
            imgData.data[i + 3] = 255;
        }}
        ctx.putImageData(imgData, 0, 0);

        const cropped = detectAndCropMargins(canvas);
        console.log(JSON.stringify({{
            width: cropped.width,
            height: cropped.height
        }}));
        """
        res = run_js_eval(code)
        self.assertEqual(res['width'], 100)
        self.assertEqual(res['height'], 100)

    def test_process_image_near_aspect_ratio_fit_scaling(self):
        code = f"""
        {self.mock_env}
        import {{ processImage }} from './src/js/modules/image-processor.js';

        async function run() {{
            // Kindle PW12: 1272x1696 (ratio 0.7500)
            // 1250x1696 has ratio 0.7370, diff 0.013 < 0.02 AUTO_CROP_THRESHOLD -> fit mode
            const img = new HTMLImageElement(1250, 1696);
            const res = await processImage(
                img,
                null,
                'kindle_pw12',
                false,
                'image/jpeg',
                'original',
                0.85,
                true,
                false // disable margin crop for this test
            );
            console.log(JSON.stringify({{
                width: res.width,
                height: res.height
            }}));
        }}
        run();
        """
        res = run_js_eval(code)
        self.assertEqual(res['width'], 1272)
        self.assertEqual(res['height'], 1696)

    def test_process_image_contain_scaling(self):
        code = f"""
        {self.mock_env}
        import {{ processImage }} from './src/js/modules/image-processor.js';

        async function run() {{
            // Kindle PW12: 1272x1696 (ratio 0.7500)
            // 1000x1696 has ratio 0.5896, diff 0.160 > 0.02 AUTO_CROP_THRESHOLD -> contain mode
            const img = new HTMLImageElement(1000, 1696);
            const res = await processImage(
                img,
                null,
                'kindle_pw12',
                false,
                'image/jpeg',
                'original',
                0.85,
                true,
                false // disable margin crop for this test
            );
            console.log(JSON.stringify({{
                width: res.width,
                height: res.height
            }}));
        }}
        run();
        """
        res = run_js_eval(code)
        self.assertEqual(res['width'], 1000)
        self.assertEqual(res['height'], 1696)

    def test_process_image_with_auto_margin_crop_enabled(self):
        code = f"""
        {self.mock_env}
        import {{ processImage }} from './src/js/modules/image-processor.js';

        async function run() {{
            const canvas = document.createElement('canvas');
            canvas.width = 100;
            canvas.height = 100;
            const ctx = canvas.getContext('2d');
            const imgData = ctx.getImageData(0, 0, 100, 100);
            for (let i = 0; i < imgData.data.length; i += 4) {{
                imgData.data[i] = 255;
                imgData.data[i + 1] = 255;
                imgData.data[i + 2] = 255;
                imgData.data[i + 3] = 255;
            }}
            for (let y = 10; y < 90; y++) {{
                for (let x = 10; x < 90; x++) {{
                    const idx = (y * 100 + x) * 4;
                    imgData.data[idx] = 0;
                    imgData.data[idx + 1] = 0;
                    imgData.data[idx + 2] = 0;
                }}
            }}
            ctx.putImageData(imgData, 0, 0);

            // Default isCropMarginsEnabled = true
            const res = await processImage(
                canvas,
                null,
                false, // no target device
                false,
                'image/jpeg',
                'original',
                0.85,
                true,
                true // isCropMarginsEnabled
            );
            console.log(JSON.stringify({{
                width: res.width,
                height: res.height
            }}));
        }}
        run();
        """
        res = run_js_eval(code)
        self.assertEqual(res['width'], 80)
        self.assertEqual(res['height'], 80)

if __name__ == '__main__':
    unittest.main()

