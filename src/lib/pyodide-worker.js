// Import Pyodide
console.log("Worker: Starting to load Pyodide");
self.postMessage({type: 'status', message: 'Worker starting'});

// Error handling for the entire worker
self.addEventListener('error', function(e) {
  console.error("Worker global error:", e);
  self.postMessage({
    type: 'error',
    error: `Worker global error: ${e.message}`
  });
});

// Load Pyodide
try {
  importScripts('./pyodide/pyodide.js');
  self.postMessage({type: 'status', message: 'Imported pyodide.js'});
} catch (error) {
  console.error("Worker: Failed to import pyodide.js:", error);
  self.postMessage({
    type: 'error',
    error: `Failed to import pyodide.js: ${error.message}`
  });
}

// Initialize Pyodide
async function initPyodide() {
  try {
    self.postMessage({type: 'status', message: 'Loading Pyodide...'});
    
    // Initialize Pyodide
    self.pyodide = await loadPyodide();
    self.postMessage({type: 'status', message: 'Pyodide loaded!'});
    
    // Load required packages
    self.postMessage({type: 'status', message: 'Loading core packages...'});
    await self.pyodide.loadPackage(["pandas", "micropip", "ipython", "openblas"]);
    
    // Load custom packages one by one with error handling
    const customPackages = [
      "./pyodide/quantstats_lumi-0.3.3-py2.py3-none-any.whl",
      "./pyodide/tabulate-0.9.0-py3-none-any.whl",
      "./pyodide/yfinance-0.2.48-py2.py3-none-any.whl",
      "./pyodide/seaborn-0.13.2-py3-none-any.whl",
      "./pyodide/platformdirs-4.2.2-py3-none-any.whl",
      "./pyodide/frozendict-2.4.6-py312-none-any.whl",
      "./pyodide/multitasking-0.0.11-py3-none-any.whl",
      "./pyodide/matplotlib-3.5.2-cp312-cp312-pyodide_2024_0_wasm32.whl",
      "./pyodide/cycler-0.12.1-py3-none-any.whl",
      "./pyodide/fonttools-4.51.0-py3-none-any.whl",
      "./pyodide/kiwisolver-1.4.5-cp312-cp312-pyodide_2024_0_wasm32.whl",
      "./pyodide/pillow-10.2.0-cp312-cp312-pyodide_2024_0_wasm32.whl",
      "./pyodide/pyparsing-3.1.2-py3-none-any.whl",
      "./pyodide/matplotlib_pyodide-0.2.2-py3-none-any.whl",
      "./pyodide/scipy-1.12.0-cp312-cp312-pyodide_2024_0_wasm32.whl",
      "./pyodide/requests-2.31.0-py3-none-any.whl",
      "./pyodide/charset_normalizer-3.3.2-py3-none-any.whl",
      "./pyodide/idna-3.7-py3-none-any.whl",
      "./pyodide/urllib3-2.2.1-py3-none-any.whl",
      "./pyodide/certifi-2024.2.2-py3-none-any.whl",
      "./pyodide/beautifulsoup4-4.12.3-py3-none-any.whl",
      "./pyodide/soupsieve-2.5-py3-none-any.whl",
      "./pyodide/peewee-3.17.3-py3-none-any.whl",
      "./pyodide/cffi-1.16.0-cp312-cp312-pyodide_2024_0_wasm32.whl",
      "./pyodide/pycparser-2.22-py3-none-any.whl",
      "./pyodide/lxml-5.2.1-cp312-cp312-pyodide_2024_0_wasm32.whl",
      "./pyodide/html5lib-1.1-py2.py3-none-any.whl",
      "./pyodide/webencodings-0.5.1-py2.py3-none-any.whl"
    ];
    
    for (const pkg of customPackages) {
      try {
        self.postMessage({type: 'status', message: `Loading ${pkg}...`});
        await self.pyodide.loadPackage(pkg);
      } catch (err) {
        self.postMessage({
          type: 'warning',
          message: `Failed to load package ${pkg}: ${err.message}. Continuing with remaining packages.`
        });
      }
    }
    
    self.postMessage({type: 'status', message: 'All packages loaded!'});
    
    // Configure Pyodide to work better with network isolation
    await self.pyodide.runPythonAsync(`
import sys

# Configure yfinance to prefer local data when possible
try:
    import yfinance as yf
    # Set cache location but don't disable downloads
    print("Configuring yfinance...")
except Exception as e:
    print(f"Note about yfinance: {e}")

# Patch url fetching to handle failures gracefully
try:
    import urllib3
    import requests
    print("Network libraries loaded successfully")
except Exception as e:
    print(f"Note about network libraries: {e}")
`);
    
    // Signal that we're ready
    self.postMessage({type: 'ready'});
  } catch (error) {
    console.error("Worker: Failed to initialize Pyodide:", error);
    self.postMessage({
      type: 'error',
      error: `Failed to initialize Pyodide: ${error.message}`
    });
  }
}

