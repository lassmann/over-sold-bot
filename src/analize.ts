import axios from 'axios';
import { RSI, EMA, MACD } from 'technicalindicators';
import { writeFileSync } from 'fs';
import { config } from './config';

const symbols: string[] = ['BTC-USDT'];

const configIndicators = {
  rsiPeriod: 14,
  maPeriod: 50,
  volumeSmaPeriod: 20,
  oversoldThreshold: 30,
  overboughtThreshold: 70,
  buyCross: 30,
  sellCross: 70,
  macdFastPeriod: 12,
  macdSlowPeriod: 26,
  macdSignalPeriod: 9,
  divergenceLookback: 5
};

interface Candle {
  [index: number]: string; // [ts, open, high, low, close, vol, volCcy]
}

async function fetchAllCandles(symbol: string): Promise<Candle[]> {
  let allCandles: Candle[] = [];
  let before: string | undefined = undefined;
  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;

  while (true) {
    const params = new URLSearchParams({
      instId: symbol,
      bar: '4H',
      limit: '300',
    });
    if (before) {
      params.append('before', before);
    }
    const url = `https://www.okx.com/api/v5/market/candles?${params.toString()}`;
    const response = await axios.get(url);
    const newCandles: Candle[] = response.data.data;

    if (newCandles.length === 0) {
      break;
    }

    allCandles = allCandles.concat(newCandles);

    const oldestTs = parseInt(allCandles[allCandles.length - 1][0]);
    if (oldestTs < oneYearAgo) {
      break;
    }

    before = allCandles[allCandles.length - 1][0];
  }

  // Reverse to oldest first
  allCandles.reverse();

  // Filter to last year
  const startIndex = allCandles.findIndex(c => parseInt(c[0]) >= oneYearAgo);
  if (startIndex > -1) {
    allCandles = allCandles.slice(startIndex);
  }

  return allCandles;
}

