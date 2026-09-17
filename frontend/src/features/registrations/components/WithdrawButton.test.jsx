import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import WithdrawButton from './WithdrawButton'

describe('WithdrawButton', () => {
  it('returns to initial state when cancel is clicked', async () => {
    const user = userEvent.setup()
    render(<WithdrawButton onWithdraw={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /withdraw registration/i }))
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.getByRole('button', { name: /withdraw registration/i })).toBeInTheDocument()
    expect(screen.queryByText(/are you sure/i)).not.toBeInTheDocument()
  })

  it('calls onWithdraw when confirmed', async () => {
    const user = userEvent.setup()
    const onWithdraw = vi.fn()
    render(<WithdrawButton onWithdraw={onWithdraw} />)
    await user.click(screen.getByRole('button', { name: /withdraw registration/i }))
    await user.click(screen.getByRole('button', { name: /yes, withdraw/i }))
    expect(onWithdraw).toHaveBeenCalledOnce()
  })

  it('disables confirm buttons and shows loading text while busy', async () => {
    const user = userEvent.setup()
    const onWithdraw = vi.fn()
    const { rerender } = render(<WithdrawButton onWithdraw={onWithdraw} />)
    await user.click(screen.getByRole('button', { name: /withdraw registration/i }))
    // simulate the parent setting busy=true after the user clicks confirm
    rerender(<WithdrawButton onWithdraw={onWithdraw} busy />)
    expect(screen.getByRole('button', { name: /withdrawing/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled()
  })
})
