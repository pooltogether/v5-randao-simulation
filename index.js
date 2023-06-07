(async () => {
  const axios = require("axios");
  const fs = require("fs").promises;
  const path = require("path");
  const process = require("process");
  const { authenticate } = require("@google-cloud/local-auth");
  const { google } = require("googleapis");

  const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

  // The file token.json stores the user's access and refresh tokens, and is
  // created automatically when the authorization flow completes for the first
  // time.
  const TOKEN_PATH = path.join(process.cwd(), "token.json");
  const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");

  /**
   * Reads previously authorized credentials from the save file.
   *
   * @return {Promise<OAuth2Client|null>}
   */
  async function loadSavedCredentialsIfExist() {
    try {
      const content = await fs.readFile(TOKEN_PATH);
      const credentials = JSON.parse(content);
      return google.auth.fromJSON(credentials);
    } catch (err) {
      return null;
    }
  }

  /**
   * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
   *
   * @param {OAuth2Client} client
   * @return {Promise<void>}
   */
  async function saveCredentials(client) {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
      type: "authorized_user",
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(TOKEN_PATH, payload);
  }

  // Load or request authorization to call APIs.
  async function authorize() {
    let client = await loadSavedCredentialsIfExist();
    if (client) {
      return client;
    }
    client = await authenticate({
      scopes: SCOPES,
      keyfilePath: CREDENTIALS_PATH,
    });
    if (client.credentials) {
      await saveCredentials(client);
    }
    return client;
  }

  function transposeArray(array) {
    return array[0].map((_, colIndex) => array.map((row) => row[colIndex]));
  }

  // const etherScanApiKey = process.env['ETHERSCAN_API_KEY'];

  async function getValidatorPools() {
    const networkPenetration = [];
    const poolName = [];

    await axios
      .get("https://api.rated.network/v0/eth/operators?window=1d&idType=pool", {
        headers: {
          accept: "application/json",
          "X-Rated-Network": "mainnet",
          Authorization: `Bearer ${process.env["RATED_API_BEARER_TOKEN"]}`,
        },
      })
      .then(({ data }) => {
        data.data.forEach((pool) => {
          poolName.push(pool.id);
          networkPenetration.push(pool.networkPenetration);
        });
      })
      .catch((error) => {
        throw Error(`Failed to retrieve validator pools: ${error}`);
      });

    return [poolName.reverse(), networkPenetration.reverse()];
  }

  function binomialCoefficient(n, k) {
    if (k > n || k < 0) {
      return 0;
    }

    if (k === 0 || k === n) {
      return 1;
    }

    let coefficient = 1;

    for (let i = 1; i <= k; i++) {
      coefficient *= (n - i + 1) / i;
    }

    return coefficient;
  }

  function calculateC(n, k, x) {
    // Trivial case when n < k or x < k = n
    if (n < k || (x < k && k === n)) {
      return 0;
    }

    if (k <= x) {
      // Trivial case when k = n <= x
      if (k === n) {
        return 1;
      }

      // Trivial case when k < n and k <= x
      if (k < n) {
        return binomialCoefficient(n, k);
      }
    }

    // General case when x < k < n
    if (x < k && k < n) {
      let sum = 0;

      for (let j = 0; j <= x; j++) {
        sum += calculateC(n - 1 - j, k - j, x);
      }

      return sum;
    }

    return 0;
  }

  // Function to calculate the cumulative distribution function (cdf)
  function calculateCDF(n, p) {
    const cdf = [];

    // Calculate the summation ∑_{k=0}^n
    for (let x = 0; x <= n; x++) {
      let cumulativeProbability = 0;

      // Calculate the summation ∑_{k=0}^n C_n^k(x) * p^k * q^(n - k)
      for (let k = 0; k <= n; k++) {
        // Calculate C_n^k(x)
        const cnk = calculateC(n, k, x);

        // Accumulate the terms C_n^k(x) * p^k * q^(n - k)
        cumulativeProbability += cnk * Math.pow(p, k) * Math.pow(1 - p, n - k);
      }

      cdf.push(cumulativeProbability);
    }

    return cdf;
  }

  // Function to calculate the probability mass function (pmf)
  function calculatePMF(n, p) {
    const cdf = calculateCDF(n, p);
    const pmf = [];

    // Calculate the pmf for i = 0 separately
    pmf[0] = cdf[0];

    // Calculate the pmf for i > 0
    for (let i = 1; i < cdf.length; i++) {
      const pmfValue = cdf[i] - cdf[i - 1];

      pmf[i] = pmfValue;
    }

    return pmf;
  }

  // Simulate the validator selection process using Monte Carlo method
  function simulateValidatorSelection(rValues, numEpochs) {
    const results = [];

    // Iterate over different r values
    for (const r of rValues) {
      const n = 32;
      const pmfSum = Array.from({ length: n + 1 }, () => 0);

      // Calculate K[e_j,p_i] based on the r value
      const pmf = calculatePMF(n, r);

      // Accumulate the pmf[k] values for each k
      for (let k = 0; k <= n; k++) {
        // Simulate numEpochs epochs
        for (let j = 0; j < numEpochs; j++) {
          // Generate a random number between 0 and 1 that simulates a coin toss
          const randomNum = Math.random();

          if (randomNum <= pmf[k]) {
            pmfSum[k] += 1; // Increase the count for k-blocktuple value if the coin toss is lower than the probability
          }
        }
      }

      // Calculate the average probability per k value
      const avgProbability = pmfSum.map((sum) => sum / numEpochs);

      // Store the results for the current r value
      results.push({ r, avgProbability });
    }

    return results;
  }

  function getMedian(array) {
    const sortedArray = array.sort((a, b) => a - b);
    const length = sortedArray.length;

    let median;

    if (length % 2 === 1) {
      median = sortedArray[Math.floor(length / 2)];
    } else {
      const middleIndex = length / 2;
      median = (sortedArray[middleIndex - 1] + sortedArray[middleIndex]) / 2;
    }

    return median;
  }

  function getDoubleArrayMedian(doubleArray) {
    const nestedArrayToSort = Array.from({ length: doubleArray.length }, () => []);

    doubleArray.forEach((nestedArray, index) => {
      nestedArray.forEach((value) => {
        nestedArrayToSort[index].push(value);
      });
    });

    const nestedArraySorted = nestedArrayToSort.map((array, index) => {
      return array.sort((a, b) => a - b);
    });

    return nestedArraySorted.map(array => {
      return getMedian(array);
    });
  }

  // Simulate the expected number of Nk for various values of r and k using the Monte Carlo method
  function simulateExpectedNK(numSimulation, rValues, numEpochs, targetEpoch = null, targetSlot = false) {
    const results = [];
    const n = 32;

    // n + 1 cause we also store 0 nK-blocktuples
    const nKBlocktuples = Array.from({ length: n + 1 }, () =>
      Array.from({ length: numSimulation }, () => 0),
    );

    const targetSlotBlocktuple = Array.from({ length: numSimulation }, () => 0);

    const nkValues = Array.from({ length: numSimulation }, () =>
      Array.from({ length: numEpochs }, () => Array.from({ length: n }, () => 0)),
    );

    let targetSlotConsecutiveCount = 0;
    let targetEpochSlots = Array.from({ length: n }, () => 0);

    // Iterate over different r values
    for (const r of rValues) {
      // Run simulation for i numSimulation
      for (let i = 0; i < numSimulation; i++) {
        // Simulate epoch for j numEpochs
        for (let j = 0; j < numEpochs; j++) {

          // We randomize the target slot since the random number may be requested at any time in the epoch
          if (targetSlot || targetSlot === 0) {
            targetSlot = Math.floor(Math.random() * n);
          }

          // We toss a coin for each slot
          for (let k = 0; k < n; k++) {
            // Generate a random number between 0 and 1 for each coin toss
            const randomNum = Math.random();

            // Probability of head is equal to the validator pool stake
            if (randomNum <= r) {
              nkValues[i][j][k] = 1; // Count as a successful event if the random number is lower than the probability
            }

            // We exit the loop if we have reached the target slot of the target epoch
            if (targetSlot && j === numEpochs - 1 && k === targetSlot - 1) {
              break;
            }
          }

          countConsecutiveKBlocktuples(nkValues[i][j], i, j);
        }
      }

      function countConsecutiveKBlocktuples(epoch, numSimulation, epochNumber) {
        let consecutiveCount = 0;

        for (let index = 0; index < epoch.length; index++) {
          const slot = epoch[index];

          // We exit the loop if this is not the target epoch
          if (targetEpoch !== null && epochNumber !== targetEpoch - 1) {
            break;
          }

          if (slot === 1) {
            consecutiveCount++;
          } else if (consecutiveCount !== 0) { // We don't track 0 k blocktuples
            nKBlocktuples[consecutiveCount][numSimulation] += 1;

            // Reset the count
            consecutiveCount = 0;
          }

          // We have reached the target epoch
          if (targetEpoch !== null && epochNumber === targetEpoch - 1) {

            if (slot === 1) {
              targetEpochSlots[index] += 1;

              if (targetSlot && index === targetSlot - 1) {
                targetSlotBlocktuple[numSimulation] += 1;

                // We exit the loop when we reach the target slot for the target epoch
                break;
              }
            }
          }
        }
      }

      const medianNKBlocktuples = getDoubleArrayMedian(nKBlocktuples);
      const oddsNKBlocktuples = medianNKBlocktuples.map((sum) => sum / (numEpochs * n));

      const medianTargetSlotBlocktuple = getMedian(targetSlotBlocktuple);

      // Store the results for the current r value
      if (targetSlot) {
        results.push({ r, medianNKBlocktuples, oddsNKBlocktuples, medianTargetSlotBlocktuple });
      } else {
        results.push({ r, medianNKBlocktuples, oddsNKBlocktuples });
      }
    }

    return results;
  }

  // Calculate the probabilities of achieving consecutive blocktuples in each epoch
  function calculateEpochProbabilities(targetEpoch, targetSlot, p) {
    const epochProbabilities = [];
    const n = 32;
    let x = n;

    // Iterate over the epochs
    for (let epoch = 1; epoch <= targetEpoch; epoch++) {
      // Calculate the desired position before the target slot in this epoch

      // For each epoch, we consider the entire 32 slots
      // except for the targetEpoch for which we will consider x up to the targetSlot
      if (epoch === targetEpoch) {
        x = targetSlot;
      }

      // Calculate the cumulative distribution function (cdf) for this epoch
      const cdf = calculateCDF(n, p);

      // Calculate the probability of achieving consecutive blocktuples before the target slot in this epoch
      const epochProbability = cdf[x];

      // Store the probability for this epoch
      epochProbabilities.push(epochProbability);
    }

    return epochProbabilities;
  }

  async function setValues(auth) {
    const sheet = google.sheets({ version: "v4", auth }).spreadsheets.values;
    const spreadsheetId = process.env["SPREADSHEET_ID"];

    const validatorPools = transposeArray(await getValidatorPools());
    const lidoRStake = [validatorPools[validatorPools.length - 1]][0][1];

    const lidoPMF = calculatePMF(32, lidoRStake);
    const lidoSimulation = simulateValidatorSelection([lidoRStake], 1000000)[0].avgProbability;

    const kBlocktuples = Array.from({ length: 33 }, (_, index) => index);
    const pmfValues = transposeArray([kBlocktuples, lidoPMF, lidoSimulation]);

    const expectedDailyNKBlocktuples = simulateExpectedNK(50000, [lidoRStake], 225);
    const lidoExpectedDailyNKBlocktuples = transposeArray([
      expectedDailyNKBlocktuples[0].medianNKBlocktuples,
    ]);

    const lidoExpectedDailyOddsNKBlocktuples = transposeArray([
      expectedDailyNKBlocktuples[0].oddsNKBlocktuples,
    ]);

    const expectedTargetEpochNKBlocktuples = simulateExpectedNK(50000, [lidoRStake], 225, 225, true);
    const lidoExpectedTargetEpochNKBlocktuples = transposeArray([
      expectedTargetEpochNKBlocktuples[0].medianNKBlocktuples,
    ]);

    const lidoExpectedTargetEpochOddsNKBlocktuples = transposeArray([
      expectedTargetEpochNKBlocktuples[0].oddsNKBlocktuples,
    ]);

    const lidoExpectedAvgTargetSlotBlocktuple =
      transposeArray([[expectedTargetEpochNKBlocktuples[0].averageTargetSlotBlocktuple]]);

    sheet.update({
      spreadsheetId,
      range: "A36",
      valueInputOption: "USER_ENTERED",
      resource: {
        values: validatorPools,
      },
    });

    sheet.update({
      spreadsheetId,
      range: "A53",
      valueInputOption: "USER_ENTERED",
      resource: {
        values: pmfValues,
      },
    });

    sheet.update({
      spreadsheetId,
      range: "D53",
      valueInputOption: "USER_ENTERED",
      resource: {
        values: lidoExpectedDailyNKBlocktuples,
      },
    });

    sheet.update({
      spreadsheetId,
      range: "E53",
      valueInputOption: "USER_ENTERED",
      resource: {
        values: lidoExpectedDailyOddsNKBlocktuples,
      },
    });

    sheet.update({
      spreadsheetId,
      range: "F53",
      valueInputOption: "USER_ENTERED",
      resource: {
        values: lidoExpectedTargetEpochNKBlocktuples,
      },
    });

    sheet.update({
      spreadsheetId,
      range: "G53",
      valueInputOption: "USER_ENTERED",
      resource: {
        values: lidoExpectedTargetEpochOddsNKBlocktuples,
      },
    });

    sheet.update({
      spreadsheetId,
      range: "H53",
      valueInputOption: "USER_ENTERED",
      resource: {
        values: lidoExpectedAvgTargetSlotBlocktuple,
      },
    });
  }

  await authorize().then(setValues).catch(console.error);
})();
