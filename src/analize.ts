import axios from 'axios';
import { RSI, SMA } from 'technicalindicators';
import TelegramBot from 'node-telegram-bot-api';
import { config } from './config';

const bot = new TelegramBot(config.telegramBotToken);
const symbols: string[] = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'SUI-USDT', 'XRP-USDT', 'BNB-USDT'];

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

async function analyzeBuySignals(): Promise<void> {
  console.log('Analyzing buy signals and RSI behavior over the last year...');

  for (const symbol of symbols) {
    try {
      const candles: Candle[] = await fetchAllCandles(symbol);
      const closes: number[] = candles.map((candle: Candle) => parseFloat(candle[4]));
      const volumes: number[] = candles.map((candle: Candle) => parseFloat(candle[5]));

      if (closes.length < 50) {
        console.log(`${symbol} - Not enough data for analysis.`);
        continue;
      }

      // Calcular RSI (14)
      const rsiInput = { values: closes, period: 14 };
      const rsiValues: number[] = RSI.calculate(rsiInput);

      // Calcular Media Móvil (50)
      const smaInput = { values: closes, period: 50 };
      const smaValues: number[] = SMA.calculate(smaInput);

      // Calcular Volumen Promedio (20)
      const volumeInput = { values: volumes, period: 20 };
      const avgVolumeValues: number[] = SMA.calculate(volumeInput);

      let oversoldSignals: string[] = [];
      let buySignals: string[] = [];
      let rises: number[] = [];
      let drops: number[] = [];
      let lastOversoldIndex: number | null = null;
      let lastOverboughtIndex: number | null = null;

      for (let k = 1; k < rsiValues.length; k++) {
        const prevRsi = rsiValues[k - 1];
        const currRsi = rsiValues[k];
        const currIndex = k + 14; // Ajustar índice por el período del RSI

        // RSI < 29.5 (Oversold condition)
        if (currRsi < 29.5) {
          const timestamp = parseInt(candles[currIndex][0]);
          const date = new Date(timestamp).toLocaleString('en-US', { timeZone: 'UTC' });
          oversoldSignals.push(`${date}: RSI = ${currRsi.toFixed(2)}, Price = $${closes[currIndex].toFixed(2)}`);
        }

        // Buy signal: RSI crosses above 30, Price > SMA(50), Volume > Avg Volume(20)
        if (prevRsi < 30 && currRsi >= 30) {
          if (smaValues[k] && closes[currIndex] > smaValues[k]) {
            if (avgVolumeValues[k] && volumes[currIndex] > avgVolumeValues[k]) {
              const timestamp = parseInt(candles[currIndex][0]);
              const date = new Date(timestamp).toLocaleString('en-US', { timeZone: 'UTC' });
              buySignals.push(`${date}: RSI = ${currRsi.toFixed(2)}, Price = $${closes[currIndex].toFixed(2)}, SMA(50) = $${smaValues[k].toFixed(2)}, Volume = ${volumes[currIndex].toFixed(2)}, Avg Vol(20) = ${avgVolumeValues[k].toFixed(2)}`);
            }
          }
        }

        // Original RSI behavior analysis (overbought/oversold transitions)
        if (prevRsi < 70 && currRsi >= 70) {
          if (lastOversoldIndex !== null) {
            const startPrice = closes[lastOversoldIndex];
            const endPrice = closes[currIndex];
            const rise = (endPrice / startPrice - 1) * 100;
            rises.push(rise);
          }
          lastOverboughtIndex = currIndex;
        }

        if (prevRsi > 30 && currRsi <= 30) {
          if (lastOverboughtIndex !== null) {
            const startPrice = closes[lastOverboughtIndex];
            const endPrice = closes[currIndex];
            const drop = (endPrice / startPrice - 1) * 100;
            drops.push(drop);
          }
          lastOversoldIndex = currIndex;
        }
      }

      let message = `${symbol} - Analysis (Last Year):\n`;

      // Oversold signals (RSI < 29.5)
      if (oversoldSignals.length > 0) {
        message += `Oversold Signals (RSI < 29.5):\n${oversoldSignals.join('\n')}\n`;
      } else {
        message += `No oversold signals (RSI < 29.5) detected.\n`;
      }

      // Buy signals
      if (buySignals.length > 0) {
        message += `Buy Signals (RSI cross above 30, Price > SMA(50), Volume > Avg Vol(20)):\n${buySignals.join('\n')}\n`;
      } else {
        message += `No buy signals detected.\n`;
      }

      // Original RSI behavior analysis
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

      console.log(message);
      await bot.sendMessage(config.telegramChatId, message);

    } catch (error: any) {
      console.error(`Error for ${symbol}: ${error.message}`);
    }
  }
}

analyzeBuySignals().catch(err => {
  console.error('Error in execution:', err);
  process.exit(1);
});