import axios from 'axios';
import { RSI, SMA, ADX, Stochastic, StochasticRSI } from 'technicalindicators';
import TelegramBot from 'node-telegram-bot-api';
import { config } from './config';

// ANSI color codes
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';

// Types
interface AssetState {
  lastNotified: string | null;
  tier: DcaTier | null;
  lastSellNotified: string | null;
  sellTier: SellTier | null;
}

interface NotificationState {
  [symbol: string]: AssetState;
}

type DcaTier = 'LIGHT' | 'MEDIUM' | 'HEAVY' | 'MAXIMUM';
type SellTier = 'LIGHT_SELL' | 'MEDIUM_SELL' | 'HEAVY_SELL' | 'MAXIMUM_SELL';

interface DcaConfig {
  tier: DcaTier;
  rsiThreshold: number;
  positionSize: string;
  emoji: string;
  description: string;
}

interface SellConfig {
  tier: SellTier;
  rsiThreshold: number;
  positionSize: string;
  emoji: string;
  description: string;
}

interface Candle {
  [index: number]: string;
}

interface TrendInfo {
  adx: number;
  plusDI: number;
  minusDI: number;
  trend: 'ALCISTA' | 'BAJISTA' | 'LATERAL';
  trendStrength: 'FUERTE' | 'DEBIL';
}

interface StochasticInfo {
  stochK: number;
  stochD: number;
  stochRsiK: number;
  stochRsiD: number;
  stochSignal: 'OVERSOLD' | 'OVERBOUGHT' | 'NEUTRAL';
}

// DCA Tiers Configuration (Buy - Oversold)
const DCA_TIERS: DcaConfig[] = [
  { tier: 'LIGHT', rsiThreshold: 30, positionSize: '25%', emoji: '🟡', description: 'Entrada ligera' },
  { tier: 'MEDIUM', rsiThreshold: 25, positionSize: '50%', emoji: '🟠', description: 'Entrada media' },
  { tier: 'HEAVY', rsiThreshold: 20, positionSize: '75%', emoji: '🔴', description: 'Entrada fuerte' },
  { tier: 'MAXIMUM', rsiThreshold: 15, positionSize: '100%', emoji: '🚨', description: 'Entrada maxima' },
];

// Sell Tiers Configuration (Sell - Overbought)
const SELL_TIERS: SellConfig[] = [
  { tier: 'LIGHT_SELL', rsiThreshold: 70, positionSize: '25%', emoji: '🟢', description: 'Venta ligera' },
  { tier: 'MEDIUM_SELL', rsiThreshold: 75, positionSize: '50%', emoji: '🟩', description: 'Venta media' },
  { tier: 'HEAVY_SELL', rsiThreshold: 80, positionSize: '75%', emoji: '💚', description: 'Venta fuerte' },
  { tier: 'MAXIMUM_SELL', rsiThreshold: 85, positionSize: '100%', emoji: '💰', description: 'Venta maxima' },
];

const COOLDOWN_HOURS = 4;
const KVDB_URL = config.kvdbBucketId ? `https://kvdb.io/${config.kvdbBucketId}/rsi-state` : '';

const bot = new TelegramBot(config.telegramBotToken);
const symbols: string[] = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'SUI-USDT', 'XRP-USDT', 'BNB-USDT'];

// State Management via KVdb.io
async function loadState(): Promise<NotificationState> {
  if (!KVDB_URL) {
    console.log('KVDB_BUCKET_ID not configured, state will not persist');
    return {};
  }
  try {
    const response = await axios.get(KVDB_URL, { timeout: 5000 });
    if (response.data && typeof response.data === 'object') {
      console.log('Estado cargado desde KVdb.io');
      return response.data;
    }
    return {};
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.log('No previous state found in KVdb.io, starting fresh');
    } else {
      console.log(`Error loading state: ${error.message}`);
    }
    return {};
  }
}

async function saveState(state: NotificationState): Promise<void> {
  if (!KVDB_URL) return;
  try {
    await axios.post(KVDB_URL, JSON.stringify(state), {
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000
    });
    console.log(`${GREEN}Estado guardado en KVdb.io${RESET}`);
  } catch (error: any) {
    console.error(`${RED}Error saving state: ${error.message}${RESET}`);
  }
}

// DCA Logic
function calculateTier(rsi: number): DcaConfig | null {
  if (rsi >= 30) return null;

  // Find the most severe tier that applies (lowest RSI threshold)
  for (let i = DCA_TIERS.length - 1; i >= 0; i--) {
    if (rsi < DCA_TIERS[i].rsiThreshold) {
      return DCA_TIERS[i];
    }
  }
  return DCA_TIERS[0]; // Default to LIGHT if below 30
}