async function analyzeSignals(): Promise<void> {
  console.log('Analyzing buy/sell signals and RSI behavior over the last year...');

  for (const symbol of symbols) {
    try {
      const candles: Candle[] = await fetchAllCandles(symbol);
      const closes: number[] = candles.map((candle: Candle) => parseFloat(candle[4]));
      const highs: number[] = candles.map((candle: Candle) => parseFloat(candle[2]));
      const lows: number[] = candles.map((candle: Candle) => parseFloat(candle[3]));
      const volumes: number[] = candles.map((candle: Candle) => parseFloat(candle[5]));

      const minDataRequired = Math.max(
        configIndicators.maPeriod,
        configIndicators.rsiPeriod,
        configIndicators.volumeSmaPeriod,
        configIndicators.macdSlowPeriod + configIndicators.macdSignalPeriod - 1
      ) + configIndicators.divergenceLookback;

      if (closes.length < minDataRequired) {
        console.log(`${symbol} - Not enough data for analysis.`);
        continue;
      }

      // Calculate RSI (14)
      const rsiInput = { values: closes, period: configIndicators.rsiPeriod };
      const rsiValues: number[] = RSI.calculate(rsiInput);

      // Calculate EMA (50)
      const emaInput = { values: closes, period: configIndicators.maPeriod };
      const emaValues: number[] = EMA.calculate(emaInput);

      // Calculate Volume SMA (20)
      const volumeInput = { values: volumes, period: configIndicators.volumeSmaPeriod };
      const avgVolumeValues: number[] = EMA.calculate(volumeInput); // Using EMA for consistency

      // Calculate MACD (12,26,9)
      const macdInput = {
        values: closes,
        fastPeriod: configIndicators.macdFastPeriod,
        slowPeriod: configIndicators.macdSlowPeriod,
        signalPeriod: configIndicators.macdSignalPeriod,
        SimpleMAOscillator: false,
        SimpleMASignal: false
      };
      const macdValues: any[] = MACD.calculate(macdInput);

      // Offsets for indicator starts
      const offsetRsi = configIndicators.rsiPeriod - 1;
      const offsetMa = configIndicators.maPeriod - 1;
      const offsetVol = configIndicators.volumeSmaPeriod - 1;
      const offsetMacd = configIndicators.macdSlowPeriod + configIndicators.macdSignalPeriod - 2;
      const maxOffset = Math.max(offsetRsi, offsetMa, offsetVol, offsetMacd);

      let oversoldSignals: { date: string, rsi: number, price: number }[] = [];
      let overboughtSignals: { date: string, rsi: number, price: number }[] = [];
      let buySignals: { index: number, date: string, rsi: number, price: number, ma: number, volume: number, avgVol: number, macd: number, signal: number }[] = [];
      let sellSignals: { index: number, date: string, rsi: number, price: number, ma: number, volume: number, avgVol: number, macd: number, signal: number }[] = [];
      let rises: number[] = [];
      let drops: number[] = [];
      let lastOversoldIndex: number | null = null;
      let lastOverboughtIndex: number | null = null;

      for (let i = maxOffset + configIndicators.divergenceLookback + 1; i < closes.length; i++) {
        const prevRsi = rsiValues[i - offsetRsi - 1];
        const currRsi = rsiValues[i - offsetRsi];
        const prevMa = emaValues[i - offsetMa - 1];
        const currMa = emaValues[i - offsetMa];
        const currVol = volumes[i];
        const avgVol = avgVolumeValues[i - offsetVol];
        const prevMacdObj = macdValues[i - offsetMacd - 1];
        const currMacdObj = macdValues[i - offsetMacd];
        const prevMacd = prevMacdObj.MACD;
        const currMacd = currMacdObj.MACD;
        const prevSignal = prevMacdObj.signal;
        const currSignal = currMacdObj.signal;
        const currPrice = closes[i];
        const timestamp = parseInt(candles[i][0]);
        const date = new Date(timestamp).toLocaleString('en-US', { timeZone: 'UTC' });

        // Oversold condition (RSI < 30)
        if (currRsi < configIndicators.oversoldThreshold) {
          oversoldSignals.push({ date, rsi: currRsi, price: currPrice });
        }

        // Overbought condition (RSI > 70)
        if (currRsi > configIndicators.overboughtThreshold) {
          overboughtSignals.push({ date, rsi: currRsi, price: currPrice });
        }

        // Check for bullish divergence for buy
        const priceChange = closes[i] - closes[i - configIndicators.divergenceLookback];
        const rsiChange = currRsi - rsiValues[i - offsetRsi - configIndicators.divergenceLookback];
        const bullishDivergence = priceChange < 0 && rsiChange > 0;

        // Buy signal: RSI crosses above 30, Price > EMA(50), Volume > Avg Vol(20), MACD bullish cross, Bullish divergence
        if (prevRsi < configIndicators.buyCross && currRsi >= configIndicators.buyCross) {
          if (currPrice > currMa) {
            if (currVol > avgVol) {
              if (prevMacd < prevSignal && currMacd >= currSignal) {
                if (bullishDivergence) {
                  buySignals.push({ index: i, date, rsi: currRsi, price: currPrice, ma: currMa, volume: currVol, avgVol, macd: currMacd, signal: currSignal });
                }
              }
            }
          }
        }

        // Check for bearish divergence for sell
        const bearishDivergence = priceChange > 0 && rsiChange < 0;

        // Sell signal: RSI crosses below 70, Price < EMA(50), Volume > Avg Vol(20), MACD bearish cross, Bearish divergence
        if (prevRsi > configIndicators.sellCross && currRsi <= configIndicators.sellCross) {
          if (currPrice < currMa) {
            if (currVol > avgVol) {
              if (prevMacd > prevSignal && currMacd <= currSignal) {
                if (bearishDivergence) {
                  sellSignals.push({ index: i, date, rsi: currRsi, price: currPrice, ma: currMa, volume: currVol, avgVol, macd: currMacd, signal: currSignal });
                }
              }
            }
          }
        }

        // RSI behavior analysis (overbought/oversold transitions)
        if (prevRsi < configIndicators.overboughtThreshold && currRsi >= configIndicators.overboughtThreshold) {
          if (lastOversoldIndex !== null) {
            const startPrice = closes[lastOversoldIndex];
            const endPrice = closes[i];
            const rise = (endPrice / startPrice - 1) * 100;
            rises.push(rise);
          }
          lastOverboughtIndex = i;
        }

        if (prevRsi > configIndicators.oversoldThreshold && currRsi <= configIndicators.oversoldThreshold) {
          if (lastOverboughtIndex !== null) {
            const startPrice = closes[lastOverboughtIndex];
            const endPrice = closes[i];
            const drop = (endPrice / startPrice - 1) * 100;
            drops.push(drop);
          }
          lastOversoldIndex = i;
        }
      }

      // Combine buy and sell signals for chronological order
      const allSignals = [...buySignals.map(s => ({ ...s, type: 'buy' })), ...sellSignals.map(s => ({ ...s, type: 'sell' }))];
      allSignals.sort((a, b) => a.index - b.index);

      
      // Simple backtest
      let position = false;
      let entryPrice = 0;
      let entryDate = '';
      let trades: { entryDate: string, exitDate: string, profit: number }[] = [];
      for (const signal of allSignals) {
        if (signal.type === 'buy' && !position) {
          position = true;
          entryPrice = signal.price;
          entryDate = signal.date;
        } else if (signal.type === 'sell' && position) {
          position = false;
          const profit = ((signal.price - entryPrice) / entryPrice) * 100;
          trades.push({ entryDate, exitDate: signal.date, profit });
        }
      }
      if (position) {
        const lastPrice = closes[closes.length - 1];
        const lastDate = new Date(parseInt(candles[candles.length - 1][0])).toLocaleString('en-US', { timeZone: 'UTC' });
        const profit = ((lastPrice - entryPrice) / entryPrice) * 100;
        trades.push({ entryDate, exitDate: lastDate, profit });
      }

      const totalProfit = trades.reduce((sum, t) => sum + t.profit, 0);
      const avgProfit = trades.length > 0 ? totalProfit / trades.length : 0;
      const winRate = trades.length > 0 ? (trades.filter(t => t.profit > 0).length / trades.length) * 100 : 0;

      let message = `${symbol} - Analysis (Last Year):\n`;

      // Oversold signals
      if (oversoldSignals.length > 0) {
        message += `Oversold Signals (RSI < ${configIndicators.oversoldThreshold}):\n`;
        message += oversoldSignals.map(s => `${s.date}: RSI = ${s.rsi.toFixed(2)}, Price = $${s.price.toFixed(2)}`).join('\n') + '\n';
      } else {
        message += `No oversold signals detected.\n`;
      }

      // Overbought signals
      if (overboughtSignals.length > 0) {
        message += `Overbought Signals (RSI > ${configIndicators.overboughtThreshold}):\n`;
        message += overboughtSignals.map(s => `${s.date}: RSI = ${s.rsi.toFixed(2)}, Price = $${s.price.toFixed(2)}`).join('\n') + '\n';
      } else {
        message += `No overbought signals detected.\n`;
      }

      // Buy signals
      if (buySignals.length > 0) {
        message += `Buy Signals (RSI cross above ${configIndicators.buyCross}, Price > EMA(50), Volume > Avg Vol(20), MACD Bullish Cross, Bullish Divergence):\n`;
        message += buySignals.map(s => `${s.date}: RSI = ${s.rsi.toFixed(2)}, Price = $${s.price.toFixed(2)}, EMA(50) = $${s.ma.toFixed(2)}, Volume = ${s.volume.toFixed(2)}, Avg Vol(20) = ${s.avgVol.toFixed(2)}, MACD = ${s.macd.toFixed(2)} / Signal = ${s.signal.toFixed(2)}`).join('\n') + '\n';
      } else {
        message += `No buy signals detected.\n`;
      }

      // Sell signals
      if (sellSignals.length > 0) {
        message += `Sell Signals (RSI cross below ${configIndicators.sellCross}, Price < EMA(50), Volume > Avg Vol(20), MACD Bearish Cross, Bearish Divergence):\n`;
        message += sellSignals.map(s => `${s.date}: RSI = ${s.rsi.toFixed(2)}, Price = $${s.price.toFixed(2)}, EMA(50) = $${s.ma.toFixed(2)}, Volume = ${s.volume.toFixed(2)}, Avg Vol(20) = ${s.avgVol.toFixed(2)}, MACD = ${s.macd.toFixed(2)} / Signal = ${s.signal.toFixed(2)}`).join('\n') + '\n';
      } else {
        message += `No sell signals detected.\n`;
      }

      // RSI behavior analysis
      if (rises.length > 0) {
        const avgRise = rises.reduce((a, b) => a + b, 0) / rises.length;
        message += `Average rise to overbought (from previous oversold): ${avgRise.toFixed(2)}% (${rises.length} instances)\n`;
      } else {
        message += `No rises to overbought detected.\n`;
      }

      if (drops.length > 0) {
        const avgDrop = drops.reduce((a, b) => a + b, 0) / drops.length;
        message += `Average drop to oversold (from previous overbought): ${avgDrop.toFixed(2)}% (${drops.length} instances)\n`;
      } else {
        message += `No drops to oversold detected.\n`;
      }

      // Backtest results
      message += `\nBacktest Results:\n`;
      message += `Number of Trades: ${trades.length}\n`;
      message += `Total Profit: ${totalProfit.toFixed(2)}%\n`;
      message += `Average Profit per Trade: ${avgProfit.toFixed(2)}%\n`;
      message += `Win Rate: ${winRate.toFixed(2)}%\n`;
      if (trades.length > 0) {
        message += `Trades:\n`;
        message += trades.map(t => `Buy: ${t.entryDate}, Sell: ${t.exitDate}, Profit: ${t.profit.toFixed(2)}%`).join('\n') + '\n';
      }

      console.log(message);
      writeFileSync(`${symbol}_analysis.txt`, message);

    } catch (error: any) {
      console.error(`Error for ${symbol}: ${error.message}`);
    }
  }
}

analyzeSignals().catch(err => {
  console.error('Error in execution:', err);
  process.exit(1);
});