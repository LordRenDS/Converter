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
        import { READING_DIRECTIONS, COVER_SOURCES, OUTPUT_FORMATS } from './src/js/modules/constants.js';

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
                return {
                    drawImage: () => {},
                    getImageData: () => ({ data: new Uint8Array(4) }),
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
            const zip = {
                file: (path, content) => { files[path] = content; return zip; },
                folder: (name) => {
                    return {
                        file: (subPath, content) => { files[`${name}/${subPath}`] = content; return zip; },
                        folder: (nestedName) => ({
                            file: (nestedPath, content) => { files[`${name}/${nestedName}/${nestedPath}`] = content; return zip; }
                        })
                    };
                },
                async generateAsync(options) { return new globalThis.Blob(['mock-epub'], { type: options?.mimeType || 'application/epub+zip' }); }
            };
            return { zip, files };
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
        self.assertIn('<meta property="rendition:spread">landscape</meta>', opf)
        self.assertIn('<itemref idref="page0" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page1" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page2" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page3" properties="page-spread-left"/>', opf)

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
        self.assertIn('<meta property="rendition:spread">landscape</meta>', opf)
        self.assertIn('<itemref idref="page0" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page1" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page2" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page3" properties="page-spread-right"/>', opf)

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
        self.assertIn('<itemref idref="page0" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page1" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page2" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page3" properties="page-spread-right"/>', opf)

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
        self.assertIn('<itemref idref="page0" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page1" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page2" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page3" properties="page-spread-left"/>', opf)

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
        self.assertIn('<itemref idref="page0" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page1" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page2" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page3" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page4" properties="page-spread-left"/>', opf)

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
        self.assertIn('<itemref idref="page0" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page1" properties="page-spread-center"/>', opf)
        self.assertIn('<itemref idref="page2" properties="page-spread-right"/>', opf)

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
        self.assertIn('<itemref idref="page0" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page1" properties="page-spread-center"/>', opf)
        self.assertIn('<itemref idref="page2" properties="page-spread-left"/>', opf)

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
        self.assertIn('<itemref idref="cover-page" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page0" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page1" properties="page-spread-right"/>', opf)

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
        self.assertIn('<itemref idref="cover-page" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page0" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page1" properties="page-spread-left"/>', opf)

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
        self.assertIn('<itemref idref="page0"/>', opf)
        self.assertIn('<itemref idref="page1"/>', opf)
        self.assertIn('<itemref idref="page2"/>', opf)

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
        self.assertIn('<itemref idref="page0"/>', opf)
        self.assertIn('<itemref idref="page1"/>', opf)

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
        self.assertIn('<itemref idref="page0" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page1" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page2" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page3" properties="page-spread-right"/>', opf)

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
        self.assertIn('<itemref idref="page0" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page1" properties="page-spread-left"/>', opf)
        self.assertIn('<itemref idref="page2" properties="page-spread-right"/>', opf)
        self.assertIn('<itemref idref="page3" properties="page-spread-left"/>', opf)

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

if __name__ == '__main__':
    unittest.main()
