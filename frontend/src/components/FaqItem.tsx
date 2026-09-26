'use client'
import { useId, useState } from 'react'

export function FaqItem({
  question,
  answer
}: {
  question: string
  answer: string
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className="faq-item" data-open={open}>
      <h3 className="faq-heading">
        <button
          type="button"
          id={`${id}-question`}
          aria-expanded={open}
          aria-controls={`${id}-answer`}
          onClick={() => setOpen((value) => !value)}
        >
          {question}
          <span aria-hidden="true">+</span>
        </button>
      </h3>
      <div
        className="faq-answer"
        id={`${id}-answer`}
        role="region"
        aria-labelledby={`${id}-question`}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="faq-answer-clip">
          <p>{answer}</p>
        </div>
      </div>
    </div>
  )
}
