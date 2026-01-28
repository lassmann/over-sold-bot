/**
 * 🤖 BTC Options Alert Bot - Node.js Version
 * ==========================================
 * 
 * Detecta el momento óptimo para comprar CALL options en BTC.
 * 
 * Estrategia:
 * - Esperar crash + estabilización
 * - IV normalizada (< 45%)
 * - Soporte confirmado
 * - RSI saliendo de sobreventa
 */

import axios from 'axios';
import { config } from './config';

// ============================================================
// CONFIGURACIÓN
// ============================================================

const CONFIG = {
    // Telegram (usa config.ts centralizado)
    telegram: {
        botToken: config.telegramBotToken,
        chatId: config.telegramChatId,
    },

    // Parámetros de la estrategia
    strategy: {
        checkIntervalMinutes: 15,
        ivThresholdGood: 40,
        ivThresholdMax: 50,
        rsiOversold: 35,
        rsiRecovery: 40,
        minScoreAlert: 70,
    },

    // Niveles de soporte/resistencia BTC (actualizar según análisis)
    levels: {
        supports: [85000, 82000, 80000, 78000, 75000],
        resistances: [92000, 95000, 98000, 100000],
    },

    // Gestión de riesgo
    risk: {
        capital: 10000,
        riskPercent: 2,
    },
};

// ============================================================
// INTERFACES
// ============================================================

interface MarketDataInput {
    price: number;
    price24hAgo: number;
    price7dAgo: number;
    high7d: number;
    low7d: number;
    volume24h: number;
}

interface OptionsDataInput {
    ivAtm: number;
    ivPercentile: number;
    putCallRatio: number;
    totalOi: number;
    maxPain: number | null;
}

interface TechnicalDataInput {
    rsi14: number;
    rsi7: number;
    sma20: number;
    sma50: number;
    ema12: number;
    ema26: number;
    macd: number;
    macdSignal: number;
    bollingerUpper: number;
    bollingerLower: number;
    atr14: number;
}

interface ScoreResultInput {
    totalScore: number;
    ivScore: number;
    technicalScore: number;
    supportScore: number;
    timingScore: number;
    signals: string[];
    recommendation: string;
    details: Record<string, unknown>;
}

// ============================================================
// CLASES DE DATOS
// ============================================================

class MarketData {
    price: number;
    price24hAgo: number;
    price7dAgo: number;
    high7d: number;
    low7d: number;
    volume24h: number;
    timestamp: Date;

    constructor(data: MarketDataInput) {
        this.price = data.price;
        this.price24hAgo = data.price24hAgo;
        this.price7dAgo = data.price7dAgo;
        this.high7d = data.high7d;
        this.low7d = data.low7d;
        this.volume24h = data.volume24h;
        this.timestamp = new Date();
    }
}

class OptionsData {
    ivAtm: number;
    ivPercentile: number;
    putCallRatio: number;
    totalOi: number;
    maxPain: number | null;
    timestamp: Date;

    constructor(data: OptionsDataInput) {
        this.ivAtm = data.ivAtm;
        this.ivPercentile = data.ivPercentile;
        this.putCallRatio = data.putCallRatio;
        this.totalOi = data.totalOi;
        this.maxPain = data.maxPain || null;
        this.timestamp = new Date();
    }
}

class TechnicalData {
    rsi14: number;
    rsi7: number;
    sma20: number;
    sma50: number;
    ema12: number;
    ema26: number;
    macd: number;
    macdSignal: number;
    bollingerUpper: number;
    bollingerLower: number;
    atr14: number;
    timestamp: Date;

    constructor(data: TechnicalDataInput) {
        this.rsi14 = data.rsi14;
        this.rsi7 = data.rsi7;
        this.sma20 = data.sma20;
        this.sma50 = data.sma50;
        this.ema12 = data.ema12;
        this.ema26 = data.ema26;
        this.macd = data.macd;
        this.macdSignal = data.macdSignal;
        this.bollingerUpper = data.bollingerUpper;
        this.bollingerLower = data.bollingerLower;
        this.atr14 = data.atr14;
        this.timestamp = new Date();
    }
}