function getTierIndex(tier: DcaTier | null): number {
  if (!tier) return -1;
  return DCA_TIERS.findIndex(t => t.tier === tier);
}

function shouldNotify(
  symbol: string,
  currentTier: DcaConfig,
  state: NotificationState
): { shouldSend: boolean; reason: string } {
  const assetState = state[symbol];

  // Never notified for this asset
  if (!assetState?.lastNotified) {
    return { shouldSend: true, reason: 'primera_notificacion' };
  }

  const lastNotified = new Date(assetState.lastNotified);
  const now = new Date();
  const hoursSinceLastNotification = (now.getTime() - lastNotified.getTime()) / (1000 * 60 * 60);

  // Cooldown expired
  if (hoursSinceLastNotification >= COOLDOWN_HOURS) {
    return { shouldSend: true, reason: 'cooldown_expirado' };
  }

  // Tier escalation (RSI dropped to more severe level)
  const lastTierIndex = getTierIndex(assetState.tier);
  const currentTierIndex = getTierIndex(currentTier.tier);

  if (currentTierIndex > lastTierIndex) {
    return { shouldSend: true, reason: 'escalacion_de_tier' };
  }

  const hoursRemaining = (COOLDOWN_HOURS - hoursSinceLastNotification).toFixed(1);
  return { shouldSend: false, reason: `cooldown_activo (${hoursRemaining}h restantes)` };
}

// Sell Logic (Overbought)
function calculateSellTier(rsi: number): SellConfig | null {
  if (rsi <= 70) return null;

  // Find the most severe tier that applies (highest RSI threshold)
  for (let i = SELL_TIERS.length - 1; i >= 0; i--) {
    if (rsi >= SELL_TIERS[i].rsiThreshold) {
      return SELL_TIERS[i];
    }
  }
  return SELL_TIERS[0]; // Default to LIGHT_SELL if above 70
}

function getSellTierIndex(tier: SellTier | null): number {
  if (!tier) return -1;
  return SELL_TIERS.findIndex(t => t.tier === tier);
}

function shouldNotifySell(
  symbol: string,
  currentTier: SellConfig,
  state: NotificationState
): { shouldSend: boolean; reason: string } {
  const assetState = state[symbol];

  // Never notified sell for this asset
  if (!assetState?.lastSellNotified) {
    return { shouldSend: true, reason: 'primera_notificacion_venta' };
  }

  const lastNotified = new Date(assetState.lastSellNotified);
  const now = new Date();
  const hoursSinceLastNotification = (now.getTime() - lastNotified.getTime()) / (1000 * 60 * 60);

  // Cooldown expired
  if (hoursSinceLastNotification >= COOLDOWN_HOURS) {
    return { shouldSend: true, reason: 'cooldown_expirado' };
  }

  // Tier escalation (RSI rose to more severe level)
  const lastTierIndex = getSellTierIndex(assetState.sellTier);
  const currentTierIndex = getSellTierIndex(currentTier.tier);

  if (currentTierIndex > lastTierIndex) {
    return { shouldSend: true, reason: 'escalacion_de_tier' };
  }

  const hoursRemaining = (COOLDOWN_HOURS - hoursSinceLastNotification).toFixed(1);
  return { shouldSend: false, reason: `cooldown_activo (${hoursRemaining}h restantes)` };
}

// Trend Calculation (ADX + DI)
function calculateTrend(highs: number[], lows: number[], closes: number[]): TrendInfo {
  const adxInput = { high: highs, low: lows, close: closes, period: 14 };
  const adxValues = ADX.calculate(adxInput);
  const lastADX = adxValues[adxValues.length - 1];

  const trend = lastADX.pdi > lastADX.mdi ? 'ALCISTA' : 'BAJISTA';
  const trendStrength = lastADX.adx > 25 ? 'FUERTE' : 'DEBIL';
  const finalTrend = lastADX.adx < 20 ? 'LATERAL' : trend;

  return {
    adx: lastADX.adx,
    plusDI: lastADX.pdi,
    minusDI: lastADX.mdi,
    trend: finalTrend,
    trendStrength
  };
}

