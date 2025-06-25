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

  const benchmarkData = await fetchBenchmarkData();
  
  if (benchmarkData) {
    // Align benchmark data with strategy data
    const alignedBenchmarkSeries = alignBenchmarkData(series_data, benchmarkData);
    
    if (alignedBenchmarkSeries) {
      // If benchmark alignment succeeded
      series_data.benchmark_series = alignedBenchmarkSeries
    }
  }

  if (series_data.epoch_ms.length <= 1) {
    return {
      error: `Symphony_name:${symphony.name} Symphony_id:${symphony.id} Not enough data to calculate tearsheet report`,
    };
  }
  if (type === "live") {
    // when using live data we need to adjust for deposits and withdrawals
    // this is done in the liveSymphonyPerformance.js file
    series_data.returns = symphony.dailyChanges.percentageReturns.map(d => d.percentChange);
  } else {
    series_data.returns = generateReturnsArrayFromDepositAdjustedSeries(series_data.deposit_adjusted_series);
  }

  const pyodide = await getPyodide();
  try {
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

        symphony_id = '${symphony.id.replace(/'/g, "\\'")}'
        symphony_name = '${symphony.name.replace(/'/g, "\\'")} ${type}'

        # Enable extend_pandas functionality from QuantStats
        qs.extend_pandas()

        # Parse the JSON data
        data = json.loads('''${JSON.stringify(series_data)}''')


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