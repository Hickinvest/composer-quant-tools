import { log } from "./logger.js";

export function isWithinPercentageRange(
  numberToCheck,
  previousValue,
  valueChange,
  percentageRange = 5,
) {
  // Calculate the allowed range
  const valueChangeLowerBound = Math.abs(
    valueChange * (1 - percentageRange / 100),
  );
  const valueChangeUpperBound = Math.abs(
    valueChange * (1 + percentageRange / 100),
  );

  // Calculate the actual change
  const actualChange = Math.abs(numberToCheck - previousValue);

  // Check if numberToCheck is within the range
  const isWithinRange =
    actualChange >= valueChangeLowerBound &&
    actualChange <= valueChangeUpperBound;

  return isWithinRange;
}

export function getDeploysForSymphony(symphony, accountDeploys) {
  return accountDeploys
    .filter((deploy) => deploy.symphony_id === symphony.id)
    .reduce((acc, deploy) => {
      acc[new Date(deploy.created_at).toDateString()] = deploy;
      return acc;
    }, {});
}

export function buildReturnsArray(
  dailyChanges,
  symphonyDeploys,
  currentValue,
  calculationKey = "deposit_adjusted_series" /*['series', 'deposit_adjusted_series']*/,
) {
  let deploymentIndexToAccountFor = 0;
  const sortedDeployments = Object.values(symphonyDeploys).sort((a, b) =>
    new Date(a.created_at) < new Date(b.created_at) ? -1 : 1,
  );

  return dailyChanges.epoch_ms.reduce((acc, change, index) => {
    const dateString = new Date(change).toDateString();
    if (index === 0) {
      const firstDeployAmount = sortedDeployments?.[0]?.cash_change || 0;
      if (firstDeployAmount === 0) {
        log("No deploy amount found for symphony");
      }
      deploymentIndexToAccountFor++;
      if (firstDeployAmount !== 0) {
        acc.push({
          dateString,
          percentChange:
            (dailyChanges[calculationKey][index] - firstDeployAmount) /
            firstDeployAmount,
        });
      }
    } else if (
      calculationKey === "series" &&
      sortedDeployments[deploymentIndexToAccountFor] &&
      isWithinPercentageRange(
        dailyChanges[calculationKey][index],
        dailyChanges[calculationKey][index - 1],
        sortedDeployments[deploymentIndexToAccountFor].cash_change,
      )
    ) {
      const currentDayDeployAmount =
        sortedDeployments[deploymentIndexToAccountFor].cash_change;
      const lastDayAmount =
        dailyChanges[calculationKey][index - 1] + currentDayDeployAmount;
      if (lastDayAmount !== 0) {
        acc.push({
          dateString,
          percentChange:
            (dailyChanges[calculationKey][index] - lastDayAmount) /
            lastDayAmount,
        });
      }
      deploymentIndexToAccountFor++;
    } else {
      const prevValue = dailyChanges[calculationKey][index - 1];
      if (prevValue !== 0) {
        acc.push({
          dateString,
          percentChange:
            (dailyChanges[calculationKey][index] - prevValue) / prevValue,
        });
      }
    }

    if (
      dailyChanges.epoch_ms.length - 1 === index && // last day
      new Date(dailyChanges.epoch_ms).toDateString() !==
        new Date().toDateString() // last day is not today
    ) {
      const lastValue = dailyChanges.series[index];
      if (lastValue !== 0) {
        acc.push({
          dateString: new Date().toDateString(),
          percentChange: (currentValue - lastValue) / lastValue,
        });
      }
    }
    return acc;
  }, []);
}

export function addTodaysChanges(symphony) {
  symphony.dailyChanges.series.push(symphony.value);
  symphony.dailyChanges.deposit_adjusted_series.push(
    symphony.deposit_adjusted_value,
  );
  symphony.dailyChanges.epoch_ms.push(Date.now());
}

export function buildSymphonyPercentages(symphony, symphonyDeploys) {
  symphony.dailyChanges.percentageReturns = buildReturnsArray(
    symphony.dailyChanges,
    symphonyDeploys,
    symphony.value,
  );
  addTodaysChanges(symphony);
}

export async function addQuantstatsToSymphony(symphony, accountDeploys) {
  //create a promise that resolves when the stats are added
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: "getQuantStats", symphony, accountDeploys },
      (response) => {
        if (response?.error) {
          log(response?.error);
          reject(response.error);
        } else {
          symphony.quantstats = JSON.parse(response || "{}");
          symphony.addedStats = {
            ...symphony.addedStats,
            ...symphony.quantstats.quantstats_metrics,
          };
          resolve(symphony);
        }
      },
    );
  });
}

export function calculateAverageAndMedian(data) {
  // Extract percent changes and filter out invalid values
  let percentChanges = data
    .map((entry) => entry.percentChange)
    .filter(
      (value) =>
        typeof value === "number" &&
        isFinite(value) &&
        !isNaN(value),
    );

  if (percentChanges.length === 0) {
    return { average: 0, median: 0 };
  }

  // Calculate the sum of percent changes
  let sum = percentChanges.reduce((acc, value) => acc + value, 0);

  // Calculate the average (mean)
  let average = sum / percentChanges.length;

  // Sort the percent changes for median calculation
  percentChanges.sort((a, b) => a - b);

  // Calculate the median
  let middle = Math.floor(percentChanges.length / 2);
  let median =
    percentChanges.length % 2 === 0
      ? (percentChanges[middle - 1] + percentChanges[middle]) / 2
      : percentChanges[middle];

  return { average, median };
}

