import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { SearchableModelPicker } from './SearchableModelPicker'

const options = [
  { value: 'openrouter/openai/gpt-5.4', label: 'openrouter/openai/gpt-5.4' },
  { value: 'codex/gpt-5.4', label: 'codex/gpt-5.4' },
  { value: 'claude-code/claude-haiku-4.5', label: 'claude-code/claude-haiku-4.5' },
]

describe('SearchableModelPicker', () => {
  it('opens with a searchable, scrollable listbox', () => {
    render(
      <SearchableModelPicker
        value="codex/gpt-5.4"
        options={options}
        onChange={vi.fn()}
        buttonLabel="Model"
        ariaLabel="Select model"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Select model' }))

    const listbox = screen.getByRole('listbox', { name: 'Model options' })
    const list = within(listbox)
    expect(listbox.className).toContain('max-h-72')
    expect(listbox.className).toContain('overflow-y-auto')
    expect(screen.getByLabelText('Search models')).toBeInTheDocument()
    expect(list.getByText('openrouter/openai/gpt-5.4')).toBeInTheDocument()
    expect(list.getByText('codex/gpt-5.4')).toBeInTheDocument()
  })

  it('filters options by search text and selects the filtered item', () => {
    const onChange = vi.fn()

    render(
      <SearchableModelPicker
        value="codex/gpt-5.4"
        options={options}
        onChange={onChange}
        buttonLabel="Model"
        ariaLabel="Select model"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Select model' }))
    fireEvent.change(screen.getByLabelText('Search models'), { target: { value: 'haiku' } })

    const listbox = screen.getByRole('listbox', { name: 'Model options' })
    const list = within(listbox)
    expect(list.queryByText('codex/gpt-5.4')).not.toBeInTheDocument()
    expect(list.getByRole('option', { name: 'claude-code/claude-haiku-4.5' })).toBeInTheDocument()

    fireEvent.click(list.getByRole('option', { name: 'claude-code/claude-haiku-4.5' }))
    expect(onChange).toHaveBeenCalledWith('claude-code/claude-haiku-4.5')
  })
})