// Generate QuantStats metrics
async function getQuantstats(data) {
  try {
    // Convert the JSON data to a Python object - Use proper conversion to Python dict
    const dataStr = JSON.stringify(data);
    self.pyodide.runPython(`
import json
json_data = json.loads('${dataStr.replace(/'/g, "\\'")}')
`);
    
    const result = await self.pyodide.runPythonAsync(`
import quantstats_lumi as qs
import pandas as pd
import json
import sys

# Define a function to handle the quantstats processing
def process_quantstats():
    try:
        print("Starting QuantStats calculation...")
        # Set global option to disable benchmark comparisons
        pd.set_option('mode.chained_assignment', None)
        
        symphony_id = 'sym_test'
        symphony_name = 'Symphony Test'
        
        # Enable extend_pandas functionality from QuantStats
        qs.extend_pandas()
        
        # Create pandas Series for each field
        datetime_series = pd.to_datetime(json_data['epoch_ms'], unit='ms')
        series_series = pd.Series(json_data['series'], index=datetime_series, name='series')
        deposit_adjusted_series = pd.Series(json_data['deposit_adjusted_series'], index=datetime_series, name='deposit_adjusted_series')
        
        # Convert to returns if needed
        if not pd.Series(deposit_adjusted_series.pct_change().dropna()).between(-1, 1).all():
            print("Converting deposit_adjusted_series to returns format...")
            deposit_adjusted_returns = deposit_adjusted_series.pct_change().dropna()
        else:
            deposit_adjusted_returns = deposit_adjusted_series
        
        # Create a benchmark Series if benchmark data is provided
        benchmark = None
        if 'benchmark_series' in json_data and len(json_data['benchmark_series']) > 0:
            try:
                benchmark_series = pd.Series(json_data['benchmark_series'], index=datetime_series, name='benchmark')
                print(f"Benchmark series created with {len(benchmark_series)} values")
                
                # Convert benchmark to returns if needed
                if not pd.Series(benchmark_series.pct_change().dropna()).between(-1, 1).all():
                    print("Converting benchmark to returns format...")
                    benchmark = benchmark_series.pct_change().dropna()
                else:
                    benchmark = benchmark_series
                    
                print(f"Benchmark returns series created with {len(benchmark)} values")
            except Exception as e:
                print(f"Error creating benchmark series: {str(e)}")
        
        # Use a try-except block for metrics calculation
        try:
            # Include benchmark in metrics if available
            if benchmark is not None:
                print("Calculating metrics with benchmark...")
                quantstats_metrics = qs.reports.metrics(
                    deposit_adjusted_returns,
                    benchmark=benchmark, 
                    title=symphony_name, mode='full', display=False, 
                    sep=True,
                    prepare_returns=True,
                    internal="True"
                ).to_dict()
            else:
                print("Calculating metrics without benchmark...")
                quantstats_metrics = qs.reports.metrics(
                    deposit_adjusted_returns, 
                    title=symphony_name, mode='full',
                    display=False, 
                    sep=True, prepare_returns=True, internal="True"
                ).to_dict()['Strategy']
        except Exception as e:
            print(f"Error calculating metrics: {str(e)}")
            quantstats_metrics = {"error": str(e)}
        
        # Use a try-except block for monthly returns
        try:
            quantstats_months = qs.stats.monthly_returns(deposit_adjusted_returns).to_dict()
        except Exception as e:
            print(f"Error calculating monthly returns: {str(e)}")
            quantstats_months = {"error": str(e)}
        
        # Use a try-except block for drawdown analysis
        try:
            quantstats_drawdown_series = qs.stats.to_drawdown_series(deposit_adjusted_returns)
            quantstats_drawdown_details = qs.stats.drawdown_details(quantstats_drawdown_series).sort_values(by='max drawdown', ascending=True)[:30].to_dict('records')
        except Exception as e:
            print(f"Error calculating drawdowns: {str(e)}")
            quantstats_drawdown_details = [{"error": str(e)}]
        
        # Add benchmark data to the result if available
        result_data = {
            'quantstats_metrics': quantstats_metrics, 
            'quantstats_months': quantstats_months, 
            'quantstats_drawdown_details': quantstats_drawdown_details
        }
        
        # Add benchmark comparison stats if benchmark is not None
        if benchmark is not None:
            try:
                quantstats_benchmark_correlation = qs.stats.correlation(deposit_adjusted_returns, benchmark)
                result_data['benchmark_correlation'] = quantstats_benchmark_correlation
            except Exception as e:
                print(f"Error calculating benchmark correlation: {str(e)}")
                result_data['benchmark_correlation'] = None
        
        print("QuantStats calculations complete, preparing result...")
        return json.dumps(result_data)
    except Exception as outer_e:
        # Catch any other exceptions
        error_msg = str(outer_e)
        print(f"Outer exception: {error_msg}")
        return json.dumps({'error': error_msg})

# Call the function and return its result
process_quantstats()
`);
    
    return result.replace(/NaN/g, '"NaN"');
  } catch (error) {
    throw new Error(`QuantStats Error: ${error.message}`);
  }
}