class ScoreResult {
    totalScore: number;
    ivScore: number;
    technicalScore: number;
    supportScore: number;
    timingScore: number;
    signals: string[];
    recommendation: string;
    details: Record<string, unknown>;

    constructor(data: ScoreResultInput) {
        this.totalScore = data.totalScore;
        this.ivScore = data.ivScore;
        this.technicalScore = data.technicalScore;
        this.supportScore = data.supportScore;
        this.timingScore = data.timingScore;
        this.signals = data.signals;
        this.recommendation = data.recommendation;
        this.details = data.details;
    }
}

// ============================================================
// DATA FETCHER - Obtención de datos
// ============================================================

class DataFetcher {
    private binanceBaseUrl = 'https://api.binance.com/api/v3';
    private binanceOptionsUrl = 'https://eapi.binance.com/eapi/v1';

    async getBinancePrice(): Promise<MarketData> {
        try {
            // Precio actual y datos 24h
            const ticker = await axios.get(`${this.binanceBaseUrl}/ticker/24hr`, {
                params: { symbol: 'BTCUSDT' }
            });

            // Klines para datos históricos
            const klines = await axios.get(`${this.binanceBaseUrl}/klines`, {
                params: {
                    symbol: 'BTCUSDT',
                    interval: '1d',
                    limit: 8
                }
            });

            const price = parseFloat(ticker.data.lastPrice);
            const price24hAgo = parseFloat(ticker.data.openPrice);

            // Calcular high/low de 7 días
            const klinesData = klines.data.slice(0, -1); // Excluir día actual
            const highs = klinesData.map((k: string[]) => parseFloat(k[2]));
            const lows = klinesData.map((k: string[]) => parseFloat(k[3]));

            return new MarketData({
                price,
                price24hAgo,
                price7dAgo: parseFloat(klinesData[0][4]),
                high7d: Math.max(...highs),
                low7d: Math.min(...lows),
                volume24h: parseFloat(ticker.data.volume),
            });
        } catch (error) {
            console.error('Error obteniendo precio Binance:', (error as Error).message);
            throw error;
        }
    }

    async getBinanceOptionsIV(): Promise<OptionsData> {
        try {
            // Obtener index price
            const indexResp = await axios.get(`${this.binanceOptionsUrl}/index`, {
                params: { underlying: 'BTCUSDT' }
            });

            const currentPrice = parseFloat(indexResp.data.indexPrice || 89000);

            // Obtener mark prices de opciones
            const markResp = await axios.get(`${this.binanceOptionsUrl}/mark`);

            // Filtrar opciones BTC y extraer IV
            const ivValues: number[] = [];
            for (const option of markResp.data) {
                if (option.symbol && option.symbol.includes('BTC')) {
                    const iv = parseFloat(option.bidIV || 0) || parseFloat(option.askIV || 0);
                    if (iv > 0) {
                        ivValues.push(iv * 100);
                    }
                }
            }

            const ivAtm = ivValues.length > 0
                ? ivValues.reduce((a, b) => a + b, 0) / ivValues.length
                : 40.0;

            // Obtener open interest
            let totalCallOi = 0;
            let totalPutOi = 0;

            try {
                const oiResp = await axios.get(`${this.binanceOptionsUrl}/openInterest`, {
                    params: { underlyingAsset: 'BTC' }
                });

                for (const item of oiResp.data) {
                    const oi = parseFloat(item.sumOpenInterest || 0);
                    if (item.symbol && item.symbol.includes('-C')) {
                        totalCallOi += oi;
                    } else if (item.symbol && item.symbol.includes('-P')) {
                        totalPutOi += oi;
                    }
                }
            } catch (e) {
                console.log('No se pudo obtener OI, usando valores por defecto');
            }

            const putCallRatio = totalCallOi > 0 ? totalPutOi / totalCallOi : 0.8;

            // Calcular Max Pain
            const maxPain = await this.calculateMaxPain();

            return new OptionsData({
                ivAtm,
                ivPercentile: this.calculateIvPercentile(ivAtm),
                putCallRatio,
                totalOi: totalCallOi + totalPutOi,
                maxPain,
            });
        } catch (error) {
            console.error('Error obteniendo IV de Binance:', (error as Error).message);
            // Fallback con datos estimados
            return new OptionsData({
                ivAtm: 40.0,
                ivPercentile: 50.0,
                putCallRatio: 0.8,
                totalOi: 0,
                maxPain: null,
            });
        }
    }

