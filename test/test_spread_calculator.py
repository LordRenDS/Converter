import unittest
import json
import subprocess
import shutil
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = REPO_ROOT / 'src' / 'js' / 'modules' / 'spread-calculator.js'

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

class TestSpreadCalculator(unittest.TestCase):
    def test_module_exists(self):
        self.assertTrue(MODULE_PATH.exists(), f"Module file must exist at {MODULE_PATH}")

    def test_page_types_constants(self):
        code = """
        import { PAGE_TYPES } from './src/js/modules/spread-calculator.js';
        console.log(JSON.stringify(PAGE_TYPES));
        """
        page_types = run_js_eval(code)
        self.assertEqual(page_types, {
            "NORMAL": "N",
            "SPREAD_PART_1": "S1",
            "SPREAD_PART_2": "S2",
            "SPREAD_CENTER": "R"
        })

    def test_landscape_spread_disabled(self):
        code = """
        import { calculatePageSpreads, PAGE_TYPES } from './src/js/modules/spread-calculator.js';
        const pages = [
            { type: PAGE_TYPES.NORMAL },
            { type: PAGE_TYPES.SPREAD_PART_1 },
            { type: PAGE_TYPES.SPREAD_PART_2 },
            { type: PAGE_TYPES.NORMAL }
        ];
        const res = calculatePageSpreads({
            pages,
            readingDirection: 'rtl',
            isLandscapeSpread: false,
            isOffsetFirstPage: false
        });
        console.log(JSON.stringify(res));
        """
        res = run_js_eval(code)
        self.assertEqual(res, ["", "", "", ""])

    def test_empty_pages(self):
        code = """
        import { calculatePageSpreads } from './src/js/modules/spread-calculator.js';
        const res = calculatePageSpreads({
            pages: [],
            readingDirection: 'rtl',
            isLandscapeSpread: true,
            isOffsetFirstPage: false
        });
        console.log(JSON.stringify(res));
        """
        res = run_js_eval(code)
        self.assertEqual(res, [])

    def test_ltr_single_pages_no_offset(self):
        code = """
        import { calculatePageSpreads, PAGE_TYPES } from './src/js/modules/spread-calculator.js';
        const pages = [
            { type: PAGE_TYPES.NORMAL },
            { type: PAGE_TYPES.NORMAL },
            { type: PAGE_TYPES.NORMAL },
            { type: PAGE_TYPES.NORMAL }
        ];
        const res = calculatePageSpreads({
            pages,
            readingDirection: 'ltr',
            isLandscapeSpread: true,
            isOffsetFirstPage: false
        });
        console.log(JSON.stringify(res));
        """
        res = run_js_eval(code)
        self.assertEqual(res, ["left", "right", "left", "right"])

    def test_rtl_single_pages_no_offset(self):
        code = """
        import { calculatePageSpreads, PAGE_TYPES } from './src/js/modules/spread-calculator.js';
        const pages = [
            { type: PAGE_TYPES.NORMAL },
            { type: PAGE_TYPES.NORMAL },
            { type: PAGE_TYPES.NORMAL },
            { type: PAGE_TYPES.NORMAL }
        ];
        const res = calculatePageSpreads({
            pages,
            readingDirection: 'rtl',
            isLandscapeSpread: true,
            isOffsetFirstPage: false
        });
        console.log(JSON.stringify(res));
        """
        res = run_js_eval(code)
        self.assertEqual(res, ["right", "left", "right", "left"])

    def test_rtl_single_pages_with_offset(self):
        code = """
        import { calculatePageSpreads, PAGE_TYPES } from './src/js/modules/spread-calculator.js';
        const pages = [
            { type: PAGE_TYPES.NORMAL },
            { type: PAGE_TYPES.NORMAL },
            { type: PAGE_TYPES.NORMAL },
            { type: PAGE_TYPES.NORMAL }
        ];
        const res = calculatePageSpreads({
            pages,
            readingDirection: 'rtl',
            isLandscapeSpread: true,
            isOffsetFirstPage: true
        });
        console.log(JSON.stringify(res));
        """
        res = run_js_eval(code)
        self.assertEqual(res, ["left", "right", "left", "right"])

    def test_ltr_single_pages_with_offset(self):
        code = """
        import { calculatePageSpreads, PAGE_TYPES } from './src/js/modules/spread-calculator.js';
        const pages = [
            { type: PAGE_TYPES.NORMAL },
            { type: PAGE_TYPES.NORMAL },
            { type: PAGE_TYPES.NORMAL },
            { type: PAGE_TYPES.NORMAL }
        ];
        const res = calculatePageSpreads({
            pages,
            readingDirection: 'ltr',
            isLandscapeSpread: true,
            isOffsetFirstPage: true
        });
        console.log(JSON.stringify(res));
        """
        res = run_js_eval(code)
        self.assertEqual(res, ["right", "left", "right", "left"])

    def test_ltr_split_spread(self):
        code = """
        import { calculatePageSpreads, PAGE_TYPES } from './src/js/modules/spread-calculator.js';
        const pages = [
            { type: PAGE_TYPES.NORMAL },
            { type: PAGE_TYPES.SPREAD_PART_1 },
            { type: PAGE_TYPES.SPREAD_PART_2 },
            { type: PAGE_TYPES.NORMAL }
        ];
        const res = calculatePageSpreads({
            pages,
            readingDirection: 'ltr',
            isLandscapeSpread: true,
            isOffsetFirstPage: false
        });
        console.log(JSON.stringify(res));
        """
        res = run_js_eval(code)
        self.assertEqual(res, ["right", "left", "right", "left"])

    def test_rtl_split_spread(self):
        code = """
        import { calculatePageSpreads, PAGE_TYPES } from './src/js/modules/spread-calculator.js';
        const pages = [
            { type: PAGE_TYPES.NORMAL },
            { type: PAGE_TYPES.SPREAD_PART_1 },
            { type: PAGE_TYPES.SPREAD_PART_2 },
            { type: PAGE_TYPES.NORMAL }
        ];
        const res = calculatePageSpreads({
            pages,
            readingDirection: 'rtl',
            isLandscapeSpread: true,
            isOffsetFirstPage: false
        });
        console.log(JSON.stringify(res));
        """
        res = run_js_eval(code)
        self.assertEqual(res, ["left", "right", "left", "right"])

    def test_rtl_center_spread(self):
        code = """
        import { calculatePageSpreads, PAGE_TYPES } from './src/js/modules/spread-calculator.js';
        const pages = [
            { type: PAGE_TYPES.NORMAL },
            { type: PAGE_TYPES.SPREAD_CENTER },
            { type: PAGE_TYPES.NORMAL }
        ];
        const res = calculatePageSpreads({
            pages,
            readingDirection: 'rtl',
            isLandscapeSpread: true,
            isOffsetFirstPage: false
        });
        console.log(JSON.stringify(res));
        """
        res = run_js_eval(code)
        self.assertEqual(res, ["left", "center", "right"])

    def test_ltr_center_spread(self):
        code = """
        import { calculatePageSpreads, PAGE_TYPES } from './src/js/modules/spread-calculator.js';
        const pages = [
            { type: PAGE_TYPES.NORMAL },
            { type: PAGE_TYPES.SPREAD_CENTER },
            { type: PAGE_TYPES.NORMAL }
        ];
        const res = calculatePageSpreads({
            pages,
            readingDirection: 'ltr',
            isLandscapeSpread: true,
            isOffsetFirstPage: false
        });
        console.log(JSON.stringify(res));
        """
        res = run_js_eval(code)
        self.assertEqual(res, ["right", "center", "left"])

    def test_rtl_backward_pass_odd_pages(self):
        code = """
        import { calculatePageSpreads, PAGE_TYPES } from './src/js/modules/spread-calculator.js';
        const pages = [
            { type: PAGE_TYPES.NORMAL },
            { type: PAGE_TYPES.NORMAL },
            { type: PAGE_TYPES.NORMAL },
            { type: PAGE_TYPES.SPREAD_PART_1 },
            { type: PAGE_TYPES.SPREAD_PART_2 }
        ];
        const res = calculatePageSpreads({
            pages,
            readingDirection: 'rtl',
            isLandscapeSpread: true,
            isOffsetFirstPage: false
        });
        console.log(JSON.stringify(res));
        """
        res = run_js_eval(code)
        self.assertEqual(res, ["left", "right", "left", "right", "left"])

    def test_page_spread_property(self):
        code = """
        import { getPageSpreadProperty } from './src/js/modules/spread-calculator.js';
        const res = [
            getPageSpreadProperty(''),
            getPageSpreadProperty(null),
            getPageSpreadProperty(undefined),
            getPageSpreadProperty('left'),
            getPageSpreadProperty('right'),
            getPageSpreadProperty('center')
        ];
        console.log(JSON.stringify(res));
        """
        res = run_js_eval(code)
        self.assertEqual(res, [
            "",
            "",
            "",
            ' properties="page-spread-left"',
            ' properties="page-spread-right"',
            ' properties="page-spread-center"'
        ])

    def test_rtl_multiple_clusters(self):
        code = """
        import { calculatePageSpreads, PAGE_TYPES } from './src/js/modules/spread-calculator.js';
        const pages = [
            { type: PAGE_TYPES.NORMAL },
            { type: PAGE_TYPES.SPREAD_PART_1 },
            { type: PAGE_TYPES.SPREAD_PART_2 },
            { type: PAGE_TYPES.NORMAL },
            { type: PAGE_TYPES.SPREAD_PART_1 },
            { type: PAGE_TYPES.SPREAD_PART_2 }
        ];
        const res = calculatePageSpreads({
            pages,
            readingDirection: 'rtl',
            isLandscapeSpread: true,
            isOffsetFirstPage: false
        });
        console.log(JSON.stringify(res));
        """
        res = run_js_eval(code)
        self.assertEqual(res, ["left", "right", "left", "left", "right", "left"])

    def test_default_page_type(self):
        code = """
        import { calculatePageSpreads } from './src/js/modules/spread-calculator.js';
        const pages = [
            {},
            { type: 'N' },
            {}
        ];
        const res = calculatePageSpreads({
            pages,
            readingDirection: 'rtl',
            isLandscapeSpread: true,
            isOffsetFirstPage: false
        });
        console.log(JSON.stringify(res));
        """
        res = run_js_eval(code)
        self.assertEqual(res, ["right", "left", "right"])

if __name__ == '__main__':
    unittest.main()
