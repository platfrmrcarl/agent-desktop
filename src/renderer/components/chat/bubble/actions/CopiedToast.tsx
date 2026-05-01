export interface CopiedToastProps {
  position: { x: number; y: number }
}

export function CopiedToast({ position }: CopiedToastProps) {
  return (
    <div
      className="fixed z-50 px-2 py-1 rounded shadow-lg text-[0.6875rem] font-medium pointer-events-none -translate-x-1/2 -translate-y-full"
      style={{
        left: position.x,
        top: position.y - 8,
        backgroundColor: 'var(--color-accent)',
        color: 'var(--color-contrast)',
      }}
    >
      Copied!
    </div>
  )
}