    async calculateMaxPain(): Promise<number | null> {
        try {
            const oiResp = await axios.get(`${this.binanceOptionsUrl}/openInterest`, {
                params: { underlyingAsset: 'BTC' }
            });

            // Agrupar OI por strike
            const strikeData: Record<number, { callOi: number; putOi: number }> = {};

            for (const item of oiResp.data) {
                // Extraer strike del símbolo (ej: BTC-240127-90000-C)
                const match = item.symbol?.match(/-(\d+)-[CP]$/);
                if (match) {
                    const strike = parseInt(match[1]);
                    if (!strikeData[strike]) {
                        strikeData[strike] = { callOi: 0, putOi: 0 };
                    }

                    const oi = parseFloat(item.sumOpenInterestUsd || item.sumOpenInterest || 0);
                    if (item.symbol.endsWith('-C')) {
                        strikeData[strike].callOi += oi;
                    } else {
                        strikeData[strike].putOi += oi;
                    }
                }
            }

            const strikes = Object.keys(strikeData).map(Number).sort((a, b) => a - b);

            if (strikes.length === 0) return null;

            // Calcular dolor total para cada strike como precio de ejercicio
            let minPain = Infinity;
            let maxPainStrike = strikes[Math.floor(strikes.length / 2)];

            for (const settlementPrice of strikes) {
                let totalPain = 0;

                for (const strike of strikes) {
                    const data = strikeData[strike];

                    // Pérdida de calls: si precio > strike, calls ganan (dolor para vendedores)
                    if (settlementPrice > strike) {
                        totalPain += (settlementPrice - strike) * data.callOi;
                    }

                    // Pérdida de puts: si precio < strike, puts ganan (dolor para vendedores)
                    if (settlementPrice < strike) {
                        totalPain += (strike - settlementPrice) * data.putOi;
                    }
                }

                if (totalPain < minPain) {
                    minPain = totalPain;
                    maxPainStrike = settlementPrice;
                }
            }

            return maxPainStrike;
        } catch (error) {
            console.error('Error calculando Max Pain:', (error as Error).message);
            return null;
        }
    }

    calculateIvPercentile(currentIv: number): number {
        // Rangos históricos aproximados de IV de BTC
        if (currentIv < 25) return 5;
        if (currentIv < 30) return 15;
        if (currentIv < 35) return 25;
        if (currentIv < 40) return 40;
        if (currentIv < 45) return 50;
        if (currentIv < 50) return 60;
        if (currentIv < 60) return 75;
        if (currentIv < 75) return 85;
        return 95;
    }

    async calculateTechnicals(market: MarketData): Promise<TechnicalData> {
        try {
            // Obtener datos históricos
            const klines = await axios.get(`${this.binanceBaseUrl}/klines`, {
                params: {
                    symbol: 'BTCUSDT',
                    interval: '1h',
                    limit: 100
                }
            });

            const closes = klines.data.map((k: string[]) => parseFloat(k[4]));
            const highs = klines.data.map((k: string[]) => parseFloat(k[2]));
            const lows = klines.data.map((k: string[]) => parseFloat(k[3]));

            // RSI
            const rsi14 = this.calculateRSI(closes, 14);
            const rsi7 = this.calculateRSI(closes, 7);

            // SMAs
            const sma20 = this.calculateSMA(closes, 20);
            const sma50 = this.calculateSMA(closes, 50);

            // EMAs
            const ema12 = this.calculateEMA(closes, 12);
            const ema26 = this.calculateEMA(closes, 26);

            // MACD
            const macd = ema12 - ema26;
            const macdSignal = this.calculateEMA(closes.slice(-26), 9);

            // Bollinger Bands
            const sma20BB = this.calculateSMA(closes, 20);
            const std20 = this.calculateStdDev(closes.slice(-20));
            const bollingerUpper = sma20BB + (2 * std20);
            const bollingerLower = sma20BB - (2 * std20);

            // ATR
            const atr14 = this.calculateATR(highs, lows, closes, 14);

            return new TechnicalData({
                rsi14,
                rsi7,
                sma20,
                sma50,
                ema12,
                ema26,
                macd,
                macdSignal,
                bollingerUpper,
                bollingerLower,
                atr14,
            });
        } catch (error) {
            console.error('Error calculando técnicos:', (error as Error).message);
            throw error;
        }
    }

