import type { HandleRegistrar } from '../dispatch'
import type { WebPasswordService } from '../auth'

export function registerWebServerAuthHandlers(
  registrar: HandleRegistrar,
  service: WebPasswordService,
): void {
  registrar.handle('server:setPassword', async (_event, plaintext: unknown) => {
    if (typeof plaintext !== 'string') throw new Error('password must be a string')
    await service.setPassword(plaintext)
  })

  registrar.handle('server:clearPassword', async () => {
    await service.clearPassword()
  })

  registrar.handle('server:isPasswordSet', async () => service.isPasswordSet())

  registrar.handle('server:getSessionDurationDays', async () => service.getSessionDurationDays())

  registrar.handle('server:setSessionDurationDays', async (_event, days: unknown) => {
    if (typeof days !== 'number' || !Number.isFinite(days) || days < 1) throw new Error('days must be a positive number')
    service.setSessionDurationDays(Math.floor(days))
  })

  registrar.handle('server:getRememberDurationDays', async () => service.getRememberDurationDays())

  registrar.handle('server:setRememberDurationDays', async (_event, days: unknown) => {
    if (typeof days !== 'number' || !Number.isFinite(days) || days < 1) throw new Error('days must be a positive number')
    service.setRememberDurationDays(Math.floor(days))
  })
}
