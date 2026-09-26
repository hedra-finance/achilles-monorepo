'use client'
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  ViewTransition,
  type ReactNode
} from 'react'
import { Icon } from './Icon'

const MotionContext = createContext({
  paused: false,
  reduced: false,
  toggle: () => {}
})
const media = '(prefers-reduced-motion: reduce)'
const subscribe = (change: () => void) => {
  const query = window.matchMedia(media)
  query.addEventListener('change', change)
  return () => query.removeEventListener('change', change)
}

export function MotionProvider({ children }: { children: ReactNode }) {
  const [paused, setPaused] = useState(false)
  const reduced = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(media).matches,
    () => false
  )
  useEffect(() => {
    document.documentElement.dataset.motion =
      paused || reduced ? 'paused' : 'running'
  }, [paused, reduced])
  useEffect(() => {
    const root = document.documentElement
    root.dataset.viewTransitions = String('startViewTransition' in document)
    const update = () => {
      root.dataset.pageVisible = String(!document.hidden)
    }
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return (
    <MotionContext.Provider
      value={{ paused, reduced, toggle: () => setPaused((v) => !v) }}
    >
      {children}
    </MotionContext.Provider>
  )
}

export function useMotionPreference() {
  return useContext(MotionContext)
}

export function MotionToggle() {
  const { paused, reduced, toggle } = useContext(MotionContext)
  return (
    <button
      type="button"
      className="motion-toggle"
      onClick={toggle}
      disabled={reduced}
      aria-pressed={paused || reduced}
      aria-label={
        reduced
          ? 'Reduced motion follows your system preference'
          : paused
            ? 'Resume animations'
            : 'Pause animations'
      }
    >
      <Icon name={paused || reduced ? 'play' : 'pause'} size={12} />
      {reduced ? 'Reduced motion' : paused ? 'Resume motion' : 'Pause motion'}
    </button>
  )
}

/** One page boundary: routing owns navigation; motion never delays or intercepts it. */
export function PageMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const { paused, reduced } = useContext(MotionContext)
  useEffect(() => {
    const element = root.current
    if (!element || paused || reduced || !('IntersectionObserver' in window))
      return
    const targets = element.querySelectorAll<HTMLElement>('[data-reveal]')
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.remove('reveal-pending')
            entry.target.classList.add('reveal-arrived')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.08, rootMargin: '0px 0px -24px 0px' }
    )
    targets.forEach((target) => {
      // Do not hide content already in view, focused, or targeted by an anchor.
      if (
        target.getBoundingClientRect().top >= innerHeight &&
        !target.classList.contains('reveal-arrived') &&
        !target.contains(document.activeElement)
      ) {
        target.classList.add('reveal-pending')
        observer.observe(target)
      }
    })
    return () => {
      observer.disconnect()
      targets.forEach((target) => target.classList.remove('reveal-pending'))
    }
  }, [paused, reduced])
  const classes = {
    'nav-forward': 'page-forward',
    'nav-back': 'page-back',
    default: 'page-fade'
  }
  return (
    <ViewTransition
      name="achilles-page"
      share={classes}
      enter={classes}
      exit={classes}
      default="none"
    >
      <div ref={root} className="page-motion">
        {children}
      </div>
    </ViewTransition>
  )
}

/** Stop ambient animation when its visual is offscreen. */
export function AmbientMotion({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver(([entry]) => {
      element.dataset.ambient = entry.isIntersecting ? 'running' : 'paused'
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <div className="ambient-motion" ref={ref} data-ambient="running">
      {children}
    </div>
  )
}
