// QuantStats generation logic

import { getPyodide } from './pyodide.js';
import { generateReturnsArrayFromDepositAdjustedSeries } from './dataProcessing.js';

async function getQuantStats(symphony, series_data, benchmarkData = null) {
  // series_data is an object with the following structure
  // {
  //   "epoch_ms":[1711584000000],
  //   "series":[198.9],
  //   "deposit_adjusted_series":[200]
  // }
  // Need at least 2 data points to calculate any returns
  if (series_data.epoch_ms.length <= 1) {
    return {
      error: `Symphony_name:${symphony.name} Symphony_id:${symphony.id} Not enough data to calculate QuantStats`,
    };
  }
  // Note: Alpha/beta can be calculated with any amount of data (5+ points recommended)
  // CAGR and other annualized metrics may fail for very short time spans - that's handled with try-catch in Python
  // series_data.returns = generateReturnsArrayFromDepositAdjustedSeries(series_data.deposit_adjusted_series);
  series_data.returns = symphony.dailyChanges.percentageReturns.map(d => d.percentChange);

  // Prepare benchmark data if provided
  const hasBenchmarks = benchmarkData && benchmarkData.SPY && benchmarkData.QQQ && benchmarkData.BIL;
  const benchmarkJson = hasBenchmarks ? JSON.stringify(benchmarkData) : 'null';

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
        benchmark_data = json.loads('''${benchmarkJson}''')

        # Create pandas Series for each field
        # Note: epoch_ms may have one more element than returns due to addTodaysChanges being called after building returns
        # So we need to ensure the datetime index matches the returns length
        all_dates = pd.to_datetime(data['epoch_ms'], unit='ms')
        returns_len = len(data['returns'])
        datetime_series = all_dates[:returns_len] if len(all_dates) > returns_len else all_dates
        # series_series = pd.Series(data['series'], index=datetime_series, name='series') # we are not using the series for now since it will include deposits and withdrawals skewing the results
        # deposit_adjusted_series = pd.Series(data['deposit_adjusted_series'], index=datetime_series, name='deposit_adjusted_series')
        returns_series = pd.Series(data['returns'], index=datetime_series, name='returns')

        # Wrap main quantstats calls in try-catch for edge cases (very short time spans, etc.)
        try:
            quantstats_metrics = qs.reports.metrics(returns_series, title=symphony_name, mode='full', display = False, sep=True, prepare_returns=False, internal="True").to_dict()['Strategy']
        except Exception as metrics_err:
            quantstats_metrics = {'error': str(metrics_err)}

        try:
            quantstats_months = qs.stats.monthly_returns(returns_series).to_dict()
        except Exception:
            quantstats_months = {}

        try:
            quantstats_drawdown_series = qs.stats.to_drawdown_series(returns_series)
            quantstats_drawdown_details = qs.stats.drawdown_details(quantstats_drawdown_series).sort_values(by='max drawdown', ascending=True)[:30].to_dict('records')
        except Exception:
            quantstats_drawdown_details = []
        # qs.reports.html(returns_series, title=symphony_id, output=f"/{symphony_id}.html") would love to get this working and maybe serve it as a blob

        # Calculate alpha/beta vs benchmarks if benchmark data is provided
        alpha_beta_results = {}
        if benchmark_data is not None:
            try:
                # Validate that benchmark data lengths match strategy returns length
                strategy_len = len(returns_series)
                spy_len = len(benchmark_data['SPY']['returns']) if benchmark_data.get('SPY') else 0
                qqq_len = len(benchmark_data['QQQ']['returns']) if benchmark_data.get('QQQ') else 0
                bil_len = len(benchmark_data['BIL']['returns']) if benchmark_data.get('BIL') else 0

                # Flag to track if we have valid benchmark series
                can_calculate = True
                spy_returns = None
                qqq_returns = None
                rf_returns = None
                calc_returns = returns_series  # The returns series to use for calculations

                # If lengths don't match, try to trim to match
                if spy_len != strategy_len or qqq_len != strategy_len or bil_len != strategy_len:
                    # Use the minimum length and trim all series
                    min_len = min(strategy_len, spy_len, qqq_len, bil_len)
                    if min_len < 5:
                        # Not enough data for meaningful alpha/beta calculation
                        alpha_beta_results['error'] = f'Insufficient aligned data: strategy={strategy_len}, spy={spy_len}, qqq={qqq_len}, bil={bil_len}'
                        can_calculate = False
                    else:
                        # Trim to match - use last N days
                        trimmed_index = datetime_series[-min_len:]
                        calc_returns = returns_series[-min_len:]
                        spy_returns = pd.Series(benchmark_data['SPY']['returns'][-min_len:], index=trimmed_index, name='SPY')
                        qqq_returns = pd.Series(benchmark_data['QQQ']['returns'][-min_len:], index=trimmed_index, name='QQQ')
                        rf_returns = pd.Series(benchmark_data['BIL']['returns'][-min_len:], index=trimmed_index, name='BIL')
                else:
                    # Lengths match, create series normally
                    spy_returns = pd.Series(benchmark_data['SPY']['returns'], index=datetime_series, name='SPY')
                    qqq_returns = pd.Series(benchmark_data['QQQ']['returns'], index=datetime_series, name='QQQ')
                    rf_returns = pd.Series(benchmark_data['BIL']['returns'], index=datetime_series, name='BIL')

                # Only calculate if we have valid benchmark data
                if can_calculate and spy_returns is not None:
                    from scipy import stats as scipy_stats

                    # Calculate annualized risk-free rate from BIL returns
                    rf_daily = float(rf_returns.mean()) if rf_returns is not None else 0.0
                    rf_annualized = rf_daily * 252  # Annualize for alpha calculation

                    # Helper function to calculate CAPM alpha/beta using linear regression
                    # CAPM: r_strategy - rf = alpha + beta * (r_benchmark - rf)
                    def calc_capm_greeks(strategy_returns, benchmark_returns, rf_daily_rate):
                        # Filter out NaN values
                        valid = ~(strategy_returns.isna() | benchmark_returns.isna())
                        if valid.sum() < 5:
                            return None, None, None

                        strat_clean = strategy_returns[valid].values
                        bench_clean = benchmark_returns[valid].values

                        # Excess returns over risk-free rate
                        strat_excess = strat_clean - rf_daily_rate
                        bench_excess = bench_clean - rf_daily_rate

                        # Linear regression: strat_excess = alpha + beta * bench_excess
                        slope, intercept, r_value, p_value, std_err = scipy_stats.linregress(bench_excess, strat_excess)

                        # slope = beta, intercept = daily alpha
                        beta = slope
                        alpha_daily = intercept
                        r_squared = r_value ** 2

                        return alpha_daily, beta, r_squared

                    # Calculate greeks vs SPY
                    try:
                        alpha_spy, beta_spy, r2_spy = calc_capm_greeks(calc_returns, spy_returns, rf_daily)
                        if alpha_spy is not None:
                            alpha_beta_results['SPY'] = {
                                'alpha': float(alpha_spy),  # Daily alpha (will be annualized in JS)
                                'beta': float(beta_spy),
                                'r_squared': float(r2_spy),
                            }
                        else:
                            alpha_beta_results['SPY'] = {'error': 'Insufficient valid data points'}
                    except Exception as spy_err:
                        alpha_beta_results['SPY'] = {'error': str(spy_err)}

                    # Calculate greeks vs QQQ
                    try:
                        alpha_qqq, beta_qqq, r2_qqq = calc_capm_greeks(calc_returns, qqq_returns, rf_daily)
                        if alpha_qqq is not None:
                            alpha_beta_results['QQQ'] = {
                                'alpha': float(alpha_qqq),  # Daily alpha (will be annualized in JS)
                                'beta': float(beta_qqq),
                                'r_squared': float(r2_qqq),
                            }
                        else:
                            alpha_beta_results['QQQ'] = {'error': 'Insufficient valid data points'}
                    except Exception as qqq_err:
                        alpha_beta_results['QQQ'] = {'error': str(qqq_err)}

            except Exception as e:
                alpha_beta_results['error'] = str(e)

        json.dumps({
            'quantstats_metrics': quantstats_metrics,
            'quantstats_months': quantstats_months,
            'quantstats_drawdown_details': quantstats_drawdown_details,
            'alpha_beta': alpha_beta_results
        })

      `);

    return output.replace(/NaN/g, '"NaN"');
  } catch (err) {
    console.error(err);
    return { error: "An error occurred: " + err.message };
  }
}

export { getQuantStats }; 