'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

export default function PageError({ retry }: { retry: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const queries = useQueryClient()
  useEffect(() => heading.current?.focus(), [])

  return (
    <section
      className="card empty-state content-enter"
      aria-labelledby="page-error-title"
    >
      <h1 id="page-error-title" ref={heading} tabIndex={-1}>
        Unable to display this page
      </h1>
      <p>
        Try loading the page again. If you submitted a transaction, check its
        status in your wallet before submitting another request.
      </p>
      <button
        className="btn primary"
        onClick={() => {
          // Discard failed read snapshots; never clear pending transaction records.
          void queries.resetQueries()
          retry()
        }}
      >
        Try again
      </button>
    </section>
  )
}
