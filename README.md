# Stock Price Analyzer con yfinance

Un script Python para consultar precios históricos de acciones usando la librería `yfinance`.

## 🚀 Instalación

### Requisitos
- Python 3.6 o superior
- pip (gestor de paquetes de Python)

### Instalar dependencias
```bash
pip install yfinance
```

## 💻 Uso

### Sintaxis básica
```bash
python prices.py <TICKER> <PERIODO>
```

### Ejemplos de uso

```bash
# Apple últimos 30 días
python prices.py AAPL 30

# Google todos los datos disponibles
python prices.py GOOGL max

# Tesla último año (usando período predefinido)
python prices.py TSLA 1y

# Microsoft últimos 365 días
python prices.py MSFT 365

# Ver ayuda
python prices.py --help
```

### Parámetros

#### TICKER
Símbolo de la acción a consultar. Ejemplos:
- `AAPL` - Apple Inc.
- `GOOGL` - Alphabet Inc. (Google)
- `TSLA` - Tesla Inc.
- `MSFT` - Microsoft Corp.
- `AMZN` - Amazon.com Inc.

#### PERIODO
Puede ser:

**Número de días** (1-3650):
- `30` - Últimos 30 días
- `365` - Último año
- `1000` - Últimos 1000 días

**Períodos predefinidos**:
- `1d` - 1 día
- `5d` - 5 días
- `1mo` - 1 mes
- `3mo` - 3 meses
- `6mo` - 6 meses
- `1y` - 1 año
- `2y` - 2 años
- `5y` - 5 años
- `10y` - 10 años
- `max` - Todos los datos disponibles

## 📊 Salida del script

El script muestra:

1. **Información de la empresa** - Nombre y símbolo
2. **Resumen del período**:
   - Precio inicial y final
   - Cambio total ($ y %)
   - Precio máximo y mínimo
   - Volumen promedio
3. **Historial de precios** - Tabla con datos OHLCV (Open, High, Low, Close, Volume)

### Ejemplo de salida
```
=== Precios históricos de AAPL - 2025-08-23 14:30 ===
Período consultado: 30d

📈 Apple Inc. (AAPL)

Obteniendo datos históricos...

📊 Datos obtenidos: 22 registros
Período: 2025-07-22 a 2025-08-22

💰 Resumen del período:
   Precio inicial: $224.18
   Precio final: $227.76
   Cambio total: $3.58 (+1.60%)
   Precio máximo: $233.12
   Precio mínimo: $209.27
   Volumen promedio: 47,234,364

📈 Historial de precios (30d):
                             Open    High     Low   Close    Volume
Date                                                               
2025-07-22 00:00:00-04:00  224.18  224.31  209.27  209.27  73621700
...
2025-08-22 00:00:00-04:00  226.17  229.09  225.41  227.76  42445300
```

## ⚠️ Limitaciones importantes

### Limitaciones de yfinance

1. **No es oficial**: yfinance no está afiliado con Yahoo Finance
2. **Riesgo de bloqueo**: Uso excesivo puede resultar en limitación de acceso
3. **Solo uso personal**: Destinado para investigación y educación
4. **Límite aproximado**: ~250 consultas antes de posible bloqueo temporal

### Limitaciones de datos

1. **Datos intraday**: Solo disponibles para los últimos 7-60 días
2. **Datos históricos**: Hasta aproximadamente 10 años (usar `max` para todos los disponibles)
3. **Intervalos válidos**: 1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, 3mo

### Recomendaciones de uso

- ✅ **Hacer**: Consultas ocasionales para análisis personal
- ✅ **Hacer**: Usar para prototipado y aprendizaje
- ✅ **Hacer**: Esperar entre consultas múltiples
- ❌ **Evitar**: Consultas automatizadas frecuentes
- ❌ **Evitar**: Uso comercial o en producción
- ❌ **Evitar**: Múltiples consultas simultáneas

## 🛠️ Funcionalidades

- ✅ Validación de parámetros de entrada
- ✅ Soporte para períodos personalizados y predefinidos
- ✅ Manejo de errores y mensajes informativos
- ✅ Resumen estadístico del período consultado
- ✅ Formateo limpio de datos OHLCV
- ✅ Limitación automática de filas mostradas (máximo 20)
- ✅ Ayuda integrada con `--help`

## 🔧 Manejo de errores

El script maneja varios tipos de errores:

### Ticker inválido
```bash
❌ Error de validación: El ticker no puede estar vacío
```

### Período inválido
```bash
❌ Error de validación: Período inválido 'abc'. Usa un número de días (1-3650) o un período predefinido: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, max
```

### Sin datos disponibles
```bash
❌ No se encontraron datos para XYZ en el período 30d

Posibles causas:
- Ticker incorrecto o no existe
- Período muy amplio para este ticker
- Problemas de conexión
```

### Error de conexión
```bash
❌ Error al obtener datos: [error details]

Posibles soluciones:
- Verifica tu conexión a internet
- Confirma que el ticker sea correcto
- Intenta con un período menor
- Espera unos minutos antes de intentar nuevamente
```

## 📝 Términos de uso

Este script utiliza yfinance, que accede a APIs públicas de Yahoo Finance. Por favor:

1. **Respeta los términos de uso** de Yahoo Finance
2. **Usa responsablemente** - evita consultas excesivas
3. **Solo uso personal** - no para aplicaciones comerciales
4. **Sin garantías** - los datos son provistos "tal como están"

## 🤝 Contribuir

Para mejoras o reportar bugs:
1. Revisa los términos de uso de yfinance
2. Asegúrate de que las modificaciones no violen las políticas de Yahoo
3. Mantén el enfoque en uso educativo y personal

---

**⚠️ Descargo de responsabilidad**: Este script es solo para propósitos educativos e investigación personal. No somos responsables por el uso indebido de los datos o violaciones de términos de servicio de terceros.