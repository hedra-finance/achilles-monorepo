import type { CSSProperties } from 'react'

const paths = {
  layers: 'm12 3 10 5-10 5L2 8l10-5Zm-9 9 9 4.5 9-4.5M3 16l9 4.5 9-4.5',
  wallet: 'M20 8V5H4a2 2 0 0 0 0 4h17v11H4a2 2 0 0 1-2-2V7m19 6h-5v3h5',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  external: 'M14 3h7v7m0-7L10 14m-1-9H4v15h15v-5',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',
  globe:
    'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-5v5l3 2',
  chevron: 'm9 5 7 7-7 7',
  refresh: 'M20 7a9 9 0 0 0-15-2L2 8m0-5v5h5m-3 9a9 9 0 0 0 15 2l3-3m0 5v-5h-5',
  check: 'm5 12 4 4L19 6',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 11v6m0-10v1',
  chart: 'M3 3v18h18M7 15l4-5 4 3 6-8',
  coins:
    'M16 7c0 2-3 4-7 4S2 9 2 7s3-4 7-4 7 2 7 4ZM2 7v6c0 2 3 4 7 4m-7-6v6c0 2 3 4 7 4m13-8c0 2-2 3-5 3s-5-1-5-3 2-3 5-3 5 1 5 3Zm-10 0v5c0 2 2 3 5 3s5-1 5-3v-5',
  close: 'm6 6 12 12M6 18 18 6'
} as const
export function Icon({
  name,
  size = 20,
  style
}: {
  name: keyof typeof paths
  size?: number
  style?: CSSProperties
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  )
}
