// Tests have moved to src/core/utils/volume.test.ts — the canonical volume module is now there.
// The re-export shim at src/main/utils/volume.ts re-exports everything from core,
// so all consumers (quickChat.ts, tts.ts) continue to work without change.
import { describe, it } from 'vitest'

describe('volume (shim)', () => {
  it.todo('see src/core/utils/volume.test.ts for all tests')
})
