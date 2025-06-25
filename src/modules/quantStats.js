// QuantStats generation logic

import { getPyodide } from './pyodide.js';
import { generateReturnsArrayFromDepositAdjustedSeries } from './dataProcessing.js';

async function getQuantStats(symphony, series_data) {
  // series_data is an object with the following structure
  // {
  //   "epoch_ms":[1711584000000],
  //   "series":[198.9],
  //   "deposit_adjusted_series":[200]
  // }
  if (series_data.epoch_ms.length <= 1) {
    return {
      error: `Symphony_name:${symphony.name} Symphony_id:${symphony.id} Not enough data to calculate QuantStats`,
    };
  }
  // series_data.returns = generateReturnsArrayFromDepositAdjustedSeries(series_data.deposit_adjusted_series);
  series_data.returns = symphony.dailyChanges.percentageReturns;

  const pyodide = await getPyodide();
  try {
    let output = await pyodide.runPythonAsync(`

        import quantstats_lumi as qs
        import pandas as pd
        import json
        import warnings

        # suppress warnings because they are very noisy
        warnings.filterwarnings("ignore")

        symphony_id = '${symphony.id.replace(/'/g, "\\'")}'
        symphony_name = '${symphony.name.replace(/'/g, "\\'")}'

        # Enable extend_pandas functionality from QuantStats
        qs.extend_pandas()

        # Parse the JSON data
        data = json.loads('''${JSON.stringify(series_data)}''')


        # Create pandas Series for each field
        datetime_series = pd.to_datetime(data['epoch_ms'], unit='ms')
        # series_series = pd.Series(data['series'], index=datetime_series, name='series') # we are not using the series for now since it will include deposits and withdrawals skewing the results
        # deposit_adjusted_series = pd.Series(data['deposit_adjusted_series'], index=datetime_series, name='deposit_adjusted_series')
        returns_series = pd.Series(data['returns'], index=datetime_series, name='returns')

        quantstats_metrics = qs.reports.metrics(returns_series, title=symphony_name, mode='full', display = False, sep=True, prepare_returns=False, internal="True").to_dict()['Strategy']
        quantstats_months = qs.stats.monthly_returns(returns_series).to_dict()
        quantstats_drawdown_series = qs.stats.to_drawdown_series(returns_series)
        quantstats_drawdown_details = qs.stats.drawdown_details(quantstats_drawdown_series).sort_values(by='max drawdown', ascending=True)[:30].to_dict('records')
        # qs.reports.html(returns_series, title=symphony_id, output=f"/{symphony_id}.html") would love to get this working and maybe serve it as a blob

        json.dumps({'quantstats_metrics':quantstats_metrics, 'quantstats_months':quantstats_months, 'quantstats_drawdown_details': quantstats_drawdown_details})

      `);

    return output.replace(/NaN/g, '"NaN"');
  } catch (err) {
    console.error(err);
    return { error: "An error occurred: " + err.message };
  }
}

export { getQuantStats }; 