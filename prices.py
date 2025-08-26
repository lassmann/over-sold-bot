import yfinance as yf
from datetime import datetime
import argparse
import sys

def parse_arguments():
    parser = argparse.ArgumentParser(
        description='Consultar precios históricos de acciones usando yfinance',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Ejemplos de uso:
  python apple_prices.py AAPL 30        # Apple últimos 30 días
  python apple_prices.py GOOGL max      # Google todos los datos disponibles
  python apple_prices.py TSLA 1y        # Tesla último año (usando período predefinido)
  python apple_prices.py MSFT 365       # Microsoft últimos 365 días

Períodos predefinidos válidos: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, max

Limitaciones:
- Datos intraday: solo últimos 7-60 días
- Datos históricos: hasta ~10 años o usar 'max'
- Evitar hacer muchas consultas seguidas (riesgo de bloqueo)"""
    )
    
    parser.add_argument('ticker', 
                       help='Símbolo del ticker (ej: AAPL, GOOGL, TSLA)')
    parser.add_argument('period', 
                       help='Número de días (1-3650) o período predefinido (1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, max)')
    
    return parser.parse_args()

def validate_ticker(ticker):
    if not ticker or len(ticker.strip()) == 0:
        raise ValueError("El ticker no puede estar vacío")
    return ticker.upper().strip()

def validate_period(period_str):
    predefined_periods = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'max']
    
    if period_str.lower() in predefined_periods:
        return period_str.lower()
    
    try:
        days = int(period_str)
        if days < 1:
            raise ValueError("El número de días debe ser mayor a 0")
        if days > 3650:  # ~10 años
            raise ValueError("El número máximo de días es 3650 (~10 años). Usa 'max' para obtener todos los datos disponibles")
        return f"{days}d"
    except ValueError as e:
        if "invalid literal" in str(e):
            raise ValueError(f"Período inválido '{period_str}'. Usa un número de días (1-3650) o un período predefinido: {', '.join(predefined_periods)}")
        raise e

def main():
    try:
        args = parse_arguments()
        ticker_symbol = validate_ticker(args.ticker)
        period = validate_period(args.period)
        
        print(f"=== Precios históricos de {ticker_symbol} - {datetime.now().strftime('%Y-%m-%d %H:%M')} ===")
        print(f"Período consultado: {period}\n")
        
        stock = yf.Ticker(ticker_symbol)
        
        # Intentar obtener información básica para verificar que el ticker existe
        try:
            info = stock.info
            company_name = info.get('longName', info.get('shortName', ticker_symbol))
            print(f"📈 {company_name} ({ticker_symbol})\n")
        except:
            print(f"⚠️  Advertencia: No se pudo obtener información de la empresa para {ticker_symbol}\n")
        
        # Obtener historial
        print("Obteniendo datos históricos...")
        history = stock.history(period=period)
        
        if history.empty:
            print(f"❌ No se encontraron datos para {ticker_symbol} en el período {period}")
            print("\nPosibles causas:")
            print("- Ticker incorrecto o no existe")
            print("- Período muy amplio para este ticker")
            print("- Problemas de conexión")
            return
        
        print(f"\n📊 Datos obtenidos: {len(history)} registros")
        print(f"Período: {history.index[0].strftime('%Y-%m-%d')} a {history.index[-1].strftime('%Y-%m-%d')}\n")
        
        # Mostrar resumen
        last_price = history['Close'].iloc[-1]
        first_price = history['Close'].iloc[0]
        change = last_price - first_price
        change_percent = (change / first_price) * 100
        max_price = history['High'].max()
        min_price = history['Low'].min()
        avg_volume = history['Volume'].mean()
        
        print(f"💰 Resumen del período:")
        print(f"   Precio inicial: ${first_price:.2f}")
        print(f"   Precio final: ${last_price:.2f}")
        print(f"   Cambio total: ${change:.2f} ({change_percent:+.2f}%)")
        print(f"   Precio máximo: ${max_price:.2f}")
        print(f"   Precio mínimo: ${min_price:.2f}")
        print(f"   Volumen promedio: {avg_volume:,.0f}")
        
        # Mostrar tabla de datos
        print(f"\n📈 Historial de precios ({period}):")
        display_data = history[['Open', 'High', 'Low', 'Close', 'Volume']].copy()
        display_data[['Open', 'High', 'Low', 'Close']] = display_data[['Open', 'High', 'Low', 'Close']].round(2)
        display_data['Volume'] = display_data['Volume'].astype(int)
        
        # Mostrar solo las últimas 20 filas si hay muchos datos
        if len(display_data) > 20:
            print("(Mostrando las últimas 20 sesiones)")
            print(display_data.tail(20))
        else:
            print(display_data)
            
    except ValueError as e:
        print(f"❌ Error de validación: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error al obtener datos: {e}")
        print("\nPosibles soluciones:")
        print("- Verifica tu conexión a internet")
        print("- Confirma que el ticker sea correcto")
        print("- Intenta con un período menor")
        print("- Espera unos minutos antes de intentar nuevamente")
        sys.exit(1)

if __name__ == "__main__":
    main()