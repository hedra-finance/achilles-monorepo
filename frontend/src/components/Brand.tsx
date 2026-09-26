import Image from 'next/image'

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand-lockup">
      <span className="brand-symbol" aria-hidden="true">
        <Image
          src="/brand/achilles.png"
          alt=""
          width={1302}
          height={998}
          priority
        />
      </span>
      {!compact && (
        <span className="brand-type">
          ACHILLES<span>STRUCTURED YIELD</span>
        </span>
      )}
    </span>
  )
}
