'use client'

export default function GlobalError() {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: '#090e18',
          color: '#eef3fc',
          fontFamily: 'system-ui, sans-serif'
        }}
      >
        <main
          style={{
            maxWidth: 560,
            margin: '12vh auto',
            padding: 24,
            lineHeight: 1.7
          }}
        >
          <p style={{ color: '#82beeb', letterSpacing: 3 }}>ACHILLES</p>
          <h1>Unable to open the app</h1>
          <p>
            Reload to reconnect. If you submitted a transaction, check its
            status in your wallet before submitting another request.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '12px 22px',
              borderRadius: 8,
              border: '1px solid #78bbef',
              background: '#1767cb',
              color: 'white',
              font: 'inherit',
              cursor: 'pointer'
            }}
          >
            Reload app
          </button>
        </main>
      </body>
    </html>
  )
}