    calculateRSI(prices: number[], period: number): number {
        if (prices.length < period + 1) return 50;

        const deltas: number[] = [];
        for (let i = 1; i < prices.length; i++) {
            deltas.push(prices[i] - prices[i - 1]);
        }

        const recentDeltas = deltas.slice(-period);
        const gains = recentDeltas.filter(d => d > 0);
        const losses = recentDeltas.filter(d => d < 0).map(d => Math.abs(d));

        const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
        const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;

        if (avgLoss === 0) return 100;

        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    calculateSMA(prices: number[], period: number): number {
        if (prices.length < period) return prices[prices.length - 1] || 0;
        const slice = prices.slice(-period);
        return slice.reduce((a, b) => a + b, 0) / period;
    }

    calculateEMA(prices: number[], period: number): number {
        if (prices.length < period) return prices[prices.length - 1] || 0;

        const multiplier = 2 / (period + 1);
        let ema = this.calculateSMA(prices.slice(0, period), period);

        for (let i = period; i < prices.length; i++) {
            ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
        }

        return ema;
    }

    calculateStdDev(prices: number[]): number {
        const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
        const squaredDiffs = prices.map(p => Math.pow(p - mean, 2));
        return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / prices.length);
    }

    calculateATR(highs: number[], lows: number[], closes: number[], period: number): number {
        if (highs.length < period + 1) return 0;

        const trueRanges: number[] = [];
        for (let i = 1; i < highs.length; i++) {
            const tr = Math.max(
                highs[i] - lows[i],
                Math.abs(highs[i] - closes[i - 1]),
                Math.abs(lows[i] - closes[i - 1])
            );
            trueRanges.push(tr);
        }

        const recentTR = trueRanges.slice(-period);
        return recentTR.reduce((a, b) => a + b, 0) / period;
    }
}

// ============================================================
// SCORING ENGINE - Sistema de puntuación
// ============================================================

class ScoringEngine {
    private config: typeof CONFIG;

    constructor(config: typeof CONFIG) {
        this.config = config;
    }

    calculateScore(market: MarketData, options: OptionsData, technicals: TechnicalData): ScoreResult {
        const signals: string[] = [];
        const details: Record<string, unknown> = {};

        // 1. SCORE DE IV (0-25 puntos)
        const { score: ivScore, signals: ivSignals } = this.scoreIV(options);
        signals.push(...ivSignals);
        details.iv = {
            score: ivScore,
            ivAtm: options.ivAtm,
            ivPercentile: options.ivPercentile,
            putCallRatio: options.putCallRatio,
        };

        // 2. SCORE TÉCNICO (0-25 puntos)
        const { score: techScore, signals: techSignals } = this.scoreTechnicals(technicals, market);
        signals.push(...techSignals);
        details.technical = {
            score: techScore,
            rsi14: technicals.rsi14,
            rsi7: technicals.rsi7,
            macd: technicals.macd,
            priceVsSma20: ((market.price / technicals.sma20) - 1) * 100,
        };

        // 3. SCORE DE SOPORTE (0-25 puntos)
        const { score: supportScore, signals: supportSignals } = this.scoreSupport(market);
        signals.push(...supportSignals);
        details.support = {
            score: supportScore,
            nearestSupport: this.findNearestSupport(market.price),
            distanceToSupportPct: this.distanceToSupport(market.price),
        };

        // 4. SCORE DE TIMING (0-25 puntos)
        const { score: timingScore, signals: timingSignals } = this.scoreTiming(market, options);
        signals.push(...timingSignals);
        details.timing = {
            score: timingScore,
            change24hPct: ((market.price / market.price24hAgo) - 1) * 100,
            change7dPct: ((market.price / market.price7dAgo) - 1) * 100,
            distanceFrom7dLowPct: ((market.price / market.low7d) - 1) * 100,
        };

        // SCORE TOTAL
        const totalScore = ivScore + techScore + supportScore + timingScore;

        // RECOMENDACIÓN
        const recommendation = this.getRecommendation(totalScore, signals);

        return new ScoreResult({
            totalScore,
            ivScore,
            technicalScore: techScore,
            supportScore,
            timingScore,
            signals,
            recommendation,
            details,
        });
    }

