'use client'
import NextLink, { useLinkStatus } from 'next/link'
import { usePathname } from 'next/navigation'
import type { ComponentProps } from 'react'

function PendingIndicator() {
  const { pending } = useLinkStatus()
  return (
    <>
      <span
        className="link-pending-indicator"
        data-navigation-pending={pending}
        aria-hidden="true"
      />
      {pending && (
        <span className="sr-only" role="status">
          Opening page…
        </span>
      )}
    </>
  )
}
export function MotionLink({
  children,
  className = '',
  transitionTypes,
  ...props
}: ComponentProps<typeof NextLink>) {
  const path = usePathname()
  const target =
    typeof props.href === 'string' ? props.href : (props.href.pathname ?? path)
  const depth = (value: string) =>
    value.split(/[?#]/)[0].split('/').filter(Boolean).length
  const direction = depth(target) < depth(path) ? 'nav-back' : 'nav-forward'
  return (
    <NextLink
      {...props}
      transitionTypes={transitionTypes ?? [direction]}
      className={`motion-link ${className}`}
    >
      {children}
      <PendingIndicator />
    </NextLink>
  )
}
