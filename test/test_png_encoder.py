import unittest
import json
import subprocess
import shutil
import base64
import io
import struct
from pathlib import Path
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = REPO_ROOT / 'src' / 'js' / 'modules' / 'png-encoder.js'

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

def parse_png_chunks(png_bytes: bytes):
    """Parses PNG bytes into signature and list of chunks (length, type, data, crc)."""
    PNG_SIG = b'\x89PNG\r\n\x1a\n'
    if not png_bytes.startswith(PNG_SIG):
        raise ValueError("Invalid PNG signature")
    
    chunks = []
    offset = 8
    while offset < len(png_bytes):
        length = struct.unpack('>I', png_bytes[offset:offset+4])[0]
        offset += 4
        chunk_type = png_bytes[offset:offset+4].decode('ascii')
        offset += 4
        data = png_bytes[offset:offset+length]
        offset += length
        crc = struct.unpack('>I', png_bytes[offset:offset+4])[0]
        offset += 4
        chunks.append({
            'type': chunk_type,
            'length': length,
            'data': data,
            'crc': crc
        })
    return chunks

class TestPngEncoder(unittest.TestCase):
    def test_module_exists(self):
        self.assertTrue(MODULE_PATH.exists(), f"Module file must exist at {MODULE_PATH}")

    def test_palette_16_constant(self):
        code = """
        import { PALETTE_16 } from './src/js/modules/png-encoder.js';
        console.log(JSON.stringify(Array.from(PALETTE_16)));
        """
        palette = run_js_eval(code)
        expected = [0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255]
        self.assertEqual(palette, expected)

    def test_checksum_helpers(self):
        code = """
        import { crc32, adler32 } from './src/js/modules/png-encoder.js';
        const encoder = new TextEncoder();
        const testStr1 = encoder.encode("123456789");
        const testStr2 = encoder.encode("Wikipedia");
        const testIend = encoder.encode("IEND");
        console.log(JSON.stringify({
            crc_digits: (crc32(testStr1) >>> 0).toString(16),
            crc_iend: (crc32(testIend) >>> 0).toString(16),
            adler_wiki: (adler32(testStr2) >>> 0).toString(16)
        }));
        """
        res = run_js_eval(code)
        # CRC32 of "123456789" is 0xcbf43926
        self.assertEqual(res['crc_digits'].lower(), 'cbf43926')
        # CRC32 of "IEND" is 0xae426082
        self.assertEqual(res['crc_iend'].lower(), 'ae426082')
        # Adler32 of "Wikipedia" is 0x11e60398
        self.assertEqual(res['adler_wiki'].lower(), '11e60398')

    def test_encode_4bit_png_structure(self):
        # 4x2 image with known pixels:
        # Row 0: Black(0,0,0), DarkGray(68,68,68), MidGray(136,136,136), White(255,255,255)
        # Row 1: Red(255,0,0), Green(0,255,0), Blue(0,0,255), Yellow(255,255,0)
        code = """
        import { encode4BitPng } from './src/js/modules/png-encoder.js';
        const pixels = [
            // Row 0
            0, 0, 0, 255,
            68, 68, 68, 255,
            136, 136, 136, 255,
            255, 255, 255, 255,
            // Row 1
            255, 0, 0, 255,       // Y = round(0.299*255) = 76 -> idx = round(76/17) = 4
            0, 255, 0, 255,       // Y = round(0.587*255) = 150 -> idx = round(150/17) = 9
            0, 0, 255, 255,       // Y = round(0.114*255) = 29 -> idx = round(29/17) = 2
            255, 255, 0, 255      // Y = round(0.886*255) = 226 -> idx = round(226/17) = 13
        ];
        const uint8 = encode4BitPng({
            width: 4,
            height: 2,
            data: new Uint8ClampedArray(pixels)
        });
        console.log(JSON.stringify(Buffer.from(uint8).toString('base64')));
        """
        b64 = run_js_eval(code)
        png_bytes = base64.b64decode(b64)

        # 1. Header signature
        self.assertTrue(png_bytes.startswith(b'\x89PNG\r\n\x1a\n'))

        # 2. Parse chunks
        chunks = parse_png_chunks(png_bytes)
        chunk_types = [c['type'] for c in chunks]
        self.assertIn('IHDR', chunk_types)
        self.assertIn('PLTE', chunk_types)
        self.assertIn('IDAT', chunk_types)
        self.assertIn('IEND', chunk_types)

        # IHDR details
        ihdr = next(c for c in chunks if c['type'] == 'IHDR')
        self.assertEqual(ihdr['length'], 13)
        w, h, bit_depth, color_type, comp, filt, inter = struct.unpack('>IIBBBBB', ihdr['data'])
        self.assertEqual(w, 4)
        self.assertEqual(h, 2)
        self.assertEqual(bit_depth, 4)
        self.assertEqual(color_type, 3) # Indexed-color
        self.assertEqual(comp, 0)
        self.assertEqual(filt, 0)
        self.assertEqual(inter, 0)

        # PLTE details
        plte = next(c for c in chunks if c['type'] == 'PLTE')
        self.assertEqual(plte['length'], 48) # 16 * 3
        expected_palette = [0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255]
        for i in range(16):
            val = expected_palette[i]
            r, g, b = plte['data'][i*3 : i*3+3]
            self.assertEqual((r, g, b), (val, val, val))

        # IEND details
        iend = next(c for c in chunks if c['type'] == 'IEND')
        self.assertEqual(iend['length'], 0)
        self.assertEqual(iend['crc'], 0xAE426082)

        # 3. Decode with PIL
        img = Image.open(io.BytesIO(png_bytes))
        self.assertEqual(img.size, (4, 2))
        self.assertEqual(img.mode, 'P')

        # Convert to grayscale to check palette values mapped correctly
        gray_img = img.convert('L')
        # Row 0: indices 0 (0), 4 (68), 8 (136), 15 (255)
        # Row 1: red -> idx 4 (68), green -> idx 9 (153), blue -> idx 2 (34), yellow -> idx 13 (221)
        expected_gray = [
            0, 68, 136, 255,
            68, 153, 34, 221
        ]
        actual_gray = list(gray_img.tobytes())
        self.assertEqual(actual_gray, expected_gray)

    def test_encode_4bit_png_odd_width(self):
        # 3x3 image (odd width: requires padding nibble in scanline)
        code = """
        import { encode4BitPng } from './src/js/modules/png-encoder.js';
        const pixels = [
            0, 0, 0, 255,       17, 17, 17, 255,     34, 34, 34, 255,
            51, 51, 51, 255,    68, 68, 68, 255,     85, 85, 85, 255,
            102, 102, 102, 255, 119, 119, 119, 255, 255, 255, 255, 255
        ];
        const uint8 = encode4BitPng({
            width: 3,
            height: 3,
            data: new Uint8ClampedArray(pixels)
        });
        console.log(JSON.stringify(Buffer.from(uint8).toString('base64')));
        """
        b64 = run_js_eval(code)
        png_bytes = base64.b64decode(b64)
        
        img = Image.open(io.BytesIO(png_bytes))
        self.assertEqual(img.size, (3, 3))
        gray_img = img.convert('L')
        expected_gray = [
            0, 17, 34,
            51, 68, 85,
            102, 119, 255
        ]
        self.assertEqual(list(gray_img.tobytes()), expected_gray)

    def test_encode_4bit_png_all_16_levels(self):
        # 16x1 image testing all 16 quantization steps exactly
        code = """
        import { encode4BitPng, PALETTE_16 } from './src/js/modules/png-encoder.js';
        const pixels = [];
        for (let i = 0; i < 16; i++) {
            const v = PALETTE_16[i];
            pixels.push(v, v, v, 255);
        }
        const uint8 = encode4BitPng({
            width: 16,
            height: 1,
            data: new Uint8ClampedArray(pixels)
        });
        console.log(JSON.stringify(Buffer.from(uint8).toString('base64')));
        """
        b64 = run_js_eval(code)
        png_bytes = base64.b64decode(b64)
        
        img = Image.open(io.BytesIO(png_bytes))
        self.assertEqual(img.size, (16, 1))
        gray_img = img.convert('L')
        expected = [0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255]
        self.assertEqual(list(gray_img.tobytes()), expected)

    def test_encode_8bit_png_structure(self):
        # 4x2 grayscale image
        code = """
        import { encode8BitPng } from './src/js/modules/png-encoder.js';
        const pixels = [
            // Row 0
            0, 0, 0, 255,
            50, 50, 50, 255,
            100, 100, 100, 255,
            200, 200, 200, 255,
            // Row 1
            255, 0, 0, 255,       // Y = round(0.299*255) = 76
            0, 255, 0, 255,       // Y = round(0.587*255) = 150
            0, 0, 255, 255,       // Y = round(0.114*255) = 29
            255, 255, 0, 255      // Y = round(0.886*255) = 226
        ];
        const uint8 = encode8BitPng({
            width: 4,
            height: 2,
            data: new Uint8ClampedArray(pixels)
        });
        console.log(JSON.stringify(Buffer.from(uint8).toString('base64')));
        """
        b64 = run_js_eval(code)
        png_bytes = base64.b64decode(b64)

        # 1. Header signature
        self.assertTrue(png_bytes.startswith(b'\x89PNG\r\n\x1a\n'))

        # 2. Parse chunks
        chunks = parse_png_chunks(png_bytes)
        chunk_types = [c['type'] for c in chunks]
        self.assertIn('IHDR', chunk_types)
        self.assertNotIn('PLTE', chunk_types) # Grayscale has no PLTE
        self.assertIn('IDAT', chunk_types)
        self.assertIn('IEND', chunk_types)

        # IHDR details
        ihdr = next(c for c in chunks if c['type'] == 'IHDR')
        self.assertEqual(ihdr['length'], 13)
        w, h, bit_depth, color_type, comp, filt, inter = struct.unpack('>IIBBBBB', ihdr['data'])
        self.assertEqual(w, 4)
        self.assertEqual(h, 2)
        self.assertEqual(bit_depth, 8)
        self.assertEqual(color_type, 0) # Grayscale
        self.assertEqual(comp, 0)
        self.assertEqual(filt, 0)
        self.assertEqual(inter, 0)

        # 3. Decode with PIL
        img = Image.open(io.BytesIO(png_bytes))
        self.assertEqual(img.size, (4, 2))
        self.assertEqual(img.mode, 'L')
        expected_gray = [
            0, 50, 100, 200,
            76, 150, 29, 226
        ]
        self.assertEqual(list(img.tobytes()), expected_gray)

    def test_encode_8bit_png_odd_dimensions(self):
        # 3x5 image
        code = """
        import { encode8BitPng } from './src/js/modules/png-encoder.js';
        const pixels = [];
        for (let i = 0; i < 15; i++) {
            const v = i * 15;
            pixels.push(v, v, v, 255);
        }
        const uint8 = encode8BitPng({
            width: 3,
            height: 5,
            data: new Uint8ClampedArray(pixels)
        });
        console.log(JSON.stringify(Buffer.from(uint8).toString('base64')));
        """
        b64 = run_js_eval(code)
        png_bytes = base64.b64decode(b64)
        
        img = Image.open(io.BytesIO(png_bytes))
        self.assertEqual(img.size, (3, 5))
        self.assertEqual(img.mode, 'L')
        expected = [i * 15 for i in range(15)]
        self.assertEqual(list(img.tobytes()), expected)

    def test_multi_block_deflate_large_image(self):
        # 300x300 image: 300 * 301 = 90,300 bytes > 65,535 bytes (exercises multi-block deflate)
        code = """
        import { encode8BitPng, encode4BitPng } from './src/js/modules/png-encoder.js';
        const width = 300;
        const height = 300;
        const data = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;
            data[idx] = (i % 256);
            data[idx + 1] = ((i * 3) % 256);
            data[idx + 2] = ((i * 7) % 256);
            data[idx + 3] = 255;
        }
        const png8 = encode8BitPng({ width, height, data });
        const png4 = encode4BitPng({ width, height, data });
        console.log(JSON.stringify({
            png8: Buffer.from(png8).toString('base64'),
            png4: Buffer.from(png4).toString('base64')
        }));
        """
        res = run_js_eval(code)
        png8_bytes = base64.b64decode(res['png8'])
        png4_bytes = base64.b64decode(res['png4'])

        img8 = Image.open(io.BytesIO(png8_bytes))
        self.assertEqual(img8.size, (300, 300))
        self.assertEqual(img8.mode, 'L')

        img4 = Image.open(io.BytesIO(png4_bytes))
        self.assertEqual(img4.size, (300, 300))
        self.assertEqual(img4.mode, 'P')

    def test_canvas_mock_input(self):
        # Test input with getContext('2d')
        code = """
        import { encode8BitPng, encode4BitPng } from './src/js/modules/png-encoder.js';
        const canvasMock = {
            width: 2,
            height: 2,
            getContext: (type) => ({
                getImageData: (x, y, w, h) => ({
                    width: 2,
                    height: 2,
                    data: new Uint8ClampedArray([
                        255, 255, 255, 255,  0, 0, 0, 255,
                        0, 0, 0, 255,        255, 255, 255, 255
                    ])
                })
            })
        };
        const p8 = encode8BitPng(canvasMock);
        const p4 = encode4BitPng(canvasMock);
        console.log(JSON.stringify({
            p8: Buffer.from(p8).toString('base64'),
            p4: Buffer.from(p4).toString('base64')
        }));
        """
        res = run_js_eval(code)
        img8 = Image.open(io.BytesIO(base64.b64decode(res['p8'])))
        self.assertEqual(img8.size, (2, 2))
        self.assertEqual(list(img8.tobytes()), [255, 0, 0, 255])

        img4 = Image.open(io.BytesIO(base64.b64decode(res['p4'])))
        self.assertEqual(img4.size, (2, 2))
        self.assertEqual(list(img4.convert('L').tobytes()), [255, 0, 0, 255])

    def test_error_handling(self):
        code = """
        import { encode8BitPng, encode4BitPng } from './src/js/modules/png-encoder.js';
        const errors = [];
        try { encode8BitPng(null); } catch (e) { errors.push(e.message); }
        try { encode4BitPng({ width: 0, height: 10, data: [] }); } catch (e) { errors.push(e.message); }
        console.log(JSON.stringify(errors));
        """
        errors = run_js_eval(code)
        self.assertEqual(len(errors), 2)

if __name__ == '__main__':
    unittest.main()