    scoreIV(options: OptionsData): { score: number; signals: string[] } {
        let score = 0;
        const signals: string[] = [];
        const iv = options.ivAtm;

        if (iv < 30) {
            score = 25;
            signals.push('🟢 IV muy baja (<30%) - Opciones baratas');
        } else if (iv < 35) {
            score = 22;
            signals.push('🟢 IV baja (<35%) - Buen momento');
        } else if (iv < 40) {
            score = 18;
            signals.push('🟢 IV normal-baja (<40%) - Aceptable');
        } else if (iv < 45) {
            score = 12;
            signals.push('🟡 IV normal (40-45%) - Neutral');
        } else if (iv < 50) {
            score = 6;
            signals.push('🟠 IV elevada (45-50%) - Cuidado');
        } else if (iv < 60) {
            score = 3;
            signals.push('🔴 IV alta (50-60%) - Opciones caras');
        } else {
            score = 0;
            signals.push('🔴 IV muy alta (>60%) - NO comprar');
        }

        // Bonus por put/call ratio alto
        if (options.putCallRatio > 1.2) {
            score = Math.min(25, score + 3);
            signals.push('🟢 Put/Call ratio alto - Sentimiento muy negativo');
        }

        return { score, signals };
    }

    scoreTechnicals(tech: TechnicalData, market: MarketData): { score: number; signals: string[] } {
        let score = 0;
        const signals: string[] = [];

        // RSI
        if (tech.rsi14 < 30) {
            score += 8;
            signals.push('🟢 RSI muy sobrevendido (<30)');
        } else if (tech.rsi14 < 40) {
            score += 6;
            signals.push('🟢 RSI sobrevendido (<40)');
        } else if (tech.rsi14 < 50) {
            score += 4;
            signals.push('🟡 RSI neutral-bajo');
        } else if (tech.rsi14 > 70) {
            score += 0;
            signals.push('🔴 RSI sobrecomprado (>70)');
        } else {
            score += 2;
        }

        // RSI recuperándose
        if (tech.rsi7 > tech.rsi14 && tech.rsi14 < 45) {
            score += 4;
            signals.push('🟢 RSI recuperándose - Momentum alcista');
        }

        // MACD
        if (tech.macd > tech.macdSignal) {
            score += 4;
            signals.push('🟢 MACD cruce alcista');
        } else if (tech.macd > 0) {
            score += 2;
        }

        // Precio vs Bollinger
        if (market.price < tech.bollingerLower) {
            score += 5;
            signals.push('🟢 Precio bajo Bollinger inferior - Sobreventa');
        } else if (market.price < tech.sma20) {
            score += 3;
            signals.push('🟡 Precio bajo SMA20');
        }

        // Precio vs SMAs
        if (tech.sma20 > tech.sma50) {
            score += 2;
            signals.push('🟢 SMA20 > SMA50 - Tendencia alcista');
        }

        return { score: Math.min(25, score), signals };
    }