// Stochastic Calculation
function calculateStochastic(highs: number[], lows: number[], closes: number[]): StochasticInfo {
  // Stochastic clásico (14, 3, 3)
  const stochInput = { high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 };
  const stochValues = Stochastic.calculate(stochInput);
  const lastStoch = stochValues[stochValues.length - 1];

  // Stochastic RSI
  const stochRsiInput = { values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 };
  const stochRsiValues = StochasticRSI.calculate(stochRsiInput);
  const lastStochRsi = stochRsiValues[stochRsiValues.length - 1];

  let signal: 'OVERSOLD' | 'OVERBOUGHT' | 'NEUTRAL' = 'NEUTRAL';
  if (lastStochRsi.k < 20 && lastStochRsi.d < 20) signal = 'OVERSOLD';
  if (lastStochRsi.k > 80 && lastStochRsi.d > 80) signal = 'OVERBOUGHT';

  return {
    stochK: lastStoch.k,
    stochD: lastStoch.d,
    stochRsiK: lastStochRsi.k,
    stochRsiD: lastStochRsi.d,
    stochSignal: signal
  };
}

// Message Formatting
function formatMessage(
  symbol: string,
  rsi: number,
  price: number,
  tier: DcaConfig,
  reason: string,
  trend: TrendInfo,
  stoch: StochasticInfo
): string {
  const nextTiers = DCA_TIERS.filter(t => getTierIndex(t.tier) > getTierIndex(tier.tier));

  let entryLevels = `• Ahora (RSI ${rsi.toFixed(1)}): $${price.toFixed(2)}`;

  // Estimate prices for next tiers (rough approximation)
  for (const nextTier of nextTiers) {
    const priceEstimate = price * (nextTier.rsiThreshold / rsi);
    entryLevels += `\n• RSI ${nextTier.rsiThreshold}: ~$${priceEstimate.toFixed(2)}`;
  }

  // Trend emojis
  const trendEmoji = trend.trend === 'ALCISTA' ? '📈' : trend.trend === 'BAJISTA' ? '📉' : '➡️';
  const strengthEmoji = trend.trendStrength === 'FUERTE' ? '💪' : '🤏';

  // Stochastic emoji
  const stochEmoji = stoch.stochSignal === 'OVERSOLD' ? '✅' : stoch.stochSignal === 'OVERBOUGHT' ? '⚠️' : '➖';

  return `${tier.emoji} ${symbol} OVERSOLD

📊 RSI (4H): ${rsi.toFixed(2)}
💰 Precio: $${price.toFixed(2)}

━━━━━━━━━━━━━━━━━━━
📈 TENDENCIA
${trendEmoji} ${trend.trend} ${strengthEmoji}
ADX: ${trend.adx.toFixed(1)} | DI+: ${trend.plusDI.toFixed(1)} | DI-: ${trend.minusDI.toFixed(1)}

📉 STOCHASTIC ${stochEmoji}
%K: ${stoch.stochK.toFixed(1)} | %D: ${stoch.stochD.toFixed(1)}
StochRSI K: ${stoch.stochRsiK.toFixed(1)} | D: ${stoch.stochRsiD.toFixed(1)}
━━━━━━━━━━━━━━━━━━━

🎯 ${tier.description.toUpperCase()} (${tier.positionSize})
RSI en zona de acumulacion

📍 Niveles de entrada:
${entryLevels}

⏰ Proximo aviso: ${COOLDOWN_HOURS}h o cambio de tier
📝 Razon: ${reason}`;
}

// Sell Message Formatting
function formatSellMessage(
  symbol: string,
  rsi: number,
  price: number,
  tier: SellConfig,
  reason: string,
  trend: TrendInfo,
  stoch: StochasticInfo
): string {
  const nextTiers = SELL_TIERS.filter(t => getSellTierIndex(t.tier) > getSellTierIndex(tier.tier));

  let exitLevels = `• Ahora (RSI ${rsi.toFixed(1)}): $${price.toFixed(2)}`;

  // Estimate prices for next tiers
  for (const nextTier of nextTiers) {
    const priceEstimate = price * (nextTier.rsiThreshold / rsi);
    exitLevels += `\n• RSI ${nextTier.rsiThreshold}: ~$${priceEstimate.toFixed(2)}`;
  }

  // Trend emojis
  const trendEmoji = trend.trend === 'ALCISTA' ? '📈' : trend.trend === 'BAJISTA' ? '📉' : '➡️';
  const strengthEmoji = trend.trendStrength === 'FUERTE' ? '💪' : '🤏';

  // Stochastic emoji
  const stochEmoji = stoch.stochSignal === 'OVERBOUGHT' ? '⚠️' : stoch.stochSignal === 'OVERSOLD' ? '✅' : '➖';

  return `${tier.emoji} ${symbol} OVERBOUGHT

📊 RSI (4H): ${rsi.toFixed(2)}
💰 Precio: $${price.toFixed(2)}

━━━━━━━━━━━━━━━━━━━
📈 TENDENCIA
${trendEmoji} ${trend.trend} ${strengthEmoji}
ADX: ${trend.adx.toFixed(1)} | DI+: ${trend.plusDI.toFixed(1)} | DI-: ${trend.minusDI.toFixed(1)}

📉 STOCHASTIC ${stochEmoji}
%K: ${stoch.stochK.toFixed(1)} | %D: ${stoch.stochD.toFixed(1)}
StochRSI K: ${stoch.stochRsiK.toFixed(1)} | D: ${stoch.stochRsiD.toFixed(1)}
━━━━━━━━━━━━━━━━━━━

🎯 ${tier.description.toUpperCase()} (${tier.positionSize})
RSI en zona de distribucion - considerar tomar ganancias

📍 Niveles de salida:
${exitLevels}

⏰ Proximo aviso: ${COOLDOWN_HOURS}h o cambio de tier
📝 Razon: ${reason}`;
}

