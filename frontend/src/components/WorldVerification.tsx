'use client'
import { useRef } from 'react'
import {
  IDKitRequestWidget,
  proofOfHuman,
  type RpContext
} from '@worldcoin/idkit'

export type WorldContext = {
  app_id: `app_${string}`
  action: string
  environment: 'production' | 'staging'
  rp_context: RpContext
}

export default function WorldVerification({
  context,
  address,
  verify,
  fail,
  close
}: {
  context: WorldContext
  address: string
  verify: (proof: unknown) => Promise<boolean>
  fail: (errorCode: string) => void
  close: (completed: boolean) => void
}) {
  const completed = useRef(false)
  return (
    <IDKitRequestWidget
      open
      onOpenChange={(open) => {
        if (!open) close(completed.current)
      }}
      app_id={context.app_id}
      action={context.action}
      environment={context.environment}
      rp_context={context.rp_context}
      preset={proofOfHuman({ signal: address })}
      allow_legacy_proofs={false}
      handleVerify={async (proof) => {
        const ok = await verify(proof)
        if (!ok)
          throw new Error('Senior access could not be confirmed. Please retry.')
        completed.current = true
      }}
      onError={(errorCode) => {
        fail(String(errorCode))
        // A new attempt must fetch a fresh signed RP context, not reuse this nonce.
        close(false)
      }}
      onSuccess={() => close(true)}
    />
  )
}