    scoreSupport(market: MarketData): { score: number; signals: string[] } {
        let score = 0;
        const signals: string[] = [];

        const price = market.price;
        const supports = this.config.levels.supports;

        const supportsBelow = supports.filter(s => s < price);
        if (supportsBelow.length === 0) {
            return { score: 5, signals: ['🟡 Sin soportes definidos cerca'] };
        }

        const nearestSupport = Math.max(...supportsBelow);
        const distancePct = ((price - nearestSupport) / price) * 100;

        if (distancePct < 1) {
            score = 25;
            signals.push(`🟢 Muy cerca de soporte $${nearestSupport.toLocaleString()} (<1%)`);
        } else if (distancePct < 2) {
            score = 22;
            signals.push(`🟢 Cerca de soporte $${nearestSupport.toLocaleString()} (<2%)`);
        } else if (distancePct < 3) {
            score = 18;
            signals.push(`🟢 Cerca de soporte $${nearestSupport.toLocaleString()} (<3%)`);
        } else if (distancePct < 5) {
            score = 12;
            signals.push(`🟡 Soporte $${nearestSupport.toLocaleString()} a ${distancePct.toFixed(1)}%`);
        } else if (distancePct < 8) {
            score = 6;
            signals.push(`🟡 Soporte $${nearestSupport.toLocaleString()} a ${distancePct.toFixed(1)}%`);
        } else {
            score = 3;
            signals.push(`🟠 Lejos de soporte (${distancePct.toFixed(1)}%)`);
        }

        // Bonus si rebotó del low reciente
        if (market.price > market.low7d * 1.02) {
            const bouncePct = ((market.price / market.low7d) - 1) * 100;
            if (bouncePct > 2 && bouncePct < 10) {
                score = Math.min(25, score + 3);
                signals.push(`🟢 Rebotó ${bouncePct.toFixed(1)}% desde mínimo 7d`);
            }
        }

        return { score, signals };
    }

    scoreTiming(market: MarketData, options: OptionsData): { score: number; signals: string[] } {
        let score = 0;
        const signals: string[] = [];

        const change7d = ((market.price / market.price7dAgo) - 1) * 100;
        const distFromLow = ((market.price / market.low7d) - 1) * 100;

        if (change7d < -10 && distFromLow < 3) {
            score = 10;
            signals.push('🟠 Crash reciente, aún cerca del mínimo - Esperar estabilización');
        } else if (change7d < -10 && distFromLow > 3 && distFromLow < 8) {
            score = 22;
            signals.push('🟢 Post-crash estabilizándose - Buen timing');
        } else if (change7d < -5 && distFromLow > 2 && distFromLow < 6) {
            score = 20;
            signals.push('🟢 Corrección con rebote inicial - Timing aceptable');
        } else if (change7d > -5 && change7d < 5) {
            score = 15;
            signals.push('🟡 Mercado lateral - Timing neutral');
        } else if (change7d > 10) {
            score = 5;
            signals.push('🟠 Ya subió mucho (+10% 7d) - Posible tarde');
        } else {
            score = 12;
        }

        // Bonus si IV está normalizada post-caída
        if (options.ivPercentile < 50 && change7d < -5) {
            score = Math.min(25, score + 5);
            signals.push('🟢 IV normalizada post-caída - Timing óptimo');
        }

        return { score, signals };
    }

    findNearestSupport(price: number): number {
        const supports = this.config.levels.supports;
        const supportsBelow = supports.filter(s => s < price);
        return supportsBelow.length > 0 ? Math.max(...supportsBelow) : supports[0];
    }

    distanceToSupport(price: number): number {
        const nearest = this.findNearestSupport(price);
        return ((price - nearest) / price) * 100;
    }

    getRecommendation(score: number, signals: string[]): string {
        const redFlags = signals.filter(s => s.includes('🔴')).length;
        const greenFlags = signals.filter(s => s.includes('🟢')).length;

        if (redFlags >= 2) return '❌ AVOID';
        if (score >= 80 && greenFlags >= 4) return '🟢 STRONG BUY';
        if (score >= 70 && greenFlags >= 3) return '🟢 BUY';
        if (score >= 55) return '🟡 WAIT - Close to opportunity';
        if (score >= 40) return '🟡 WAIT';
        return '🔴 NOT NOW';
    }
}

