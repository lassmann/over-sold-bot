import axios from 'axios';
import { RSI, SMA } from 'technicalindicators';
import TelegramBot from 'node-telegram-bot-api';
import { config } from './config';

const bot = new TelegramBot(config.telegramBotToken);
const symbols: string[] = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'SUI-USDT', 'XRP-USDT', 'BNB-USDT'];

interface Candle {
  [index: number]: string; // [ts, open, high, low, close, vol, volCcy]
}

async function checkBuySignal(): Promise<void> {
  console.log('Checking for buy signals and oversold conditions...');

  for (const symbol of symbols) {
    try {
      const response = await axios.get(`https://www.okx.com/api/v5/market/candles?instId=${symbol}&bar=4H&limit=300`);
      const candles: Candle[] = response.data.data.reverse();

      const closes: number[] = candles.map((candle: Candle) => parseFloat(candle[4]));
      const volumes: number[] = candles.map((candle: Candle) => parseFloat(candle[5]));

      const rsiInput = { values: closes, period: 14 };
      const rsiValues: number[] = RSI.calculate(rsiInput);
      const lastRsi: number = rsiValues[rsiValues.length - 1];
      const prevRsi: number = rsiValues[rsiValues.length - 2];

      const smaInput = { values: closes, period: 50 };
      const smaValues: number[] = SMA.calculate(smaInput);
      const lastSma: number = smaValues[smaValues.length - 1];

      const volumeInput = { values: volumes, period: 20 };
      const avgVolumeValues: number[] = SMA.calculate(volumeInput);
      const lastAvgVolume: number = avgVolumeValues[avgVolumeValues.length - 1];

      const currentPrice: number = closes[closes.length - 1];
      const currentVolume: number = volumes[volumes.length - 1];

      console.log(`${symbol} - Precio: $${currentPrice.toFixed(2)} - RSI (4h): ${lastRsi.toFixed(2)} - SMA(50): ${lastSma.toFixed(2)} - Volumen: ${currentVolume.toFixed(2)} - Avg Vol(20): ${lastAvgVolume.toFixed(2)}`);

      if (lastRsi < 29.5) {
        const message: string = `${symbol} is oversold on 4-hour timeframe! RSI: ${lastRsi.toFixed(2)}. Current price: $${currentPrice.toFixed(2)}`;
        await bot.sendMessage(config.telegramChatId, message);
        console.log(`Notification sent: ${message}`);
      }

      if (prevRsi < 30 && lastRsi >= 30) {
        if (currentPrice > lastSma) {
          if (currentVolume > lastAvgVolume) {
            const message: string = `Buy signal for ${symbol}! RSI crossed above 30: ${lastRsi.toFixed(2)}. Price: $${currentPrice.toFixed(2)} > SMA(50): ${lastSma.toFixed(2)}. Volume: ${currentVolume.toFixed(2)} > Avg Vol(20): ${lastAvgVolume.toFixed(2)}`;
            await bot.sendMessage(config.telegramChatId, message);
            console.log(`Notification sent: ${message}`);
          }
        }
      }
    } catch (error: any) {
      console.error(`Error ${symbol}: ${error.message}`);
    }
  }
}

checkBuySignal().catch(err => {
  console.error('Error in execution:', err);
  process.exit(1);
});