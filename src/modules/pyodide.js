import "/lib/pyodide/xhr-shim.js";
self.XMLHttpRequest = self.XMLHttpRequestShim;
import "/lib/pyodide/pyodide.asm.js";
import { loadPyodide } from "/lib/pyodide/pyodide.mjs";

let pyodideReadyPromise;

// Helper function for logging
function log(message) {
  console.log(`[Composer Quant Tools] ${message}`);
}

async function loadPyodideAndPackages() {
  self.pyodide = await loadPyodide({
    indexURL: chrome.runtime.getURL("/lib/pyodide/"),
  });
  await pyodide.loadPackage("pandas");
  await pyodide.loadPackage("micropip");
  await pyodide.loadPackage("ipython");
  await pyodide.loadPackage("openblas");
  await pyodide.loadPackage("/lib/pyodide/quantstats_lumi-0.3.3-py2.py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/tabulate-0.9.0-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/yfinance-0.2.48-py2.py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/seaborn-0.13.2-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/platformdirs-4.2.2-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/frozendict-2.4.6-py312-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/multitasking-0.0.11-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/matplotlib-3.5.2-cp312-cp312-pyodide_2024_0_wasm32.whl");
  await pyodide.loadPackage("/lib/pyodide/cycler-0.12.1-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/fonttools-4.51.0-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/kiwisolver-1.4.5-cp312-cp312-pyodide_2024_0_wasm32.whl");
  await pyodide.loadPackage("/lib/pyodide/pillow-10.2.0-cp312-cp312-pyodide_2024_0_wasm32.whl");
  await pyodide.loadPackage("/lib/pyodide/pyparsing-3.1.2-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/matplotlib_pyodide-0.2.2-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/scipy-1.12.0-cp312-cp312-pyodide_2024_0_wasm32.whl");
  await pyodide.loadPackage("/lib/pyodide/requests-2.31.0-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/charset_normalizer-3.3.2-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/idna-3.7-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/urllib3-2.2.1-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/certifi-2024.2.2-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/beautifulsoup4-4.12.3-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/soupsieve-2.5-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/peewee-3.17.3-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/cffi-1.16.0-cp312-cp312-pyodide_2024_0_wasm32.whl");
  await pyodide.loadPackage("/lib/pyodide/pycparser-2.22-py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/lxml-5.2.1-cp312-cp312-pyodide_2024_0_wasm32.whl");
  await pyodide.loadPackage("/lib/pyodide/html5lib-1.1-py2.py3-none-any.whl");
  await pyodide.loadPackage("/lib/pyodide/webencodings-0.5.1-py2.py3-none-any.whl");
  return pyodide;
}

// Initialize pyodide
pyodideReadyPromise = loadPyodideAndPackages();

// Function to get or initialize pyodide
function getPyodide() {
  pyodideReadyPromise = pyodideReadyPromise || loadPyodideAndPackages();
  return pyodideReadyPromise;
}

export { log, getPyodide }; 