// ============================================================
// TELEGRAM NOTIFIER - Alertas
// ============================================================

class TelegramNotifier {
    private token: string;
    private chatId: string;
    private baseUrl: string;

    constructor(config: typeof CONFIG) {
        this.token = config.telegram.botToken;
        this.chatId = config.telegram.chatId;
        this.baseUrl = `https://api.telegram.org/bot${this.token}`;
    }

    async sendAlert(score: ScoreResult, market: MarketData, options: OptionsData): Promise<void> {
        const maxRisk = CONFIG.risk.capital * (CONFIG.risk.riskPercent / 100);

        const message = `
🚨 *BTC OPTIONS ALERT* 🚨

*Score Total: ${score.totalScore}/100*
*Recomendación: ${score.recommendation}*

━━━━━━━━━━━━━━━━━━━━━
📊 *MERCADO*
• Precio BTC: $${market.price.toLocaleString()}
• Cambio 24h: ${(((market.price / market.price24hAgo) - 1) * 100).toFixed(1)}%
• Cambio 7d: ${(((market.price / market.price7dAgo) - 1) * 100).toFixed(1)}%
• Low 7d: $${market.low7d.toLocaleString()}

━━━━━━━━━━━━━━━━━━━━━
📈 *OPCIONES*
• IV ATM: ${options.ivAtm.toFixed(1)}%
• IV Percentil: ${options.ivPercentile.toFixed(0)}%
• Put/Call Ratio: ${options.putCallRatio.toFixed(2)}
${options.maxPain ? `• Max Pain: $${options.maxPain.toLocaleString()}` : ''}

━━━━━━━━━━━━━━━━━━━━━
🎯 *SCORES*
• IV Score: ${score.ivScore}/25
• Technical: ${score.technicalScore}/25
• Support: ${score.supportScore}/25
• Timing: ${score.timingScore}/25

━━━━━━━━━━━━━━━━━━━━━
📋 *SEÑALES*
${score.signals.join('\n')}

━━━━━━━━━━━━━━━━━━━━━
💰 *SIZING (Regla ${CONFIG.risk.riskPercent}%)*
• Capital: $${CONFIG.risk.capital.toLocaleString()}
• Riesgo máx: $${maxRisk.toLocaleString()}
• Si prima ~$2,500/BTC → ~${(maxRisk / 2500).toFixed(2)} contratos

━━━━━━━━━━━━━━━━━━━━━
⏰ ${new Date().toISOString()}
`;

        await this.sendMessage(message);
    }

    async sendStartupMessage(): Promise<void> {
        const message = `
🤖 *Bot de Opciones BTC Iniciado*

Configuración:
• Check cada: ${CONFIG.strategy.checkIntervalMinutes} min
• IV máxima: ${CONFIG.strategy.ivThresholdMax}%
• Score mínimo para alerta: ${CONFIG.strategy.minScoreAlert}
• Capital: $${CONFIG.risk.capital.toLocaleString()}
• Riesgo por trade: ${CONFIG.risk.riskPercent}%

Soportes monitoreados:
${CONFIG.levels.supports.map(s => `$${s.toLocaleString()}`).join(', ')}

Bot activo y monitoreando... 👀
`;
        await this.sendMessage(message);
    }

    async sendMessage(text: string): Promise<void> {
        if (!this.token || this.token === 'TU_BOT_TOKEN_AQUI') {
            console.log('⚠️ Telegram no configurado. Mensaje:');
            console.log(text);
            return;
        }

        try {
            await axios.post(`${this.baseUrl}/sendMessage`, {
                chat_id: this.chatId,
                text: text,
                parse_mode: 'Markdown',
            });
        } catch (error) {
            console.error('Error enviando a Telegram:', (error as Error).message);
        }
    }
}

// ============================================================
// BOT PRINCIPAL
// ============================================================

