/** Company marks are served by TradingView; financial data comes from the strategy's chains. */
const STOCKS: Record<string, { logo: string; color: string }> = {
  NVDA: { logo: 'nvidia', color: '#78cba3' },
  AAPL: { logo: 'apple', color: '#afd5ed' },
  GOOGL: { logo: 'alphabet', color: '#55a8ed' },
  MSFT: { logo: 'microsoft', color: '#9b91ef' },
  MU: { logo: 'micron-technology', color: '#4ed1d3' },
  AMZN: { logo: 'amazon', color: '#efa877' },
  AMD: { logo: 'advanced-micro-devices', color: '#de83b0' },
  TSLA: { logo: 'tesla', color: '#daca7d' }
}
export function stockDisplay(ticker: string) {
  const stock = STOCKS[ticker]
  return {
    color: stock?.color ?? '#91accb',
    logo: stock
      ? `https://s3-symbol-logo.tradingview.com/${stock.logo}--600.png`
      : null
  }
}