// Main Function
async function checkBuySignal(): Promise<void> {
  console.log('\n' + '='.repeat(100));
  console.log('Checking for buy signals and oversold conditions...');
  console.log('='.repeat(100) + '\n');

  const state = await loadState();

  // Table header
  console.log(
    `${CYAN}${'SYMBOL'.padEnd(10)}${RESET} | ` +
    `${'PRECIO'.padEnd(11)} | ` +
    `${'RSI'.padEnd(8)} | ` +
    `${'SMA50'.padEnd(11)} | ` +
    `${'TENDENCIA'.padEnd(8)} | ` +
    `${'StochRSI'.padEnd(8)} | ` +
    `${'BUY TIER'.padEnd(12)} | ` +
    `SELL TIER`
  );
  console.log('-'.repeat(115));
  let stateChanged = false;

  for (const symbol of symbols) {
    try {
      const response = await axios.get(`https://www.okx.com/api/v5/market/candles?instId=${symbol}&bar=4H&limit=300`);
      const candles: Candle[] = response.data.data.reverse();

      const highs: number[] = candles.map((candle: Candle) => parseFloat(candle[2]));
      const lows: number[] = candles.map((candle: Candle) => parseFloat(candle[3]));
      const closes: number[] = candles.map((candle: Candle) => parseFloat(candle[4]));
      const volumes: number[] = candles.map((candle: Candle) => parseFloat(candle[5]));

      const rsiInput = { values: closes, period: 14 };
      const rsiValues: number[] = RSI.calculate(rsiInput);
      const lastRsi: number = rsiValues[rsiValues.length - 1];

      const smaInput = { values: closes, period: 50 };
      const smaValues: number[] = SMA.calculate(smaInput);
      const lastSma: number = smaValues[smaValues.length - 1];

      const volumeInput = { values: volumes, period: 20 };
      const avgVolumeValues: number[] = SMA.calculate(volumeInput);
      const lastAvgVolume: number = avgVolumeValues[avgVolumeValues.length - 1];

      const currentPrice: number = closes[closes.length - 1];
      const currentVolume: number = volumes[volumes.length - 1];

      // Calculate trend and stochastic
      const trendInfo = calculateTrend(highs, lows, closes);
      const stochInfo = calculateStochastic(highs, lows, closes);

      // Calculate DCA tiers (buy and sell)
      const currentTier = calculateTier(lastRsi);
      const currentSellTierForDisplay = calculateSellTier(lastRsi);
      const buyTierDisplay = currentTier ? `${currentTier.emoji} ${currentTier.tier}` : '✅ Normal';
      const sellTierDisplay = currentSellTierForDisplay ? `${currentSellTierForDisplay.emoji} ${currentSellTierForDisplay.tier.replace('_SELL', '')}` : '✅ Normal';

      // Console output with colors
      const trendColor = trendInfo.trend === 'ALCISTA' ? GREEN : trendInfo.trend === 'BAJISTA' ? RED : YELLOW;
      const rsiColor = lastRsi < 30 ? RED : lastRsi > 70 ? GREEN : YELLOW;
      console.log(
        `${CYAN}${symbol.padEnd(10)}${RESET} | ` +
        `${GREEN}$${currentPrice.toFixed(2).padEnd(10)}${RESET} | ` +
        `${rsiColor}${lastRsi.toFixed(2).padEnd(8)}${RESET} | ` +
        `${BLUE}${lastSma.toFixed(2).padEnd(11)}${RESET} | ` +
        `${trendColor}${trendInfo.trend.padEnd(8)}${RESET} | ` +
        `${stochInfo.stochRsiK.toFixed(1).padEnd(8)} | ` +
        `${buyTierDisplay.padEnd(12)} | ` +
        `${sellTierDisplay}`
      );

      // Check if we should notify (BUY - Oversold)
      if (currentTier) {
        const { shouldSend, reason } = shouldNotify(symbol, currentTier, state);

        if (shouldSend) {
          const message = formatMessage(symbol, lastRsi, currentPrice, currentTier, reason, trendInfo, stochInfo);
          await bot.sendMessage(config.telegramChatId, message);
          console.log(`  ${GREEN}→ Notificacion de COMPRA enviada: ${reason}${RESET}`);

          // Update state (preserve sell state)
          state[symbol] = {
            ...state[symbol],
            lastNotified: new Date().toISOString(),
            tier: currentTier.tier,
          };
          stateChanged = true;
        } else {
          console.log(`  ${YELLOW}→ Notificacion de compra omitida: ${reason}${RESET}`);
        }
      } else {
        // RSI is above 30, reset buy state for this symbol if it was in oversold
        if (state[symbol]?.tier) {
          console.log(`  ${BLUE}→ RSI recuperado de oversold, reseteando estado de compra${RESET}`);
          state[symbol] = { ...state[symbol], lastNotified: null, tier: null };
          stateChanged = true;
        }
      }

      // Check if we should notify (SELL - Overbought)
      const currentSellTier = calculateSellTier(lastRsi);
      if (currentSellTier) {
        const { shouldSend, reason } = shouldNotifySell(symbol, currentSellTier, state);

        if (shouldSend) {
          const message = formatSellMessage(symbol, lastRsi, currentPrice, currentSellTier, reason, trendInfo, stochInfo);
          await bot.sendMessage(config.telegramChatId, message);
          console.log(`  ${GREEN}→ Notificacion de VENTA enviada: ${reason}${RESET}`);

          // Update state (preserve buy state)
          state[symbol] = {
            ...state[symbol],
            lastSellNotified: new Date().toISOString(),
            sellTier: currentSellTier.tier,
          };
          stateChanged = true;
        } else {
          console.log(`  ${YELLOW}→ Notificacion de venta omitida: ${reason}${RESET}`);
        }
      } else {
        // RSI is below 70, reset sell state for this symbol if it was in overbought
        if (state[symbol]?.sellTier) {
          console.log(`  ${BLUE}→ RSI recuperado de overbought, reseteando estado de venta${RESET}`);
          state[symbol] = { ...state[symbol], lastSellNotified: null, sellTier: null };
          stateChanged = true;
        }
      }
    } catch (error: any) {
      console.error(`${RED}Error ${symbol}: ${error.message}${RESET}`);
    }
  }

  // Save state if changed
  if (stateChanged) {
    await saveState(state);
  }

  console.log('\n' + '='.repeat(100));
  console.log('Check complete');
  console.log('='.repeat(100));

  // Legend
  console.log(`\n📖 ${CYAN}LEYENDA:${RESET}`);
  console.log('─'.repeat(90));
  console.log(`${YELLOW}RSI${RESET}        - Relative Strength Index (14). ${RED}<30 = oversold${RESET}, ${GREEN}>70 = overbought${RESET}`);
  console.log(`${BLUE}SMA50${RESET}      - Media movil simple de 50 periodos (referencia de tendencia)`);
  console.log(`${GREEN}TENDENCIA${RESET}  - Basada en ADX+DI:`);
  console.log(`             ALCISTA (DI+ > DI-), BAJISTA (DI- > DI+), LATERAL (ADX < 20)`);
  console.log(`StochRSI   - Stochastic RSI %K. <20 = oversold, >80 = overbought`);
  console.log(`${RED}BUY TIER${RESET}   - Nivel de COMPRA: LIGHT (RSI<30), MEDIUM (<25), HEAVY (<20), MAXIMUM (<15)`);
  console.log(`${GREEN}SELL TIER${RESET}  - Nivel de VENTA: LIGHT (RSI>70), MEDIUM (>75), HEAVY (>80), MAXIMUM (>85)`);
  console.log('─'.repeat(90) + '\n');
}

checkBuySignal().catch(err => {
  console.error('Error in execution:', err);
  process.exit(1);
});
