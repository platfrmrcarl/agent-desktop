import type { IntervalUnit } from '../../../../shared/types'

export interface ScheduleSectionProps {
  intervalValue: number
  intervalUnit: IntervalUnit
  scheduleTime: string
  onIntervalValueChange: (v: number) => void
  onIntervalUnitChange: (v: IntervalUnit) => void
  onScheduleTimeChange: (v: string) => void
}

const inputStyle = {
  backgroundColor: 'var(--color-bg)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-text-muted)/20',
}

export function ScheduleSection({
  intervalValue,
  intervalUnit,
  scheduleTime,
  onIntervalValueChange,
  onIntervalUnitChange,
  onScheduleTimeChange,
}: ScheduleSectionProps) {
  const hours = scheduleTime ? scheduleTime.split(':')[0] : ''
  const minutes = scheduleTime ? scheduleTime.split(':')[1] : ''

  function handleHoursChange(raw: string) {
    const h = Math.max(0, Math.min(23, Number(raw)))
    const m = scheduleTime ? scheduleTime.split(':')[1] || '00' : '00'
    onScheduleTimeChange(`${String(h).padStart(2, '0')}:${m}`)
  }

  function handleMinutesChange(raw: string) {
    const m = Math.max(0, Math.min(59, Number(raw)))
    const h = scheduleTime ? scheduleTime.split(':')[0] || '00' : '00'
    onScheduleTimeChange(`${h}:${String(m).padStart(2, '0')}`)
  }

  return (
    <>
      {/* Frequency */}
      <div>
        <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
          Frequency
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Every</span>
          <input
            type="number"
            min={1}
            value={intervalValue}
            onChange={(e) => onIntervalValueChange(Math.max(1, Number(e.target.value)))}
            className="w-20 px-3 py-2 rounded text-sm outline-none"
            style={inputStyle}
          />
          <select
            value={intervalUnit}
            onChange={(e) => onIntervalUnitChange(e.target.value as IntervalUnit)}
            className="px-3 py-2 rounded text-sm outline-none"
            style={inputStyle}
          >
            <option value="minutes">minute(s)</option>
            <option value="hours">hour(s)</option>
            <option value="days">day(s)</option>
          </select>
        </div>
      </div>

      {/* Time of day — shown for daily tasks */}
      {intervalUnit === 'days' && (
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
            Time of day
          </label>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={23}
                value={hours}
                onChange={(e) => handleHoursChange(e.target.value)}
                placeholder="HH"
                className="w-16 px-3 py-2 rounded text-sm outline-none text-center"
                style={inputStyle}
              />
              <span className="text-sm font-bold" style={{ color: 'var(--color-text-muted)' }}>:</span>
              <input
                type="number"
                min={0}
                max={59}
                value={minutes}
                onChange={(e) => handleMinutesChange(e.target.value)}
                placeholder="MM"
                className="w-16 px-3 py-2 rounded text-sm outline-none text-center"
                style={inputStyle}
              />
            </div>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              24h format — leave empty for interval from last run
            </span>
          </div>
        </div>
      )}
    </>
  )
}
