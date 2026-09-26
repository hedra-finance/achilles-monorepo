'use client'
import Image from 'next/image'
import { useEffect, useId, useRef, type PointerEvent } from 'react'

/** The artwork stays still; only light moves across its existing silhouette. */
export function LogoSurface() {
  const id = useId().replace(/:/g, '')
  const maskImage = useRef<SVGImageElement>(null)
  const light = useRef<SVGCircleElement>(null)
  const frame = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    []
  )

  function illuminate(event: PointerEvent<HTMLDivElement>) {
    if (
      event.pointerType !== 'mouse' ||
      document.documentElement.dataset.motion === 'paused' ||
      !matchMedia('(hover: hover) and (pointer: fine)').matches
    )
      return
    const element = event.currentTarget
    const bounds = element.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width) * 1302
    const y = ((event.clientY - bounds.top) / bounds.height) * 998
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      light.current?.setAttribute('cx', String(x))
      light.current?.setAttribute('cy', String(y))
      element.dataset.illuminated = 'true'
      frame.current = null
    })
  }

  return (
    <div
      className="engine-art"
      onPointerMove={illuminate}
      onPointerLeave={(event) => {
        if (frame.current !== null) cancelAnimationFrame(frame.current)
        frame.current = null
        delete event.currentTarget.dataset.illuminated
      }}
    >
      <Image
        src="/brand/achilles.png"
        alt="Achilles"
        width={1302}
        height={998}
        priority
        sizes="(max-width: 760px) 250px, 350px"
        onLoad={(event) => {
          maskImage.current?.setAttribute('href', event.currentTarget.currentSrc)
        }}
      />
      <svg className="logo-surface" viewBox="0 0 1302 998" aria-hidden="true">
        <defs>
          <mask
            id={`${id}-surface`}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="1302"
            height="998"
            style={{ maskType: 'luminance' }}
          >
            <image ref={maskImage} width="1302" height="998" />
          </mask>
          <linearGradient id={`${id}-sweep`} x1="0" y1="0" x2="1" y2="0.3">
            <stop offset="0.3" stopColor="#9cdeff" stopOpacity="0" />
            <stop offset="0.46" stopColor="#c2eaff" stopOpacity="0.2" />
            <stop offset="0.5" stopColor="#f0faff" stopOpacity="0.75" />
            <stop offset="0.56" stopColor="#96d4ff" stopOpacity="0.15" />
            <stop offset="0.7" stopColor="#96d4ff" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`${id}-pointer`}>
            <stop stopColor="#e0f5ff" stopOpacity="0.5" />
            <stop offset="0.45" stopColor="#95d2ff" stopOpacity="0.2" />
            <stop offset="1" stopColor="#95d2ff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g mask={`url(#${id}-surface)`}>
          <g className="logo-auto-light">
            <rect
              className="logo-reflection"
              width="1302"
              height="998"
              fill={`url(#${id}-sweep)`}
            />
          </g>
          <circle
            className="logo-pointer-light"
            ref={light}
            cx="651"
            cy="400"
            r="420"
            fill={`url(#${id}-pointer)`}
          />
        </g>
      </svg>
    </div>
  )
}