class OptionsAlertBot {
    private config: typeof CONFIG;
    private fetcher: DataFetcher;
    private scoring: ScoringEngine;
    private notifier: TelegramNotifier;
    private lastAlertScore = 0;
    private lastAlertTime: Date | null = null;

    constructor(config: typeof CONFIG) {
        this.config = config;
        this.fetcher = new DataFetcher();
        this.scoring = new ScoringEngine(config);
        this.notifier = new TelegramNotifier(config);
    }

    async run(): Promise<void> {
        console.log(`
    ╔═══════════════════════════════════════════════════════════╗
    ║                                                           ║
    ║   🤖 BTC OPTIONS ALERT BOT (Node.js)                      ║
    ║                                                           ║
    ║   Detecta oportunidades para comprar CALLs                ║
    ║   basado en IV, técnicos, soportes y timing               ║
    ║                                                           ║
    ╚═══════════════════════════════════════════════════════════╝
        `);

        await this.notifier.sendStartupMessage();

        // Primera revisión inmediata
        await this.checkMarket();

        // Loop continuo
        setInterval(async () => {
            try {
                await this.checkMarket();
            } catch (error) {
                console.error('Error en check:', (error as Error).message);
            }
        }, this.config.strategy.checkIntervalMinutes * 60 * 1000);
    }

    async checkMarket(): Promise<void> {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`🔍 Checking market... ${new Date().toLocaleTimeString()}`);

        try {
            // Obtener datos
            const market = await this.fetcher.getBinancePrice();
            const options = await this.fetcher.getBinanceOptionsIV();
            const technicals = await this.fetcher.calculateTechnicals(market);

            // Calcular score
            const score = this.scoring.calculateScore(market, options, technicals);

            // Mostrar resumen
            this.printSummary(score, market, options);

            // Decidir si alertar
            if (this.shouldAlert(score)) {
                await this.notifier.sendAlert(score, market, options);
                this.lastAlertScore = score.totalScore;
                this.lastAlertTime = new Date();
                console.log('📤 Alerta enviada!');
            }
        } catch (error) {
            console.error('Error en checkMarket:', (error as Error).message);
        }
    }

    printSummary(score: ScoreResult, market: MarketData, options: OptionsData): void {
        console.log(`
┌─────────────────────────────────────────────────────────────┐
│  BTC: $${market.price.toLocaleString().padEnd(10)} │  IV: ${options.ivAtm.toFixed(1).padEnd(6)}%  │  Score: ${score.totalScore}/100  │
├─────────────────────────────────────────────────────────────┤
│  IV: ${String(score.ivScore).padStart(2)}/25  │  Tech: ${String(score.technicalScore).padStart(2)}/25  │  Supp: ${String(score.supportScore).padStart(2)}/25  │  Time: ${String(score.timingScore).padStart(2)}/25  │
├─────────────────────────────────────────────────────────────┤
│  Recomendación: ${score.recommendation.padEnd(42)}│
${options.maxPain ? `│  Max Pain: $${options.maxPain.toLocaleString().padEnd(47)}│\n` : ''}└─────────────────────────────────────────────────────────────┘
        `);

        for (const signal of score.signals) {
            console.log(`  ${signal}`);
        }
    }

    shouldAlert(score: ScoreResult): boolean {
        const minScore = this.config.strategy.minScoreAlert;

        // Siempre alertar si es STRONG BUY
        if (score.recommendation.includes('STRONG BUY')) {
            return true;
        }

        // Alertar si score supera mínimo
        if (score.totalScore >= minScore) {
            // Evitar spam
            if (this.lastAlertTime) {
                const timeSinceLast = Date.now() - this.lastAlertTime.getTime();
                const twoHours = 2 * 60 * 60 * 1000;

                if (timeSinceLast < twoHours) {
                    if (Math.abs(score.totalScore - this.lastAlertScore) < 10) {
                        return false;
                    }
                }
            }
            return true;
        }

        return false;
    }
}

// ============================================================
// PUNTO DE ENTRADA
// ============================================================

const bot = new OptionsAlertBot(CONFIG);
bot.run().catch(console.error);
