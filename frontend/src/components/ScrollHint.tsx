'use client'
import { useEffect, useState, type RefObject } from 'react'

/** Makes a nested scrolling panel discoverable even with auto-hiding OS scrollbars. */
export function ScrollHint({
  target,
  revision
}: {
  target: RefObject<HTMLDivElement | null>
  revision?: string
}) {
  const [more, setMore] = useState(false)
  useEffect(() => {
    const element = target.current
    if (!element) return
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        setMore(
          element.scrollHeight - element.clientHeight - element.scrollTop > 12
        )
      })
    }
    const resize = new ResizeObserver(measure)
    const observe = () => {
      resize.disconnect()
      resize.observe(element)
      for (const child of element.children) resize.observe(child)
      measure()
    }
    const mutations = new MutationObserver(observe)
    mutations.observe(element, {
      childList: true,
      subtree: true,
      characterData: true
    })
    element.addEventListener('scroll', measure, { passive: true })
    observe()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      element.removeEventListener('scroll', measure)
    }
  }, [target, revision])
  return (
    <span className="scroll-hint" aria-hidden="true" hidden={!more}>
      Scroll for more <span>↓</span>
    </span>
  )
}
