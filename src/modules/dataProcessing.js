// Functions to process data series and returns

// Generate returns array from deposit adjusted series
function generateReturnsArrayFromDepositAdjustedSeries(deposit_adjusted_series) {
  let previousValue = deposit_adjusted_series[0];
  return deposit_adjusted_series.map((point) => {
    const thisValue = (point - previousValue) / previousValue;
    previousValue = point;
    return thisValue;
  });
}

// Extract series data based on type
function getSeriesData(type, backtestData, symphony) {
  let series_data = { deposit_adjusted_series: [], epoch_ms: [] };
  if (type === "backtest") {
    Object.entries(backtestData.dvm_capital[symphony.id]).forEach(
      ([day, amount]) => {
        series_data.epoch_ms.push(day * 24 * 60 * 60 * 1000);
        series_data.deposit_adjusted_series.push(amount);
      },
    );
  } else if (type === "oos") {
    const oosStartDate = new Date(
      symphony.last_semantic_update_at.split("[")[0],
    ); // this is removing the timezone
    Object.entries(backtestData.dvm_capital[symphony.id]).forEach(
      ([day, amount]) => {
        if (oosStartDate >= new Date(day * 24 * 60 * 60 * 1000)) {
          return;
        }
        series_data.epoch_ms.push(day * 24 * 60 * 60 * 1000);
        series_data.deposit_adjusted_series.push(amount);
      },
    );
  }
  return (type === "backtest" || type === "oos") ? series_data : undefined;
}

export { generateReturnsArrayFromDepositAdjustedSeries, getSeriesData }; 