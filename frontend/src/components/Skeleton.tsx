import type { ReactNode } from 'react'
import { PageMotion } from './Motion'

export function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`skeleton ${className}`} />
}
export function LoadingValue({
  loading,
  children
}: {
  loading: boolean
  children: ReactNode
}) {
  return loading ? (
    <span className="value-loading" aria-busy="true" aria-label="Loading value">
      <Skeleton />
    </span>
  ) : (
    <span className="value-ready">{children}</span>
  )
}
export function DataSkeleton({
  kind = 'rows',
  label = 'Loading data',
  rows = 3
}: {
  kind?: 'rows' | 'chart' | 'distribution' | 'metrics'
  label?: string
  rows?: number
}) {
  return (
    <div
      className={`data-skeleton skeleton-${kind}`}
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        {kind === 'chart' ? (
          <>
            <div className="skeleton-chart-grid">
              <span />
              <span />
              <span />
              <span />
              <i />
            </div>
            <div className="skeleton-axis">
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
          </>
        ) : kind === 'distribution' ? (
          <>
            <span className="skeleton-ring" />
            <div className="skeleton-legend">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i}>
                  <Skeleton className="skeleton-dot" />
                  <Skeleton />
                  <Skeleton />
                </div>
              ))}
            </div>
          </>
        ) : kind === 'metrics' ? (
          Array.from({ length: rows }, (_, i) => (
            <div className="skeleton-metric" key={i}>
              <Skeleton />
              <Skeleton className="skeleton-number" />
            </div>
          ))
        ) : (
          Array.from({ length: rows }, (_, i) => (
            <div className="skeleton-row" key={i}>
              <Skeleton className="skeleton-dot" />
              <span>
                <Skeleton />
                <Skeleton className="skeleton-short" />
              </span>
              <Skeleton />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
export function PageSkeleton({
  kind = 'catalog'
}: {
  kind?: 'catalog' | 'product' | 'account'
}) {
  return (
    <PageMotion>
      <div
        className={`page-skeleton ${kind}`}
        data-route-loading="true"
        role="status"
        aria-busy="true"
      >
        <span className="sr-only">Loading Achilles page</span>
        <div aria-hidden="true">
          <div className="skeleton-page-title">
            <Skeleton className="skeleton-short" />
            <Skeleton />
            <Skeleton />
          </div>
          <div className="skeleton-metrics">
            {[0, 1, 2].map((i) => (
              <div key={i}>
                <Skeleton />
                <Skeleton className="skeleton-number" />
              </div>
            ))}
          </div>
          <div className="skeleton-page-layout">
            <div>
              <DataSkeleton
                kind={kind === 'product' ? 'chart' : 'rows'}
                rows={kind === 'account' ? 3 : 2}
              />
              {kind === 'product' && <DataSkeleton kind="distribution" />}
            </div>
            {kind === 'product' && (
              <div className="skeleton-ticket">
                <Skeleton />
                <Skeleton />
                <Skeleton className="skeleton-number" />
                <Skeleton />
                <Skeleton />
                <Skeleton className="skeleton-button" />
              </div>
            )}
          </div>
        </div>
      </div>
    </PageMotion>
  )
}