export function addGeneratedSymphonyStatsToSymphony(symphony, accountDeploys) {
  const symphonyDeploys = getDeploysForSymphony(symphony, accountDeploys);
  buildSymphonyPercentages(symphony, symphonyDeploys);

  const { average, median } = calculateAverageAndMedian(
    symphony.dailyChanges.percentageReturns,
  );

  symphony.addedStats = {
    ...symphony.addedStats,
    "Running Days": symphony.dailyChanges.percentageReturns.length,
    "Avg. Daily Return": (average * 100).toFixed(3) + "%",
    "Median Daily Return": (median * 100).toFixed(3) + "%",
  };
}

export function getCashFlowsForSymphony(symphony, symphonyActivityHistory) {
  if (!symphonyActivityHistory?.data) {
    return [];
  }

  return symphonyActivityHistory.data
    .filter(activity => 
      activity.symphony_id === symphony.id && 
      activity.cash_change !== null && 
      activity.cash_change !== undefined &&
      activity.type === "cash_adjustment_performed"
    )
    .map(activity => ({
      amount: activity.cash_change,
      date: new Date(activity.at),
      type: activity.type
    }))
    .sort((a, b) => a.date - b.date);
}

export function calculateModifiedDietzReturn(bmv, emv, cashFlows, periodStart, periodEnd) {
  // Filter cash flows that occurred during the period
  const periodCashFlows = cashFlows.filter(cf => 
    cf.date >= periodStart && cf.date <= periodEnd
  );

  if (periodCashFlows.length === 0) {
    // No cash flows, use simple return
    return bmv !== 0 ? (emv - bmv) / bmv : 0;
  }

  // Calculate total cash flows
  const totalCashFlows = periodCashFlows.reduce((sum, cf) => sum + cf.amount, 0);
  
  // Calculate weighted cash flows
  const totalDays = (periodEnd - periodStart) / (1000 * 60 * 60 * 24); // Convert to days
  const weightedCashFlows = periodCashFlows.reduce((sum, cf) => {
    const daysFromStart = (cf.date - periodStart) / (1000 * 60 * 60 * 24);
    const weight = (totalDays - daysFromStart) / totalDays;
    return sum + (cf.amount * weight);
  }, 0);

  // Modified Dietz formula: (EMV - BMV - ∑CF) / (BMV + ∑(CF × w))
  const denominator = bmv + weightedCashFlows;
  return denominator !== 0 ? (emv - bmv - totalCashFlows) / denominator : 0;
}

export function buildReturnsArrayWithModifiedDietz(
  dailyChanges,
  cashFlows,
  currentValue,
  calculationKey = "series"
) {

  const returns = dailyChanges.epoch_ms.reduce((acc, change, index) => {
    const dateString = new Date(change).toDateString();
    const currentValue = dailyChanges[calculationKey][index];
    
    if (index === 0) {
      // First day - no return to calculate
      return acc;
    }

    const previousValue = dailyChanges[calculationKey][index - 1];
    const periodStart = new Date(dailyChanges.epoch_ms[index - 1]);
    const periodEnd = new Date(change);

    const dailyReturn = calculateModifiedDietzReturn(
      previousValue,
      currentValue,
      cashFlows,
      periodStart,
      periodEnd
    );

    acc.push({
      dateString,
      percentChange: dailyReturn
    });

    // Only add today's return if this is the last day and it's not today
    // AND if the last day is not today
    const lastDayDate = new Date(change);
    const todayDate = new Date();
    const isLastDay = index === dailyChanges.epoch_ms.length - 1;
    const isLastDayToday = lastDayDate.toDateString() === todayDate.toDateString();
    
    if (isLastDay && !isLastDayToday) {
      const todayStart = new Date(change);
      const todayEnd = new Date();
      
      const todayReturn = calculateModifiedDietzReturn(
        currentValue,
        currentValue, // Use currentValue as both start and end for today
        cashFlows,
        todayStart,
        todayEnd
      );

      acc.push({
        dateString: new Date().toDateString(),
        percentChange: todayReturn
      });
    }

    return acc;
  }, []);

  // add the first day's returns
  returns.unshift({
    dateString: (new Date(dailyChanges.epoch_ms[0])).toDateString(),
    percentChange: 0
  });

  return returns;
}

export function buildSymphonyPercentagesWithModifiedDietz(symphony, symphonyActivityHistory) {
  const cashFlows = getCashFlowsForSymphony(symphony,symphonyActivityHistory);

  symphony.dailyChanges.percentageReturns = buildReturnsArrayWithModifiedDietz(
    symphony.dailyChanges,
    cashFlows,
    symphony.value,
    "series"
  );
  addTodaysChanges(symphony);
}

export function addGeneratedSymphonyStatsToSymphonyWithModifiedDietz(symphony, symphonyActivityHistory) {
  buildSymphonyPercentagesWithModifiedDietz(symphony, symphonyActivityHistory);

  const { average, median } = calculateAverageAndMedian(
    symphony.dailyChanges.percentageReturns,
  );

  // Calculate actual P/L from current value vs initial deposit
  // Use deposit_adjusted_series[0] as net deposits (initial value)
  const netDeposits = symphony.dailyChanges?.deposit_adjusted_series?.[0] || 0;
  const currentValue = symphony.value || 0;
  const plDollar = currentValue - netDeposits;
  const plPercent = netDeposits > 0 ? ((currentValue - netDeposits) / netDeposits) * 100 : 0;

  symphony.addedStats = {
    ...symphony.addedStats,
    "Running Days": symphony.dailyChanges.percentageReturns.length,
    "Avg. Daily Return": (average * 100).toFixed(3) + "%",
    "Median Daily Return": (median * 100).toFixed(3) + "%",
    "Actual P/L $": (plDollar >= 0 ? "+$" : "-$") + Math.abs(plDollar).toFixed(2),
    "Actual P/L %": (plPercent >= 0 ? "+" : "") + plPercent.toFixed(2) + "%",
  };
}
