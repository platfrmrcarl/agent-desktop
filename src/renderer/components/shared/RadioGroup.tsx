interface RadioOption<T extends string> {
  value: T
  label: string
  hint?: string
}

interface RadioGroupProps<T extends string> {
  legend: string
  name: string
  value: T
  onChange: (value: T) => void
  options: ReadonlyArray<RadioOption<T>>
}

export function RadioGroup<T extends string>({ legend, name, value, onChange, options }: RadioGroupProps<T>) {
  const hasHints = options.some((o) => o.hint !== undefined)
  return (
    <fieldset className="border-0 p-0 m-0">
      <legend className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
        {legend}
      </legend>
      <div className="flex flex-col gap-1.5">
        {options.map(({ value: optValue, label, hint }) => (
          <label key={optValue} className={`flex ${hasHints ? 'items-start' : 'items-center'} gap-2 cursor-pointer`}>
            <input
              type="radio"
              name={name}
              checked={value === optValue}
              onChange={() => onChange(optValue)}
              className={`accent-[var(--color-primary)]${hasHints ? ' mt-1' : ''}`}
            />
            {hint !== undefined ? (
              <span className="flex flex-col">
                <span className="text-sm" style={{ color: 'var(--color-text)' }}>{label}</span>
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{hint}</span>
              </span>
            ) : (
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>{label}</span>
            )}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
