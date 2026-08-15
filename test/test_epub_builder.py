import unittest
import json
import subprocess
import shutil
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

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

class TestEpubBuilderIntegration(unittest.TestCase):
    def setUp(self):
        self.base_env = r"""
        import { createEpub, getSpineDirectionAttribute } from './src/js/modules/epub-builder.js';
        import { READING_DIRECTIONS, COVER_SOURCES, OUTPUT_FORMATS, SPREAD_MODES, SPREAD_POSITIONS, ROTATION_DIRECTIONS } from './src/js/modules/constants.js';

        // Mock environment
        globalThis.Blob = class Blob {
            constructor(parts = [], options = {}) {
                this.parts = parts;
                this.type = options?.type || '';
                this.width = options?.width || (parts && parts[0] && parts[0].width) || 1000;
                this.height = options?.height || (parts && parts[0] && parts[0].height) || 1500;
            }
        };

        globalThis.HTMLCanvasElement = class HTMLCanvasElement {
            constructor() {
                this.width = 0;
                this.height = 0;
            }
            getContext() {
                const self = this;
                return {
                    translate: () => {},
                    rotate: () => {},
                    drawImage: () => {},
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
                    putImageData: () => {}
                };
            }
            toBlob(cb, mimeType) {
                const blob = new globalThis.Blob(['mock-canvas'], {
                    type: mimeType,
                    width: this.width,
                    height: this.height
                });
                setTimeout(() => cb(blob), 0);
            }
        };

        globalThis.HTMLImageElement = class HTMLImageElement {
            constructor() {
                this.width = 1000;
                this.height = 1500;
            }
        };

        globalThis.Image = class Image extends globalThis.HTMLImageElement {
            constructor() {
                super();
                this._width = 1000;
                this._height = 1500;
                this.onload = null;
                this.onerror = null;
            }
            get width() { return this._width; }
            set width(w) { this._width = w; }
            get height() { return this._height; }
            set height(h) { this._height = h; }
            get src() { return this._src; }
            set src(val) {
                this._src = val;
                if (val && val.includes('?w=')) {
                    const match = val.match(/w=(\d+)&h=(\d+)/);
                    if (match) {
                        this._width = parseInt(match[1], 10);
                        this._height = parseInt(match[2], 10);
                    }
                }
                setTimeout(() => {
                    if (this.onload) this.onload();
                }, 0);
            }
        };

        globalThis.document = {
            createElement: (tag) => {
                if (tag === 'canvas') {
                    return new globalThis.HTMLCanvasElement();
                }
                return {};
            }
        };

        globalThis.URL = {
            createObjectURL: (blob) => {
                const w = blob?.width || 1000;
                const h = blob?.height || 1500;
                return `blob:mock?w=${w}&h=${h}`;
            },
            revokeObjectURL: () => {}
        };

        const createMockZip = () => {
            const files = {};
            const fileOptions = {};
            let generateOptions = null;
            const zip = {
                file: (path, content, opts) => {
                    files[path] = content;
                    fileOptions[path] = opts || null;
                    return zip;
                },
                folder: (name) => {
                    return {
                        file: (subPath, content, opts) => {
                            files[`${name}/${subPath}`] = content;
                            fileOptions[`${name}/${subPath}`] = opts || null;
                            return zip;
                        },
                        folder: (nestedName) => ({
                            file: (nestedPath, content, opts) => {
                                files[`${name}/${nestedName}/${nestedPath}`] = content;
                                fileOptions[`${name}/${nestedName}/${nestedPath}`] = opts || null;
                                return zip;
                            }
                        })
                    };
                },
                async generateAsync(options) {
                    generateOptions = options;
                    return new globalThis.Blob(['mock-epub'], { type: options?.mimeType || 'application/epub+zip' });
                }
            };
            return { zip, files, fileOptions, getGenerateOptions: () => generateOptions };
        };
        """

    def test_spine_direction_attribute(self):
        js_code = self.base_env + """
        const ltrAttr = getSpineDirectionAttribute(READING_DIRECTIONS.LTR);
        const rtlAttr = getSpineDirectionAttribute(READING_DIRECTIONS.RTL);
        console.log(JSON.stringify({ ltrAttr, rtlAttr }));
        """
        res = run_js_eval(js_code)
        self.assertEqual(res['ltrAttr'], ' page-progression-direction="ltr"')
        self.assertEqual(res['rtlAttr'], ' page-progression-direction="rtl"')



    def test_landscape_spread_xhtml_alignment_rtl(self):
        js_code = self.base_env + """
        async function run() {
            const { zip, files } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'RTL XHTML Alignment Test',
                author: 'Author RTL',
                readingDirection: READING_DIRECTIONS.RTL,
                isLandscapeSpread: true,
                isOffsetFirstPage: false,
                jszipLib: class { constructor() { return zip; } }
            });

            return {
                page0: files['OEBPS/Text/page_0000.xhtml'],
                page1: files['OEBPS/Text/page_0001.xhtml'],
                css: files['OEBPS/Text/style.css']
            };
        }
        run().then(res => console.log(JSON.stringify(res)));
        """
        res = run_js_eval(js_code)
        page0 = res['page0']
        page1 = res['page1']
        css = res['css']

        self.assertIn('@page {\n  margin: 0;\n}', css)
        self.assertIn('body {\n  display: block;\n  margin: 0;\n  padding: 0;\n}', css)

        self.assertIn('<link href="style.css" type="text/css" rel="stylesheet"/>', page0)
        self.assertIn('<div style="text-align:center;">', page0)
        self.assertIn('<div style="display:none;">.</div>', page0)
        self.assertIn('<img width="1000" height="1500" src="../Images/image_0000.jpg"', page0)
        self.assertIn('<link href="style.css" type="text/css" rel="stylesheet"/>', page1)
        self.assertIn('<div style="text-align:center;">', page1)
        self.assertIn('<div style="display:none;">.</div>', page1)
        self.assertIn('<img width="1000" height="1500" src="../Images/image_0001.jpg"', page1)
        self.assertNotIn('<script', page0)
        self.assertNotIn('<script', page1)

    def test_landscape_spread_xhtml_alignment_ltr(self):
        js_code = self.base_env + """
        async function run() {
            const { zip, files } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'LTR XHTML Alignment Test',
                author: 'Author LTR',
                readingDirection: READING_DIRECTIONS.LTR,
                isLandscapeSpread: true,
                isOffsetFirstPage: false,
                jszipLib: class { constructor() { return zip; } }
            });

            return {
                page0: files['OEBPS/Text/page_0000.xhtml'],
                page1: files['OEBPS/Text/page_0001.xhtml']
            };
        }
        run().then(res => console.log(JSON.stringify(res)));
        """
        res = run_js_eval(js_code)
        page0 = res['page0']
        page1 = res['page1']

        self.assertIn('<link href="style.css" type="text/css" rel="stylesheet"/>', page0)
        self.assertIn('<div style="text-align:center;">', page0)
        self.assertIn('<div style="display:none;">.</div>', page0)
        self.assertIn('<img width="1000" height="1500" src="../Images/image_0000.jpg"', page0)
        self.assertIn('<link href="style.css" type="text/css" rel="stylesheet"/>', page1)
        self.assertIn('<div style="text-align:center;">', page1)
        self.assertIn('<div style="display:none;">.</div>', page1)
        self.assertIn('<img width="1000" height="1500" src="../Images/image_0001.jpg"', page1)
        self.assertNotIn('<script', page0)
        self.assertNotIn('<script', page1)

    def test_landscape_spread_disabled_xhtml_alignment(self):
        js_code = self.base_env + """
        async function run() {
            const { zip, files } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p3.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'Disabled Spread XHTML Alignment Test',
                author: 'Author Disabled',
                readingDirection: READING_DIRECTIONS.RTL,
                isLandscapeSpread: false,
                jszipLib: class { constructor() { return zip; } }
            });

            return {
                page0: files['OEBPS/Text/page_0000.xhtml'],
                page1: files['OEBPS/Text/page_0001.xhtml'],
                page2: files['OEBPS/Text/page_0002.xhtml']
            };
        }
        run().then(res => console.log(JSON.stringify(res)));
        """
        res = run_js_eval(js_code)
        for page_key in ['page0', 'page1', 'page2']:
            page = res[page_key]
            self.assertIn('<link href="style.css" type="text/css" rel="stylesheet"/>', page)
            self.assertIn('<div style="text-align:center;">', page)
            self.assertIn('<div style="display:none;">.</div>', page)
            self.assertIn('<img width="1000" height="1500"', page)

    def test_cover_page_xhtml_reset(self):
        js_code = self.base_env + """
        async function run() {
            const { zip, files } = createMockZip();
            const mockImages = [
                { name: 'page1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'page2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];
            const customCover = {
                name: 'custom_cover.jpg',
                width: 1000,
                height: 1500
            };

            await createEpub({
                images: mockImages,
                title: 'Cover XHTML Reset Test',
                author: 'Author Cover',
                coverSource: COVER_SOURCES.CUSTOM,
                customCoverFile: customCover,
                isLandscapeSpread: true,
                jszipLib: class { constructor() { return zip; } }
            });

            const { zip: zip2, files: files2 } = createMockZip();
            await createEpub({
                images: mockImages,
                title: 'Regular Cover XHTML Reset Test',
                author: 'Author Regular Cover',
                coverSource: COVER_SOURCES.PAGE,
                coverPageNumber: 1,
                isLandscapeSpread: false,
                jszipLib: class { constructor() { return zip2; } }
            });

            return {
                customCover: files['OEBPS/Text/cover.xhtml'],
                regularCoverPage: files2['OEBPS/Text/page_0000.xhtml']
            };
        }
        run().then(res => console.log(JSON.stringify(res)));
        """
        res = run_js_eval(js_code)
        customCover = res['customCover']
        regularCover = res['regularCoverPage']

        # Verify custom cover reset and alignment
        self.assertIn('<link href="style.css" type="text/css" rel="stylesheet"/>', customCover)
        self.assertIn('<div style="text-align:center;">', customCover)
        self.assertIn('<div style="display:none;">.</div>', customCover)
        self.assertIn('<img width="1000" height="1500" src="../Images/cover.jpg"', customCover)

        # Verify regular cover page reset and alignment
        self.assertIn('<link href="style.css" type="text/css" rel="stylesheet"/>', regularCover)
        self.assertIn('<div style="text-align:center;">', regularCover)
        self.assertIn('<div style="display:none;">.</div>', regularCover)
        self.assertIn('<img width="1000" height="1500" src="../Images/image_0000.jpg"', regularCover)

    def test_create_epub_without_jszip_throws(self):
        js_code = self.base_env + """
        async function run() {
            try {
                await createEpub({ images: [], jszipLib: null });
                return { error: null };
            } catch (err) {
                return { error: err.message };
            }
        }
        run().then(res => console.log(JSON.stringify(res)));
        """
        res = run_js_eval(js_code)
        self.assertIn("JSZip library is not available", res['error'])

    # Scenario 1: isLandscapeSpread: true, readingDirection: 'rtl', single pages & split spreads
    def test_scenario_1_rtl_landscape_spread_single_pages(self):
        js_code = self.base_env + """
        async function run() {
            const { zip, files } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p3.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p4.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'RTL Single Pages Comic',
                author: 'Author A',
                readingDirection: READING_DIRECTIONS.RTL,
                isLandscapeSpread: true,
                isOffsetFirstPage: false,
                jszipLib: class { constructor() { return zip; } }
            });

            return files['OEBPS/content.opf'];
        }
        run().then(res => console.log(JSON.stringify(res)));
        """
        opf = run_js_eval(js_code)
        self.assertIn('<dc:title>RTL Single Pages Comic</dc:title>', opf)
        self.assertIn('page-progression-direction="rtl"', opf)
        self.assertIn('toc="ncx"', opf)
        self.assertIn('<meta property="rendition:spread">landscape</meta>', opf)
        self.assertIn('<itemref idref="page0" linear="yes" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page1" linear="yes" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page2" linear="yes" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page3" linear="yes" properties="page-spread-left"/>', opf)

    def test_scenario_1_ltr_landscape_spread_single_pages(self):
        js_code = self.base_env + """
        async function run() {
            const { zip, files } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p3.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p4.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'LTR Single Pages Comic',
                author: 'Author LTR',
                readingDirection: READING_DIRECTIONS.LTR,
                isLandscapeSpread: true,
                isOffsetFirstPage: false,
                jszipLib: class { constructor() { return zip; } }
            });

            return files['OEBPS/content.opf'];
        }
        run().then(res => console.log(JSON.stringify(res)));
        """
        opf = run_js_eval(js_code)
        self.assertIn('<dc:title>LTR Single Pages Comic</dc:title>', opf)
        self.assertIn('page-progression-direction="ltr"', opf)
        self.assertIn('toc="ncx"', opf)
        self.assertIn('<meta property="rendition:spread">landscape</meta>', opf)
        self.assertIn('<itemref idref="page0" linear="yes" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page1" linear="yes" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page2" linear="yes" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page3" linear="yes" properties="page-spread-right"/>', opf)

    def test_scenario_1_rtl_split_spread_with_backward_pass(self):
        js_code = self.base_env + """
        async function run() {
            const { zip, files } = createMockZip();
            // Single page followed by a wide spread image (split into 2 parts), then another single page
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'spread.jpg', async: async () => new globalThis.Blob([], { width: 2000, height: 1000 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'RTL Split Spread Comic',
                author: 'Author RTL Spread',
                isOptimizeEnabled: true,
                readingDirection: READING_DIRECTIONS.RTL,
                isLandscapeSpread: true,
                isOffsetFirstPage: false,
                jszipLib: class { constructor() { return zip; } }
            });

            return files['OEBPS/content.opf'];
        }
        run().then(res => console.log(JSON.stringify(res)));
        """
        opf = run_js_eval(js_code)
        # [N, S1, S2, N] in RTL:
        # S1=right, S2=left. Preceding N (page0) adjusted to left by backward pass. Next N (page3) is right.
        self.assertIn('<itemref idref="page0" linear="yes" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page1" linear="yes" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page2" linear="yes" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page3" linear="yes" properties="page-spread-right"/>', opf)

    def test_scenario_1_ltr_split_spread_with_backward_pass(self):
        js_code = self.base_env + """
        async function run() {
            const { zip, files } = createMockZip();
            // Single page followed by a wide spread image (split into 2 parts), then another single page
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'spread.jpg', async: async () => new globalThis.Blob([], { width: 2000, height: 1000 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'LTR Split Spread Comic',
                author: 'Author LTR Spread',
                isOptimizeEnabled: true,
                readingDirection: READING_DIRECTIONS.LTR,
                isLandscapeSpread: true,
                isOffsetFirstPage: false,
                jszipLib: class { constructor() { return zip; } }
            });

            return files['OEBPS/content.opf'];
        }
        run().then(res => console.log(JSON.stringify(res)));
        """
        opf = run_js_eval(js_code)
        # [N, S1, S2, N] in LTR:
        # S1=left, S2=right. Preceding N (page0) adjusted to right by backward pass. Next N (page3) is left.
        self.assertIn('<itemref idref="page0" linear="yes" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page1" linear="yes" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page2" linear="yes" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page3" linear="yes" properties="page-spread-left"/>', opf)

    def test_scenario_1_rtl_three_single_pages_before_spread(self):
        js_code = self.base_env + """
        async function run() {
            const { zip, files } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p3.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'spread.jpg', async: async () => new globalThis.Blob([], { width: 2000, height: 1000 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'RTL 3 Single Pages Before Spread',
                author: 'Author RTL Multi',
                isOptimizeEnabled: true,
                readingDirection: READING_DIRECTIONS.RTL,
                isLandscapeSpread: true,
                isOffsetFirstPage: false,
                jszipLib: class { constructor() { return zip; } }
            });

            return files['OEBPS/content.opf'];
        }
        run().then(res => console.log(JSON.stringify(res)));
        """
        opf = run_js_eval(js_code)
        # [N, N, N, S1, S2] in RTL:
        # S1=right, S2=left. Backward pass: page2=left, page1=right, page0=left.
        self.assertIn('<itemref idref="page0" linear="yes" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page1" linear="yes" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page2" linear="yes" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page3" linear="yes" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page4" linear="yes" properties="page-spread-left"/>', opf)

    # Scenario 2: isLandscapeSpread: true, isOptimizeEnabled: false (wide pages not split -> page-spread-center)
    def test_scenario_2_unsplit_wide_spread_center_rtl(self):
        js_code = self.base_env + """
        async function run() {
            const { zip, files } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'spread.jpg', async: async () => new globalThis.Blob([], { width: 2000, height: 1000 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'Center Spread Comic RTL',
                author: 'Author Spread RTL',
                isOptimizeEnabled: false,
                readingDirection: READING_DIRECTIONS.RTL,
                isLandscapeSpread: true,
                isOffsetFirstPage: false,
                jszipLib: class { constructor() { return zip; } }
            });

            return files['OEBPS/content.opf'];
        }
        run().then(res => console.log(JSON.stringify(res)));
        """
        opf = run_js_eval(js_code)
        # [N, R, N] in RTL: page0=left, page1=center, page2=right
        self.assertIn('<itemref idref="page0" linear="yes" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page1" linear="yes" properties="page-spread-center"/>', opf)
        self.assertIn('<itemref idref="page2" linear="yes" properties="page-spread-right"/>', opf)

    def test_scenario_2_unsplit_wide_spread_center_ltr(self):
        js_code = self.base_env + """
        async function run() {
            const { zip, files } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'spread.jpg', async: async () => new globalThis.Blob([], { width: 2000, height: 1000 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'Center Spread Comic LTR',
                author: 'Author Spread LTR',
                isOptimizeEnabled: false,
                readingDirection: READING_DIRECTIONS.LTR,
                isLandscapeSpread: true,
                isOffsetFirstPage: false,
                jszipLib: class { constructor() { return zip; } }
            });

            return files['OEBPS/content.opf'];
        }
        run().then(res => console.log(JSON.stringify(res)));
        """
        opf = run_js_eval(js_code)
        # [N, R, N] in LTR: page0=right, page1=center, page2=left
        self.assertIn('<itemref idref="page0" linear="yes" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page1" linear="yes" properties="page-spread-center"/>', opf)
        self.assertIn('<itemref idref="page2" linear="yes" properties="page-spread-left"/>', opf)

    # Scenario 3: isLandscapeSpread: true with custom cover file
    def test_scenario_3_custom_cover_rtl(self):
        js_code = self.base_env + """
        async function run() {
            const { zip, files } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];
            const customCover = {
                name: 'custom_cover.jpg',
                width: 1000,
                height: 1500
            };

            await createEpub({
                images: mockImages,
                title: 'Custom Cover Comic RTL',
                author: 'Author Cover RTL',
                coverSource: COVER_SOURCES.CUSTOM,
                customCoverFile: customCover,
                readingDirection: READING_DIRECTIONS.RTL,
                isLandscapeSpread: true,
                isOffsetFirstPage: false,
                jszipLib: class { constructor() { return zip; } }
            });

            return files['OEBPS/content.opf'];
        }
        run().then(res => console.log(JSON.stringify(res)));
        """
        opf = run_js_eval(js_code)
        # Custom cover is registered as first page ('cover-page'), followed by page0, page1
        # For RTL without offset: cover-page=right, page0=left, page1=right
        self.assertIn('<itemref idref="cover-page" linear="yes" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page0" linear="yes" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page1" linear="yes" properties="page-spread-right"/>', opf)

    def test_scenario_3_custom_cover_ltr(self):
        js_code = self.base_env + """
        async function run() {
            const { zip, files } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];
            const customCover = {
                name: 'custom_cover.jpg',
                width: 1000,
                height: 1500
            };

            await createEpub({
                images: mockImages,
                title: 'Custom Cover Comic LTR',
                author: 'Author Cover LTR',
                coverSource: COVER_SOURCES.CUSTOM,
                customCoverFile: customCover,
                readingDirection: READING_DIRECTIONS.LTR,
                isLandscapeSpread: true,
                isOffsetFirstPage: false,
                jszipLib: class { constructor() { return zip; } }
            });

            return files['OEBPS/content.opf'];
        }
        run().then(res => console.log(JSON.stringify(res)));
        """
        opf = run_js_eval(js_code)
        # Custom cover is registered as first page ('cover-page'), followed by page0, page1
        # For LTR without offset: cover-page=left, page0=right, page1=left
        self.assertIn('<itemref idref="cover-page" linear="yes" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page0" linear="yes" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page1" linear="yes" properties="page-spread-left"/>', opf)

    # Scenario 4: isLandscapeSpread: false -> NO properties="page-spread-..." on itemref elements
    def test_scenario_4_landscape_spread_disabled_rtl(self):
        js_code = self.base_env + """
        async function run() {
            const { zip, files } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'spread.jpg', async: async () => new globalThis.Blob([], { width: 2000, height: 1000 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'Landscape Disabled Comic RTL',
                author: 'Author RTL NoSpread',
                isOptimizeEnabled: false,
                readingDirection: READING_DIRECTIONS.RTL,
                isLandscapeSpread: false,
                jszipLib: class { constructor() { return zip; } }
            });

            return files['OEBPS/content.opf'];
        }
        run().then(res => console.log(JSON.stringify(res)));
        """
        opf = run_js_eval(js_code)
        self.assertIn('<meta property="rendition:spread">auto</meta>', opf)
        self.assertNotIn('page-spread-right', opf)
        self.assertNotIn('page-spread-left', opf)
        self.assertNotIn('page-spread-center', opf)
        self.assertIn('<itemref idref="page0" linear="yes"/>', opf)
        self.assertIn('<itemref idref="page1" linear="yes"/>', opf)
        self.assertIn('<itemref idref="page2" linear="yes"/>', opf)

    def test_scenario_4_landscape_spread_disabled_ltr(self):
        js_code = self.base_env + """
        async function run() {
            const { zip, files } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'Landscape Disabled Comic LTR',
                author: 'Author LTR NoSpread',
                readingDirection: READING_DIRECTIONS.LTR,
                isLandscapeSpread: false,
                jszipLib: class { constructor() { return zip; } }
            });

            return files['OEBPS/content.opf'];
        }
        run().then(res => console.log(JSON.stringify(res)));
        """
        opf = run_js_eval(js_code)
        self.assertIn('<meta property="rendition:spread">auto</meta>', opf)
        self.assertNotIn('page-spread-right', opf)
        self.assertNotIn('page-spread-left', opf)
        self.assertNotIn('page-spread-center', opf)
        self.assertIn('<itemref idref="page0" linear="yes"/>', opf)
        self.assertIn('<itemref idref="page1" linear="yes"/>', opf)

    # Scenario 5: isLandscapeSpread: true, isOffsetFirstPage: true
    def test_scenario_5_offset_first_page_rtl(self):
        js_code = self.base_env + """
        async function run() {
            const { zip, files } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p3.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p4.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'RTL Offset Comic',
                author: 'Author Offset RTL',
                readingDirection: READING_DIRECTIONS.RTL,
                isLandscapeSpread: true,
                isOffsetFirstPage: true,
                jszipLib: class { constructor() { return zip; } }
            });

            return files['OEBPS/content.opf'];
        }
        run().then(res => console.log(JSON.stringify(res)));
        """
        opf = run_js_eval(js_code)
        # RTL with offset: page0=left, page1=right, page2=left, page3=right
        self.assertIn('<itemref idref="page0" linear="yes" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page1" linear="yes" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page2" linear="yes" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page3" linear="yes" properties="page-spread-right"/>', opf)

    def test_scenario_5_offset_first_page_ltr(self):
        js_code = self.base_env + """
        async function run() {
            const { zip, files } = createMockZip();
            const mockImages = [
                { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p3.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
                { name: 'p4.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
            ];

            await createEpub({
                images: mockImages,
                title: 'LTR Offset Comic',
                author: 'Author Offset LTR',
                readingDirection: READING_DIRECTIONS.LTR,
                isLandscapeSpread: true,
                isOffsetFirstPage: true,
                jszipLib: class { constructor() { return zip; } }
            });

            return files['OEBPS/content.opf'];
        }
        run().then(res => console.log(JSON.stringify(res)));
        """
        opf = run_js_eval(js_code)
        # LTR with offset: page0=right, page1=left, page2=right, page3=left
        self.assertIn('<itemref idref="page0" linear="yes" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page1" linear="yes" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page2" linear="yes" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page3" linear="yes" properties="page-spread-left"/>', opf)

    def test_device_presets_constants(self):
        code = self.base_env + r"""
        import { DEVICE_PRESETS, getDevicePreset } from './src/js/modules/constants.js';

        const pw12 = getDevicePreset('kindle_pw12');
        const pw11 = getDevicePreset('kindle_pw11');
        const oasis = getDevicePreset('kindle_oasis');
        const original = getDevicePreset('original');

        console.log(JSON.stringify({
            pw12: { width: pw12.width, height: pw12.height },
            pw11: { width: pw11.width, height: pw11.height },
            oasis: { width: oasis.width, height: oasis.height },
            original: { width: original.width, height: original.height }
        }));
        """
        data = run_js_eval(code)
        self.assertEqual(data['pw12'], {'width': 1272, 'height': 1696})
        self.assertEqual(data['pw11'], {'width': 1236, 'height': 1648})
        self.assertEqual(data['oasis'], {'width': 1264, 'height': 1680})
        self.assertEqual(data['original'], {'width': 0, 'height': 0})

    def test_constants_exports(self):
        code = r"""
        import { SPREAD_MODES, SPREAD_POSITIONS, ROTATION_DIRECTIONS, OUTPUT_FORMATS } from './src/js/modules/constants.js';

        console.log(JSON.stringify({
            SPREAD_MODES,
            SPREAD_POSITIONS,
            ROTATION_DIRECTIONS,
            OUTPUT_FORMATS
        }));
        """
        data = run_js_eval(code)
        self.assertEqual(data['SPREAD_MODES'], {
            'OFF': 'off',
            'SPLIT': 'split',
            'ROTATE': 'rotate',
            'BOTH': 'both'
        })
        self.assertEqual(data['SPREAD_POSITIONS'], {
            'AFTER': 'after',
            'BEFORE': 'before'
        })
        self.assertEqual(data['ROTATION_DIRECTIONS'], {
            'CCW': 'ccw',
            'CW': 'cw'
        })
        self.assertEqual(data['OUTPUT_FORMATS'], {
            'ORIGINAL': 'original',
            'JPEG': 'jpeg',
            'PNG': 'png',
            'PNG_8BIT': 'png_8bit',
            'PNG_4BIT': 'png_4bit'
        })


    def test_process_image_proportional_scaling(self):
        code = self.base_env + r"""
        import { processImage } from './src/js/modules/image-processor.js';
        import { DEVICE_PRESETS } from './src/js/modules/constants.js';

        // 1. Downscale test: large image 2000x3000 -> Kindle PW12 (1272x1696)
        // Ratio = min(1272/2000 = 0.636, 1696/3000 = 0.565333) = 0.565333
        // Width = round(2000 * 0.565333) = 1131, Height = round(3000 * 0.565333) = 1696
        const imgLarge = new globalThis.Image();
        imgLarge.width = 2000;
        imgLarge.height = 3000;
        const resLarge = await processImage(imgLarge, null, DEVICE_PRESETS.KINDLE_PW12, false, 'image/jpeg', 'original', 0.85, true);

        // 2. Upscale test: small image 600x900 -> Kindle PW12 (1272x1696)
        // Ratio = min(1272/600 = 2.12, 1696/900 = 1.88444) = 1.88444
        // Width = round(600 * 1.88444) = 1131, Height = round(900 * 1.88444) = 1696
        const imgSmall = new globalThis.Image();
        imgSmall.width = 600;
        imgSmall.height = 900;
        const resSmallUpscale = await processImage(imgSmall, null, DEVICE_PRESETS.KINDLE_PW12, false, 'image/jpeg', 'original', 0.85, true);
        const resSmallNoUpscale = await processImage(imgSmall, null, DEVICE_PRESETS.KINDLE_PW12, false, 'image/jpeg', 'original', 0.85, false);

        console.log(JSON.stringify({
            large: { width: resLarge.width, height: resLarge.height },
            smallUpscale: { width: resSmallUpscale.width, height: resSmallUpscale.height },
            smallNoUpscale: { width: resSmallNoUpscale.width, height: resSmallNoUpscale.height }
        }));
        """
        data = run_js_eval(code)
        self.assertEqual(data['large'], {'width': 1131, 'height': 1696})
        self.assertEqual(data['smallUpscale'], {'width': 1131, 'height': 1696})
        self.assertEqual(data['smallNoUpscale'], {'width': 600, 'height': 900})

    def test_epub_builder_kcc_xhtml_and_opf(self):
        code = self.base_env + r"""
        import { DEVICE_PRESETS } from './src/js/modules/constants.js';

        const mockImages = [
            { name: '001.jpg', async: async () => new globalThis.Blob([], { width: 1200, height: 1600 }) },
            { name: '002.jpg', async: async () => new globalThis.Blob([], { width: 1200, height: 1600 }) }
        ];

        let files = {};
        let fileOpts = {};
        let genOpts = null;
        const mockZip = {
            file: (name, content, opts) => { files[name] = content; fileOpts[name] = opts; return mockZip; },
            folder: (fName) => ({
                file: (name, content, opts) => { files[fName + '/' + name] = content; fileOpts[fName + '/' + name] = opts; return mockZip; },
                folder: (subName) => ({
                    file: (name, content, opts) => { files[fName + '/' + subName + '/' + name] = content; fileOpts[fName + '/' + subName + '/' + name] = opts; return mockZip; }
                })
            }),
            generateAsync: async (options) => {
                genOpts = options;
                return new globalThis.Blob(['epub']);
            }
        };

        await createEpub({
            images: mockImages,
            title: 'Test Book',
            author: 'Test Author',
            targetDevice: DEVICE_PRESETS.KINDLE_PW12,
            isUpscaleEnabled: true,
            jszipLib: function() { return mockZip; }
        });

        const page0 = files['OEBPS/Text/page_0000.xhtml'];
        const opf = files['OEBPS/content.opf'];
        const ncx = files['OEBPS/toc.ncx'];
        const nav = files['OEBPS/nav.xhtml'];
        const css = files['OEBPS/Text/style.css'];

        console.log(JSON.stringify({
            hasObjectFit: page0.includes('object-fit'),
            hasExplicitDimensions: page0.includes('width="') && page0.includes('height="'),
            hasCenterDiv: page0.includes('text-align:center') || page0.includes('text-align: center'),
            hasHiddenDiv: page0.includes('<div style="display:none;">.</div>'),
            hasCssLink: page0.includes('<link href="style.css" type="text/css" rel="stylesheet"/>'),
            originalResolution: opf.match(/name="original-resolution" content="([^"]+)"/)?.[1],
            hasZeroGutter: opf.includes('name="zero-gutter" content="true"'),
            hasZeroMargin: opf.includes('name="zero-margin" content="true"'),
            hasBorderColor: opf.includes('name="ke-border-color" content="#FFFFFF"'),
            hasOrientationLock: opf.includes('name="orientation-lock" content="none"'),
            hasRegionMag: opf.includes('name="region-mag" content="false"'),
            hasDctermsModified: /<meta property="dcterms:modified">\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z<\/meta>/.test(opf),
            hasNcxManifest: opf.includes('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'),
            hasNavManifest: opf.includes('<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>'),
            hasCssManifest: opf.includes('<item id="css" href="Text/style.css" media-type="text/css"/>'),
            hasSpineToc: opf.includes('toc="ncx"'),
            hasSpineLinear: opf.includes('linear="yes"'),
            hasNcxFile: !!ncx,
            hasNavFile: !!nav,
            hasCssFile: !!css,
            mimetypeCompression: fileOpts['mimetype']?.compression,
            generatorCompression: genOpts?.compression
        }));
        """
        data = run_js_eval(code)
        self.assertFalse(data['hasObjectFit'])
        self.assertTrue(data['hasExplicitDimensions'])
        self.assertTrue(data['hasCenterDiv'])
        self.assertTrue(data['hasHiddenDiv'])
        self.assertTrue(data['hasCssLink'])
        self.assertEqual(data['originalResolution'], '1272x1696')
        self.assertTrue(data['hasZeroGutter'])
        self.assertTrue(data['hasZeroMargin'])
        self.assertTrue(data['hasBorderColor'])
        self.assertTrue(data['hasOrientationLock'])
        self.assertTrue(data['hasRegionMag'])
        self.assertTrue(data['hasDctermsModified'])
        self.assertTrue(data['hasNcxManifest'])
        self.assertTrue(data['hasNavManifest'])
        self.assertTrue(data['hasCssManifest'])
        self.assertTrue(data['hasSpineToc'])
        self.assertTrue(data['hasSpineLinear'])
        self.assertTrue(data['hasNcxFile'])
        self.assertTrue(data['hasNavFile'])
        self.assertTrue(data['hasCssFile'])
        self.assertEqual(data['mimetypeCompression'], 'STORE')
        self.assertEqual(data['generatorCompression'], 'STORE')

    def test_epub_container_toc_ncx_structure(self):
        code = self.base_env + r"""
        const { zip, files } = createMockZip();
        const mockImages = [
            { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
            { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
        ];

        await createEpub({
            images: mockImages,
            title: 'TOC NCX Test & Adventure',
            author: 'Author NCX',
            readingDirection: READING_DIRECTIONS.LTR,
            jszipLib: class { constructor() { return zip; } }
        });

        const ncx = files['OEBPS/toc.ncx'];
        console.log(JSON.stringify({ ncx }));
        """
        data = run_js_eval(code)
        ncx = data['ncx']
        self.assertIsNotNone(ncx)
        self.assertIn('<?xml version="1.0" encoding="UTF-8"?>', ncx)
        self.assertIn('<ncx version="2005-1" xml:lang="en" xmlns="http://www.daisy.org/z3986/2005/ncx/">', ncx)
        self.assertIn('<meta name="dtb:uid" content="urn:uuid:', ncx)
        self.assertIn('<meta name="dtb:depth" content="1"/>', ncx)
        self.assertIn('<meta name="dtb:totalPageCount" content="0"/>', ncx)
        self.assertIn('<meta name="dtb:maxPageNumber" content="0"/>', ncx)
        self.assertIn('<meta name="generated" content="true"/>', ncx)
        self.assertIn('<docTitle><text>TOC NCX Test &amp; Adventure</text></docTitle>', ncx)
        self.assertIn('<navPoint id="page0">', ncx)
        self.assertIn('<navLabel><text>Page 0</text></navLabel>', ncx)
        self.assertIn('<content src="Text/page_0000.xhtml"/>', ncx)
        self.assertIn('<navPoint id="page1">', ncx)
        self.assertIn('<navLabel><text>Page 1</text></navLabel>', ncx)
        self.assertIn('<content src="Text/page_0001.xhtml"/>', ncx)

    def test_epub_container_nav_xhtml_structure(self):
        code = self.base_env + r"""
        const { zip, files } = createMockZip();
        const mockImages = [
            { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) },
            { name: 'p2.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
        ];

        await createEpub({
            images: mockImages,
            title: 'NAV XHTML Test',
            author: 'Author NAV',
            readingDirection: READING_DIRECTIONS.LTR,
            jszipLib: class { constructor() { return zip; } }
        });

        const nav = files['OEBPS/nav.xhtml'];
        console.log(JSON.stringify({ nav }));
        """
        data = run_js_eval(code)
        nav = data['nav']
        self.assertIsNotNone(nav)
        self.assertIn('<?xml version="1.0" encoding="utf-8"?>', nav)
        self.assertIn('<!DOCTYPE html>', nav)
        self.assertIn('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">', nav)
        self.assertIn('<title>NAV XHTML Test</title>', nav)
        self.assertIn('<nav epub:type="toc" id="toc">', nav)
        self.assertIn('<li><a href="Text/page_0000.xhtml">Page 0</a></li>', nav)
        self.assertIn('<li><a href="Text/page_0001.xhtml">Page 1</a></li>', nav)
        self.assertIn('<nav epub:type="page-list">', nav)
        self.assertIn('<li><a href="Text/page_0000.xhtml">Page 0</a></li>', nav)
        self.assertIn('<li><a href="Text/page_0001.xhtml">Page 1</a></li>', nav)

    def test_epub_container_custom_cover_in_ncx_and_nav(self):
        code = self.base_env + r"""
        const { zip, files } = createMockZip();
        const mockImages = [
            { name: 'p1.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
        ];
        const customCover = {
            name: 'my_cover.jpg',
            width: 1000,
            height: 1500
        };

        await createEpub({
            images: mockImages,
            title: 'Cover Nav Test',
            coverSource: COVER_SOURCES.CUSTOM,
            customCoverFile: customCover,
            jszipLib: class { constructor() { return zip; } }
        });

        const ncx = files['OEBPS/toc.ncx'];
        const nav = files['OEBPS/nav.xhtml'];
        console.log(JSON.stringify({ ncx, nav }));
        """
        data = run_js_eval(code)
        ncx = data['ncx']
        nav = data['nav']
        self.assertIn('<navPoint id="cover-page">', ncx)
        self.assertIn('<navLabel><text>Cover</text></navLabel>', ncx)
        self.assertIn('<content src="Text/cover.xhtml"/>', ncx)
        self.assertIn('<li><a href="Text/cover.xhtml">Cover</a></li>', nav)

    def test_index_html_device_options(self):
        index_path = REPO_ROOT / 'index.html'
        content = index_path.read_text(encoding='utf-8')
        self.assertIn('id="device-select"', content)
        self.assertIn('value="original"', content)
        self.assertIn('value="kindle_pw12"', content)
        self.assertIn('value="kindle_pw11"', content)
        self.assertIn('value="kindle_oasis"', content)
        self.assertIn('value="kindle_pw34"', content)
        self.assertIn('value="kindle_scribe"', content)
        self.assertIn('id="upscale-checkbox"', content)
        self.assertNotIn('id="kindle-pw12-checkbox"', content)

    def test_index_html_spread_and_png_options(self):
        index_path = REPO_ROOT / 'index.html'
        content = index_path.read_text(encoding='utf-8')
        self.assertIn('id="spread-mode-select"', content)
        self.assertIn('id="spread-suboptions-group"', content)
        self.assertIn('id="spread-no-rotate-checkbox"', content)
        self.assertIn('id="spread-rotate-right-checkbox"', content)
        self.assertIn('id="spread-position-select"', content)
        self.assertIn('value="png"', content)
        self.assertIn('value="png_8bit"', content)
        self.assertIn('value="png_4bit"', content)

    def test_ui_controller_dom_binding(self):
        code = self.base_env + r"""
        import { UIController } from './src/js/ui/ui-controller.js';

        const elements = {
            'drop-zone': { addEventListener: () => {}, classList: { add: () => {}, remove: () => {} } },
            'file-input': { addEventListener: () => {} },
            'convert-btn': { addEventListener: () => {}, disabled: false },
            'progress-container': { style: {} },
            'progress-fill': { style: {} },
            'status-text': { textContent: '' },
            'title-input': { value: 'My Book' },
            'author-input': { value: 'My Author' },
            'cover-input': { files: [] },
            'cover-page-input': { value: '1' },
            'cover-page-input-group': { style: {} },
            'cover-file-input-group': { style: {} },
            'spread-mode-select': { value: 'split', addEventListener: () => {} },
            'spread-suboptions-group': { style: {} },
            'spread-no-rotate-group': { style: {} },
            'spread-no-rotate-checkbox': { checked: false, addEventListener: () => {} },
            'spread-rotate-right-group': { style: {} },
            'spread-rotate-right-checkbox': { checked: false },
            'spread-position-group': { style: {} },
            'spread-position-select': { value: 'after' },
            'direction-select': { value: 'ltr' },
            'format-select': { value: 'original', addEventListener: () => {} },
            'device-select': { value: 'kindle_pw11' },
            'upscale-checkbox': { checked: false },
            'grayscale-checkbox': { checked: false },
            'format-group': { style: {} },
            'file-list': { innerHTML: '', style: {}, appendChild: () => {} },
            'merge-group': { style: {} },
            'merge-checkbox': { checked: false, disabled: false },
            'quality-group': { style: {} },
            'quality-input': { value: '85' },
            'landscape-spread-checkbox': { checked: false },
            'offset-first-page-checkbox': { checked: false }
        };

        globalThis.document = {
            getElementById: (id) => elements[id] || null,
            querySelectorAll: (sel) => []
        };

        const controller = new UIController();
        console.log(JSON.stringify({
            hasDeviceSelect: !!controller.deviceSelect,
            deviceSelectValue: controller.deviceSelect.value,
            hasUpscaleCheckbox: !!controller.upscaleCheckbox,
            upscaleChecked: controller.upscaleCheckbox.checked,
            hasSpreadModeSelect: !!controller.spreadModeSelect,
            spreadModeValue: controller.spreadModeSelect.value,
            hasSpreadSuboptionsGroup: !!controller.spreadSuboptionsGroup
        }));
        """
        data = run_js_eval(code)
        self.assertTrue(data['hasDeviceSelect'])
        self.assertEqual(data['deviceSelectValue'], 'kindle_pw11')
        self.assertTrue(data['hasUpscaleCheckbox'])
        self.assertFalse(data['upscaleChecked'])
        self.assertTrue(data['hasSpreadModeSelect'])
        self.assertEqual(data['spreadModeValue'], 'split')
        self.assertTrue(data['hasSpreadSuboptionsGroup'])

    def test_ui_controller_spread_suboptions_visibility(self):
        code = self.base_env + r"""
        import { UIController } from './src/js/ui/ui-controller.js';

        const elements = {
            'drop-zone': { addEventListener: () => {}, classList: { add: () => {}, remove: () => {} } },
            'file-input': { addEventListener: () => {} },
            'convert-btn': { addEventListener: () => {}, disabled: false },
            'progress-container': { style: {} },
            'progress-fill': { style: {} },
            'status-text': { textContent: '' },
            'title-input': { value: 'My Book' },
            'author-input': { value: 'My Author' },
            'cover-input': { files: [] },
            'cover-page-input': { value: '1' },
            'cover-page-input-group': { style: {} },
            'cover-file-input-group': { style: {} },
            'spread-mode-select': { value: 'split', addEventListener: () => {} },
            'spread-suboptions-group': { style: {} },
            'spread-no-rotate-group': { style: {} },
            'spread-no-rotate-checkbox': { checked: false, addEventListener: () => {} },
            'spread-rotate-right-group': { style: {} },
            'spread-rotate-right-checkbox': { checked: false },
            'spread-position-group': { style: {} },
            'spread-position-select': { value: 'after' },
            'direction-select': { value: 'ltr' },
            'format-select': { value: 'original', addEventListener: () => {} },
            'device-select': { value: 'kindle_pw11' },
            'upscale-checkbox': { checked: false },
            'grayscale-checkbox': { checked: false },
            'format-group': { style: {} },
            'file-list': { innerHTML: '', style: {}, appendChild: () => {} },
            'merge-group': { style: {} },
            'merge-checkbox': { checked: false, disabled: false },
            'quality-group': { style: {} },
            'quality-input': { value: '85' },
            'landscape-spread-checkbox': { checked: false },
            'offset-first-page-checkbox': { checked: false }
        };

        globalThis.document = {
            getElementById: (id) => elements[id] || null,
            querySelectorAll: (sel) => []
        };

        const controller = new UIController();

        // 1. Initial state ('split') -> suboptions hidden
        const splitSubDisplay = elements['spread-suboptions-group'].style.display;

        // 2. Mode 'off' -> suboptions hidden
        elements['spread-mode-select'].value = 'off';
        controller.updateSpreadSuboptions();
        const offSubDisplay = elements['spread-suboptions-group'].style.display;

        // 3. Mode 'rotate', noRotate=false -> suboptions flex, no-rotate flex, rotate-right flex, position none
        elements['spread-mode-select'].value = 'rotate';
        elements['spread-no-rotate-checkbox'].checked = false;
        controller.updateSpreadSuboptions();
        const rotateState1 = {
            sub: elements['spread-suboptions-group'].style.display,
            noRotate: elements['spread-no-rotate-group'].style.display,
            rotateRight: elements['spread-rotate-right-group'].style.display,
            position: elements['spread-position-group'].style.display
        };

        // 4. Mode 'rotate', noRotate=true -> rotate-right hidden
        elements['spread-no-rotate-checkbox'].checked = true;
        controller.updateSpreadSuboptions();
        const rotateState2 = {
            sub: elements['spread-suboptions-group'].style.display,
            rotateRight: elements['spread-rotate-right-group'].style.display
        };

        // 5. Mode 'both', noRotate=false -> position shown (flex)
        elements['spread-mode-select'].value = 'both';
        elements['spread-no-rotate-checkbox'].checked = false;
        controller.updateSpreadSuboptions();
        const bothState1 = {
            sub: elements['spread-suboptions-group'].style.display,
            noRotate: elements['spread-no-rotate-group'].style.display,
            rotateRight: elements['spread-rotate-right-group'].style.display,
            position: elements['spread-position-group'].style.display
        };

        console.log(JSON.stringify({
            splitSubDisplay,
            offSubDisplay,
            rotateState1,
            rotateState2,
            bothState1
        }));
        """
        data = run_js_eval(code)
        self.assertEqual(data['splitSubDisplay'], 'none')
        self.assertEqual(data['offSubDisplay'], 'none')
        self.assertEqual(data['rotateState1']['sub'], 'flex')
        self.assertEqual(data['rotateState1']['noRotate'], 'flex')
        self.assertEqual(data['rotateState1']['rotateRight'], 'flex')
        self.assertEqual(data['rotateState1']['position'], 'none')
        self.assertEqual(data['rotateState2']['sub'], 'flex')
        self.assertEqual(data['rotateState2']['rotateRight'], 'none')
        self.assertEqual(data['bothState1']['sub'], 'flex')
        self.assertEqual(data['bothState1']['noRotate'], 'flex')
        self.assertEqual(data['bothState1']['rotateRight'], 'flex')
        self.assertEqual(data['bothState1']['position'], 'flex')

    def test_epub_spread_mode_split_ltr_and_rtl(self):
        code = self.base_env + r"""
        const { zip: zipLtr, files: filesLtr } = createMockZip();
        const mockSpread = [
            { name: 'spread.jpg', async: async () => new globalThis.Blob([], { width: 2000, height: 1000 }) }
        ];

        await createEpub({
            images: mockSpread,
            title: 'Split LTR Test',
            readingDirection: READING_DIRECTIONS.LTR,
            spreadMode: SPREAD_MODES.SPLIT,
            isLandscapeSpread: true,
            jszipLib: class { constructor() { return zipLtr; } }
        });

        const { zip: zipRtl, files: filesRtl } = createMockZip();
        await createEpub({
            images: mockSpread,
            title: 'Split RTL Test',
            readingDirection: READING_DIRECTIONS.RTL,
            spreadMode: SPREAD_MODES.SPLIT,
            isLandscapeSpread: true,
            jszipLib: class { constructor() { return zipRtl; } }
        });

        console.log(JSON.stringify({
            ltrFiles: Object.keys(filesLtr),
            ltrOpf: filesLtr['OEBPS/content.opf'],
            rtlFiles: Object.keys(filesRtl),
            rtlOpf: filesRtl['OEBPS/content.opf']
        }));
        """
        data = run_js_eval(code)
        # LTR: left first, then right
        self.assertIn('OEBPS/Images/image_0000_left.jpg', data['ltrFiles'])
        self.assertIn('OEBPS/Images/image_0001_right.jpg', data['ltrFiles'])
        self.assertIn('<itemref idref="page0" linear="yes" properties="page-spread-left"/>', data['ltrOpf'])
        self.assertIn('<itemref idref="page1" linear="yes" properties="page-spread-right"/>', data['ltrOpf'])

        # RTL: right first, then left
        self.assertIn('OEBPS/Images/image_0000_right.jpg', data['rtlFiles'])
        self.assertIn('OEBPS/Images/image_0001_left.jpg', data['rtlFiles'])
        self.assertIn('<itemref idref="page0" linear="yes" properties="page-spread-right"/>', data['rtlOpf'])
        self.assertIn('<itemref idref="page1" linear="yes" properties="page-spread-left"/>', data['rtlOpf'])

    def test_epub_spread_mode_rotate(self):
        code = self.base_env + r"""
        const { zip, files } = createMockZip();
        const mockSpread = [
            { name: 'spread.jpg', async: async () => new globalThis.Blob([], { width: 2000, height: 1000 }) }
        ];

        await createEpub({
            images: mockSpread,
            title: 'Rotate Spread Test',
            readingDirection: READING_DIRECTIONS.LTR,
            spreadMode: SPREAD_MODES.ROTATE,
            isLandscapeSpread: true,
            jszipLib: class { constructor() { return zip; } }
        });

        console.log(JSON.stringify({
            files: Object.keys(files),
            opf: files['OEBPS/content.opf'],
            page0: files['OEBPS/Text/page_0000.xhtml']
        }));
        """
        data = run_js_eval(code)
        self.assertIn('OEBPS/Images/image_0000_spread.jpg', data['files'])
        self.assertIn('id="img0" href="Images/image_0000_spread.jpg" media-type="image/jpeg"', data['opf'])
        self.assertIn('<itemref idref="page0" linear="yes" properties="page-spread-center"/>', data['opf'])
        # Rotated 90 deg -> width 1000, height 2000
        self.assertIn('width="1000"', data['page0'])
        self.assertIn('height="2000"', data['page0'])

    def test_epub_spread_mode_both_before_and_after(self):
        code = self.base_env + r"""
        const { zip: zipBefore, files: filesBefore } = createMockZip();
        const mockSpread = [
            { name: 'spread.jpg', async: async () => new globalThis.Blob([], { width: 2000, height: 1000 }) }
        ];

        await createEpub({
            images: mockSpread,
            title: 'Both Before Test',
            readingDirection: READING_DIRECTIONS.LTR,
            spreadMode: SPREAD_MODES.BOTH,
            spreadPosition: SPREAD_POSITIONS.BEFORE,
            isLandscapeSpread: true,
            jszipLib: class { constructor() { return zipBefore; } }
        });

        const { zip: zipAfter, files: filesAfter } = createMockZip();
        await createEpub({
            images: mockSpread,
            title: 'Both After Test',
            readingDirection: READING_DIRECTIONS.LTR,
            spreadMode: SPREAD_MODES.BOTH,
            spreadPosition: SPREAD_POSITIONS.AFTER,
            isLandscapeSpread: true,
            jszipLib: class { constructor() { return zipAfter; } }
        });

        console.log(JSON.stringify({
            beforeFiles: Object.keys(filesBefore),
            beforeOpf: filesBefore['OEBPS/content.opf'],
            afterFiles: Object.keys(filesAfter),
            afterOpf: filesAfter['OEBPS/content.opf']
        }));
        """
        data = run_js_eval(code)
        # BEFORE: [R, S1, S2] -> image_0000_spread, image_0001_left, image_0002_right
        self.assertIn('OEBPS/Images/image_0000_spread.jpg', data['beforeFiles'])
        self.assertIn('OEBPS/Images/image_0001_left.jpg', data['beforeFiles'])
        self.assertIn('OEBPS/Images/image_0002_right.jpg', data['beforeFiles'])
        self.assertIn('<itemref idref="page0" linear="yes" properties="page-spread-center"/>', data['beforeOpf'])
        self.assertIn('<itemref idref="page1" linear="yes" properties="page-spread-left"/>', data['beforeOpf'])
        self.assertIn('<itemref idref="page2" linear="yes" properties="page-spread-right"/>', data['beforeOpf'])

        # AFTER: [S1, S2, R] -> image_0000_left, image_0001_right, image_0002_spread
        self.assertIn('OEBPS/Images/image_0000_left.jpg', data['afterFiles'])
        self.assertIn('OEBPS/Images/image_0001_right.jpg', data['afterFiles'])
        self.assertIn('OEBPS/Images/image_0002_spread.jpg', data['afterFiles'])
        self.assertIn('<itemref idref="page0" linear="yes" properties="page-spread-left"/>', data['afterOpf'])
        self.assertIn('<itemref idref="page1" linear="yes" properties="page-spread-right"/>', data['afterOpf'])
        self.assertIn('<itemref idref="page2" linear="yes" properties="page-spread-center"/>', data['afterOpf'])

    def test_epub_spread_mode_no_rotate(self):
        code = self.base_env + r"""
        const { zip, files } = createMockZip();
        const mockSpread = [
            { name: 'spread.jpg', async: async () => new globalThis.Blob([], { width: 2000, height: 1000 }) }
        ];

        await createEpub({
            images: mockSpread,
            title: 'No Rotate Test',
            readingDirection: READING_DIRECTIONS.LTR,
            spreadMode: SPREAD_MODES.ROTATE,
            spreadNoRotate: true,
            isLandscapeSpread: true,
            jszipLib: class { constructor() { return zip; } }
        });

        console.log(JSON.stringify({
            files: Object.keys(files),
            page0: files['OEBPS/Text/page_0000.xhtml']
        }));
        """
        data = run_js_eval(code)
        self.assertIn('OEBPS/Images/image_0000_spread.jpg', data['files'])
        # Unrotated: width 2000, height 1000
        self.assertIn('width="2000"', data['page0'])
        self.assertIn('height="1000"', data['page0'])

    def test_epub_output_formats_png_indexed(self):
        code = self.base_env + r"""
        const { zip: zip4, files: files4 } = createMockZip();
        const mockImages = [
            { name: 'page.jpg', async: async () => new globalThis.Blob([], { width: 1000, height: 1500 }) }
        ];

        await createEpub({
            images: mockImages,
            title: 'PNG 4-bit Test',
            outputFormat: OUTPUT_FORMATS.PNG_4BIT,
            jszipLib: class { constructor() { return zip4; } }
        });

        const { zip: zip8, files: files8 } = createMockZip();
        await createEpub({
            images: mockImages,
            title: 'PNG 8-bit Test',
            outputFormat: OUTPUT_FORMATS.PNG_8BIT,
            jszipLib: class { constructor() { return zip8; } }
        });

        console.log(JSON.stringify({
            files4: Object.keys(files4),
            opf4: files4['OEBPS/content.opf'],
            files8: Object.keys(files8),
            opf8: files8['OEBPS/content.opf']
        }));
        """
        data = run_js_eval(code)
        self.assertIn('OEBPS/Images/image_0000.png', data['files4'])
        self.assertIn('id="img0" href="Images/image_0000.png" media-type="image/png"', data['opf4'])

        self.assertIn('OEBPS/Images/image_0000.png', data['files8'])
        self.assertIn('id="img0" href="Images/image_0000.png" media-type="image/png"', data['opf8'])

    def test_epub_spread_mode_backward_compatibility(self):
        code = self.base_env + r"""
        const mockSpread = [
            { name: 'spread.jpg', async: async () => new globalThis.Blob([], { width: 2000, height: 1000 }) }
        ];

        // 1. isOptimizeEnabled: true, spreadMode not passed -> SPLIT
        const { zip: zipOpt, files: filesOpt } = createMockZip();
        await createEpub({
            images: mockSpread,
            title: 'Back Compat Opt True',
            isOptimizeEnabled: true,
            jszipLib: class { constructor() { return zipOpt; } }
        });

        // 2. isOptimizeEnabled: false, spreadMode not passed -> OFF (1 page)
        const { zip: zipNoOpt, files: filesNoOpt } = createMockZip();
        await createEpub({
            images: mockSpread,
            title: 'Back Compat Opt False',
            isOptimizeEnabled: false,
            jszipLib: class { constructor() { return zipNoOpt; } }
        });

        console.log(JSON.stringify({
            filesOpt: Object.keys(filesOpt),
            filesNoOpt: Object.keys(filesNoOpt)
        }));
        """
        data = run_js_eval(code)
        self.assertIn('OEBPS/Images/image_0000_left.jpg', data['filesOpt'])
        self.assertIn('OEBPS/Images/image_0001_right.jpg', data['filesOpt'])

        self.assertIn('OEBPS/Images/image_0000.jpg', data['filesNoOpt'])
        self.assertNotIn('OEBPS/Images/image_0001.jpg', data['filesNoOpt'])

if __name__ == '__main__':
    unittest.main()