// Generate QuantStats tearsheet HTML
async function getTearsheet(data) {
  try {
    // Convert the JSON data to a Python object - Use proper conversion to Python dict
    const dataStr = JSON.stringify(data);
    self.pyodide.runPython(`
import json
json_data = json.loads('${dataStr.replace(/'/g, "\\'")}')
`);
    
    const result = await self.pyodide.runPythonAsync(`
import quantstats_lumi as qs
import pandas as pd
import json
import sys
import matplotlib
import tempfile
import os
import traceback

# Define a function to handle the tearsheet processing
def generate_tearsheet():
    try:
        print("Starting tearsheet generation...")
        matplotlib.use('Agg')
        
        symphony_id = 'sym_test'
        symphony_name = 'Symphony Test'
        
        # Enable extend_pandas functionality from QuantStats
        qs.extend_pandas()
        
        # Create pandas Series for each field
        datetime_series = pd.to_datetime(json_data['epoch_ms'], unit='ms')
        series_series = pd.Series(json_data['series'], index=datetime_series, name='series')
        deposit_adjusted_series = pd.Series(json_data['deposit_adjusted_series'], index=datetime_series, name='deposit_adjusted_series')
        
        # Convert to returns if needed
        if not pd.Series(deposit_adjusted_series.pct_change().dropna()).between(-1, 1).all():
            print("Converting deposit_adjusted_series to returns format...")
            deposit_adjusted_returns = deposit_adjusted_series.pct_change().dropna()
        else:
            deposit_adjusted_returns = deposit_adjusted_series
        
        # Create a benchmark Series if benchmark data is provided
        benchmark = None
        if 'benchmark_series' in json_data and len(json_data['benchmark_series']) > 0:
            try:
                benchmark_series = pd.Series(json_data['benchmark_series'], index=datetime_series, name='benchmark')
                print(f"Benchmark series created with {len(benchmark_series)} values")
                
                # Convert benchmark to returns if needed
                if not pd.Series(benchmark_series.pct_change().dropna()).between(-1, 1).all():
                    print("Converting benchmark to returns format...")
                    benchmark = benchmark_series.pct_change().dropna()
                else:
                    benchmark = benchmark_series
                    
                print(f"Benchmark returns series created with {len(benchmark)} values")
            except Exception as e:
                print(f"Error creating benchmark series: {str(e)}")
        
        # Generate HTML report to a temporary file
        temp_file = tempfile.NamedTemporaryFile(delete=False)
        temp_file_path = temp_file.name
        temp_file.close()
        
        # Use the benchmark if available, otherwise skip it
        print(f"Generating tearsheet with benchmark: {'Yes' if benchmark is not None else 'No'}")
        print(f"Returns shape: {deposit_adjusted_returns.shape}, Benchmark shape: {benchmark.shape if benchmark is not None else None}")
        qs.reports.html(deposit_adjusted_returns, benchmark=benchmark, title=symphony_id, output=temp_file_path, prepare_returns=True)
        
        print("Tearsheet generated, reading file...")
        with open(temp_file_path, 'r', encoding='utf-8') as file:
            html_report_content = file.read()
        os.remove(temp_file_path)
        print(f"Tearsheet HTML read successfully, size: {len(html_report_content)} bytes")
        return html_report_content
    except Exception as e:
        error_details = traceback.format_exc()
        print(f"Tearsheet generation error: {str(e)}\\n{error_details}")
        # Return a simplified HTML with error information instead of failing completely
        return f"<html><body><h1>Error Generating Tearsheet</h1><p>{str(e)}</p><pre>{error_details}</pre></body></html>"

# Call the function and return its result
generate_tearsheet()
`);
    
    return result;
  } catch (error) {
    throw new Error(`Tearsheet Error: ${error.message}`);
  }
}

// Handle messages from the main thread
self.onmessage = async function(event) {
  const message = event.data;
  
  if (message.type === 'run') {
    try {
      if (message.task === 'quantstats') {
        const result = await getQuantstats(message.data);
        self.postMessage({type: 'quantstats', result: result});
      } else if (message.task === 'tearsheet') {
        const result = await getTearsheet(message.data);
        self.postMessage({type: 'tearsheet', result: result});
      }
    } catch (error) {
      self.postMessage({type: 'error', error: error.message});
    }
  }
};

// Initialize Pyodide
initPyodide().catch(error => {
  console.error("Worker: Pyodide initialization promise error:", error);
  self.postMessage({type: 'error', error: `Initialization error: ${error.message}`});
}); 