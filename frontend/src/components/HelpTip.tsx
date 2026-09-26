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
  const [position, setPosition] = useState<{
    top: number
    left: number
  } | null>(null)
  function show() {
    const rect = trigger.current?.getBoundingClientRect()
    if (rect)
      setPosition({
        top: Math.min(rect.bottom + 8, innerHeight - 160),
        left: Math.max(12, Math.min(rect.left - 120, innerWidth - 280))
      })
  }
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
    const close = () => setPosition(null)
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
  }, [position])
  return (
    <span className="help-tip">
      <button
        ref={trigger}
        type="button"
        className="help-trigger"
        aria-label={label}
        aria-describedby={position ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={() => setPosition(null)}
        onFocus={show}
        onBlur={() => setPosition(null)}
        onClick={show}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            setPosition(null)
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
            style={position}
          >
            {children}
          </span>,
          document.body
        )}
    </span>
  )
}
