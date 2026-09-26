'use client'
import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { useMotionPreference } from './Motion'

export function HelpTip({
  label,
  children
}: {
  label: string
  children: ReactNode
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const tooltip = useRef<HTMLSpanElement>(null)
  const { paused, reduced } = useMotionPreference()
  const [closing, setClosing] = useState(false)
  const [position, setPosition] = useState<{
    top: number
    left: number
  } | null>(null)
  function show() {
    setClosing(false)
    const rect = trigger.current?.getBoundingClientRect()
    if (rect)
      setPosition({
        top: Math.min(rect.bottom + 8, innerHeight - 160),
        left: Math.max(12, Math.min(rect.left - 120, innerWidth - 280))
      })
  }
  function close() {
    if (paused || reduced) setPosition(null)
    else setClosing(true)
  }
  useEffect(() => {
    if (!closing) return
    // Also clean up when motion is disabled during an exit or the tab is hidden.
    const timer = window.setTimeout(
      () => setPosition(null),
      paused || reduced ? 0 : 160
    )
    return () => window.clearTimeout(timer)
  }, [closing, paused, reduced])
  useLayoutEffect(() => {
    if (!position || !tooltip.current || !trigger.current) return
    const anchor = trigger.current.getBoundingClientRect()
    const box = tooltip.current.getBoundingClientRect()
    const bottom = window.visualViewport
      ? window.visualViewport.offsetTop + window.visualViewport.height
      : innerHeight
    const top = Math.max(
      12,
      Math.min(
        anchor.bottom + 8 + box.height <= bottom - 12
          ? anchor.bottom + 8
          : anchor.top - box.height - 8,
        bottom - box.height - 12
      )
    )
    const left = Math.max(
      12,
      Math.min(anchor.left - box.width / 2, innerWidth - box.width - 12)
    )
    if (top !== position.top || left !== position.left)
      setPosition({ top, left })
  }, [position])
  useEffect(() => {
    if (!position) return
    const onScroll = (event: Event) => {
      const button = trigger.current
      const rect = button?.getBoundingClientRect()
      const scroller = event.target instanceof Element ? event.target : null
      const bounds = scroller?.contains(button)
        ? scroller.getBoundingClientRect()
        : { top: 0, bottom: innerHeight }
      if (
        button === document.activeElement &&
        rect &&
        rect.top >= Math.max(0, bounds.top) &&
        rect.bottom <= Math.min(innerHeight, bounds.bottom)
      ) {
        // Keyboard focus may itself scroll the trigger into view.
        show()
      } else close()
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [position, paused, reduced])
  return (
    <span className="help-tip">
      <button
        ref={trigger}
        type="button"
        className="help-trigger"
        aria-label={label}
        aria-describedby={position && !closing ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={close}
        onFocus={show}
        onBlur={close}
        onClick={show}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            close()
          }
        }}
      >
        i
      </button>
      {position &&
        createPortal(
          <span
            ref={tooltip}
            id={id}
            role="tooltip"
            className="help-content"
            data-closing={closing || undefined}
            aria-hidden={closing || undefined}
            style={position}
          >
            {children}
          </span>,
          document.body
        )}
    </span>
  )
}
