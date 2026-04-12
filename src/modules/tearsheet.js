// Tearsheet generation logic

import { getPyodide, log } from './pyodide.js';
import { fetchBenchmarkData, alignBenchmarkData } from './benchmarkData.js';
import { getSeriesData, generateReturnsArrayFromDepositAdjustedSeries } from './dataProcessing.js';

async function getTearsheetHtml(symphony, series_data, type, backtestData) {
  // series_data is an object with the following structure
  // {
  //   "epoch_ms":[1711584000000],
  //   "series":[198.9],
  //   "deposit_adjusted_series":[200]
  // }

  series_data = getSeriesData(type, backtestData, symphony) || series_data;

  if (series_data.epoch_ms.length <= 1) {
    return {
      error: `Symphony_name:${symphony.name} Symphony_id:${symphony.id} Not enough data to calculate tearsheet report`,
    };
  }

  // For live type, we need to align epoch_ms with percentageReturns BEFORE benchmark alignment
  // because percentageReturns has one fewer element than epoch_ms (Modified Dietz starts from day 1)
  if (type === "live") {
    series_data.epoch_ms = symphony.dailyChanges.epoch_ms.slice(0, symphony.dailyChanges.percentageReturns.length);
    series_data.returns = symphony.dailyChanges.percentageReturns.map(d => d.percentChange);
  } else {
    series_data.returns = generateReturnsArrayFromDepositAdjustedSeries(series_data.deposit_adjusted_series);
  }

  // Benchmark alignment happens AFTER epoch_ms/returns alignment to ensure proper length matching
  const benchmarkData = await fetchBenchmarkData();
  
  if (benchmarkData) {
    const alignedBenchmarkSeries = alignBenchmarkData(series_data, benchmarkData);
    
    if (alignedBenchmarkSeries) {
      series_data.benchmark_series = alignedBenchmarkSeries
    }
  }

  if (type === "live") {
    // Clear benchmark for live since we're using percentageReturns not deposit_adjusted_series
    delete series_data.benchmark_series;
  }

  try {
    const pyodide = await getPyodide();
    
    pyodide.globals.set('series_data_json', JSON.stringify(series_data));
    pyodide.globals.set('symphony_id_val', symphony.id.replace(/'/g, "\\'"));
    pyodide.globals.set('symphony_name_val', `${symphony.name.replace(/'/g, "\\'")} ${type}`);

    let tearsheetHtml = await pyodide.runPythonAsync(`

        import quantstats_lumi as qs
        import pandas as pd
        import json
        import sys
        import matplotlib
        import tempfile
        import os
        import warnings

        # suppress warnings because they are very noisy
        warnings.filterwarnings("ignore")

        # Set matplotlib to use the Agg backend to avoid displaying plots this is necessary for running in a headless environment
        matplotlib.use('Agg')

        symphony_id = symphony_id_val
        symphony_name = symphony_name_val

        # Enable extend_pandas functionality from QuantStats
        qs.extend_pandas()

        # Parse the JSON data from global set value instead of embedding in template
        data = json.loads(series_data_json)


        # Create pandas Series for each field
        datetime_series = pd.to_datetime(data['epoch_ms'], unit='ms')
        # series_series = pd.Series(data['series'], index=datetime_series, name='series') # we are not using the series for now since it will include deposits and withdrawals skewing the results
        # deposit_adjusted_series = pd.Series(data['deposit_adjusted_series'], index=datetime_series, name='deposit_adjusted_series')
        returns_series = pd.Series(data['returns'], index=datetime_series, name='returns')

        # Create a benchmark Series if benchmark data is provided
        benchmark = None
        if 'benchmark_series' in data and len(data['benchmark_series']) > 0:
            benchmark_series = pd.Series(data['benchmark_series'], index=datetime_series, name='SPY')
            # Convert benchmark to returns if needed
            if not pd.Series(benchmark_series.pct_change().dropna()).between(-1, 1).all():
                benchmark = benchmark_series.pct_change().dropna()
            else:
                benchmark = benchmark_series

        # Generate HTML report to a temporary file
        temp_file = tempfile.NamedTemporaryFile(delete=False)
        temp_file_path = temp_file.name
        temp_file.close()

        qs.reports.html(returns_series, benchmark=benchmark, title=symphony_name, output=temp_file_path)
        with open(temp_file_path, 'r', encoding='utf-8') as file:
            html_report_content = file.read()
        os.remove(temp_file_path)
        html_report_content

      `);

    return tearsheetHtml;
  } catch (err) {
    console.error(err);
    return { error: "An error occurred: " + err.message };
  }
}

export { getTearsheetHtml }; 