import axios from 'axios';
import { RSI, SMA } from 'technicalindicators';
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
}

interface NotificationState {
  [symbol: string]: AssetState;
}

type DcaTier = 'LIGHT' | 'MEDIUM' | 'HEAVY' | 'MAXIMUM';

interface DcaConfig {
  tier: DcaTier;
  rsiThreshold: number;
  positionSize: string;
  emoji: string;
  description: string;
}

interface Candle {
  [index: number]: string;
}

// DCA Tiers Configuration
const DCA_TIERS: DcaConfig[] = [
  { tier: 'LIGHT', rsiThreshold: 30, positionSize: '25%', emoji: '🟡', description: 'Entrada ligera' },
  { tier: 'MEDIUM', rsiThreshold: 25, positionSize: '50%', emoji: '🟠', description: 'Entrada media' },
  { tier: 'HEAVY', rsiThreshold: 20, positionSize: '75%', emoji: '🔴', description: 'Entrada fuerte' },
  { tier: 'MAXIMUM', rsiThreshold: 15, positionSize: '100%', emoji: '🚨', description: 'Entrada maxima' },
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

// Message Formatting
function formatMessage(
  symbol: string,
  rsi: number,
  price: number,
  tier: DcaConfig,
  reason: string
): string {
  const nextTiers = DCA_TIERS.filter(t => getTierIndex(t.tier) > getTierIndex(tier.tier));

  let entryLevels = `• Ahora (RSI ${rsi.toFixed(1)}): $${price.toFixed(2)}`;

  // Estimate prices for next tiers (rough approximation)
  for (const nextTier of nextTiers) {
    const priceEstimate = price * (nextTier.rsiThreshold / rsi);
    entryLevels += `\n• RSI ${nextTier.rsiThreshold}: ~$${priceEstimate.toFixed(2)}`;
  }

  return `${tier.emoji} ${symbol} OVERSOLD

📊 RSI (4H): ${rsi.toFixed(2)}
💰 Precio: $${price.toFixed(2)}

━━━━━━━━━━━━━━━━━━━
🎯 ${tier.description.toUpperCase()} (${tier.positionSize})
RSI en zona de acumulacion
━━━━━━━━━━━━━━━━━━━

📍 Niveles de entrada:
${entryLevels}

⏰ Proximo aviso: ${COOLDOWN_HOURS}h o cambio de tier
📝 Razon: ${reason}`;
}

// Main Function
async function checkBuySignal(): Promise<void> {
  console.log('\n' + '='.repeat(80));
  console.log('Checking for buy signals and oversold conditions...');
  console.log('='.repeat(80) + '\n');

  const state = await loadState();
  let stateChanged = false;

  for (const symbol of symbols) {
    try {
      const response = await axios.get(`https://www.okx.com/api/v5/market/candles?instId=${symbol}&bar=4H&limit=300`);
      const candles: Candle[] = response.data.data.reverse();

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

      // Calculate DCA tier
      const currentTier = calculateTier(lastRsi);
      const tierDisplay = currentTier ? `${currentTier.emoji} ${currentTier.tier}` : '✅ Normal';

      // Console output with colors
      console.log(
        `${CYAN}${symbol.padEnd(10)}${RESET} | ` +
        `${GREEN}$${currentPrice.toFixed(2).padEnd(10)}${RESET} | ` +
        `${lastRsi < 30 ? RED : YELLOW}RSI: ${lastRsi.toFixed(2).padEnd(8)}${RESET} | ` +
        `${BLUE}SMA50: ${lastSma.toFixed(2).padEnd(10)}${RESET} | ` +
        `Tier: ${tierDisplay}`
      );

      // Check if we should notify
      if (currentTier) {
        const { shouldSend, reason } = shouldNotify(symbol, currentTier, state);

        if (shouldSend) {
          const message = formatMessage(symbol, lastRsi, currentPrice, currentTier, reason);
          await bot.sendMessage(config.telegramChatId, message);
          console.log(`  ${GREEN}→ Notificacion enviada: ${reason}${RESET}`);

          // Update state
          state[symbol] = {
            lastNotified: new Date().toISOString(),
            tier: currentTier.tier,
          };
          stateChanged = true;
        } else {
          console.log(`  ${YELLOW}→ Notificacion omitida: ${reason}${RESET}`);
        }
      } else {
        // RSI is above 30, reset state for this symbol if it was in oversold
        if (state[symbol]?.tier) {
          console.log(`  ${BLUE}→ RSI recuperado, reseteando estado${RESET}`);
          state[symbol] = { lastNotified: null, tier: null };
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

  console.log('\n' + '='.repeat(80));
  console.log('Check complete');
  console.log('='.repeat(80) + '\n');
}

checkBuySignal().catch(err => {
  console.error('Error in execution:', err);
  process.exit(1);
});
