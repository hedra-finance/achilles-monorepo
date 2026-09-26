'use client'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
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
  useEffect(() => {
    if (!position) return
    const close = () => setPosition(null)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
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
