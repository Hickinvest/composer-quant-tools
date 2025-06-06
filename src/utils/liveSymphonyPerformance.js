import { log } from "./logger.js";

function isWithinPercentageRange(
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

function getDeploysForSymphony(symphony, accountDeploys) {
  return accountDeploys
    .filter((deploy) => deploy.symphony_id === symphony.id)
    .reduce((acc, deploy) => {
      acc[new Date(deploy.created_at).toDateString()] = deploy;
      return acc;
    }, {});
}

function buildReturnsArray(
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

function addTodaysChanges(symphony) {
  symphony.dailyChanges.series.push(symphony.value);
  symphony.dailyChanges.deposit_adjusted_series.push(
    symphony.deposit_adjusted_value,
  );
  symphony.dailyChanges.epoch_ms.push(Date.now());
}

function buildSymphonyPercentages(symphony, symphonyDeploys) {
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

function calculateAverageAndMedian(data) {
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
