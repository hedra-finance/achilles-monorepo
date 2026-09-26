'use client'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { useMotionPreference } from './Motion'

/** The original emblem is preserved in an eight-second, locally rendered film. */
export function LogoSurface() {
  const video = useRef<HTMLVideoElement>(null)
  const { paused, reduced } = useMotionPreference()
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const element = video.current
    if (!element || failed) return
    let visible = false
    let disposed = false
    const sync = () => {
      if (
        paused ||
        reduced ||
        matchMedia('(prefers-reduced-motion: reduce)').matches ||
        document.hidden ||
        !visible
      ) {
        element.pause()
      } else {
        void element.play().catch(() => {
          if (!disposed) setReady(false)
        })
      }
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting
        sync()
      },
      { threshold: 0.1 }
    )
    observer.observe(element)
    document.addEventListener('visibilitychange', sync)
    sync()
    return () => {
      disposed = true
      observer.disconnect()
      document.removeEventListener('visibilitychange', sync)
      element.pause()
    }
  }, [paused, reduced, failed])
  return (
    <div className="engine-art logo-film">
      <Image
        className="logo-poster"
        src="/brand/achilles.png"
        alt="Achilles"
        width={1302}
        height={998}
        priority
        sizes="(max-width: 760px) 250px, 350px"
      />
      {!failed && (
        <video
          ref={video}
          className="logo-video"
          data-ready={ready}
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
          onPlaying={() => setReady(true)}
          onError={() => {
            setFailed(true)
            setReady(false)
          }}
        >
          <source src="/brand/achilles-loop.webm" type="video/webm" />
          <source src="/brand/achilles-loop.mp4" type="video/mp4" />
        </video>
      )}
    </div>
  )
}
