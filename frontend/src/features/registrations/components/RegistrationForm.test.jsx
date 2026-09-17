import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import RegistrationForm from './RegistrationForm'

// Field shape taken from the Tech Connect 2026 seed event (event aaaaaaaa-0001).
// Using real field IDs ensures the form is tested against the shape the API returns.
const FIELDS = [
  { id: 'full_name', label: 'Full name', type: 'text', required: true },
  { id: 'dietary', label: 'Dietary requirements', type: 'text', required: false },
]

describe('RegistrationForm', () => {
  it('calls onSubmit with trimmed field values on submit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<RegistrationForm fields={FIELDS} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('Full name'), '  Alice  ')
    await user.type(screen.getByLabelText('Dietary requirements'), 'none')
    await user.click(screen.getByRole('button', { name: /register/i }))

    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledWith({ full_name: 'Alice', dietary: 'none' })
  })

  it('passes null for an empty optional field', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<RegistrationForm fields={FIELDS} onSubmit={onSubmit} />)

    await user.type(screen.getByLabelText('Full name'), 'Bob')
    await user.click(screen.getByRole('button', { name: /register/i }))

    expect(onSubmit).toHaveBeenCalledWith({ full_name: 'Bob', dietary: null })
  })

  it('disables inputs and button while busy', () => {
    render(<RegistrationForm fields={FIELDS} onSubmit={vi.fn()} busy />)
    expect(screen.getByLabelText('Full name')).toBeDisabled()
    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.getByRole('button')).toHaveTextContent('Registering…')
  })

  it('does not call onSubmit while disabled', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(<RegistrationForm fields={FIELDS} onSubmit={onSubmit} disabled />)
    await user.click(screen.getByRole('button'))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
