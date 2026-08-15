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
            }
            getContext(type) {
                const self = this;
                return {
                    translate: (x, y) => self._transforms.push({ op: 'translate', x, y }),
                    rotate: (rad) => self._transforms.push({ op: 'rotate', rad }),
                    drawImage: (img, ...args) => {
                        self._drawn = { img, args };
                    },
                    getImageData: (sx, sy, sw, sh) => {
                        const len = (sw || self.width || 1) * (sh || self.height || 1) * 4;
                        const data = new Uint8ClampedArray(len);
                        for (let i = 0; i < len; i += 4) {
                            data[i] = 128;
                            data[i + 1] = 128;
                            data[i + 2] = 128;
                            data[i + 3] = 255;
                        }
                        return { width: sw || self.width, height: sh || self.height, data };
                    },
                    putImageData: (imgData, dx, dy) => {
                        self._putData = { imgData, dx, dy };
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

if __name__ == '__main__':
    unittest.main()
