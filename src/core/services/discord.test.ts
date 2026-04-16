import { describe, it, expect, beforeEach } from 'vitest'
import { splitMessage, getChannelConversations, _handleAskUserChunk, _buildModalForQuestions } from './discord'
import type { AskUserQuestion } from '../types'

describe('discord', () => {
  describe('splitMessage', () => {
    it('returns single chunk for short messages', () => {
      expect(splitMessage('hello')).toEqual(['hello'])
    })

    it('splits long messages on newlines', () => {
      const line = 'a'.repeat(1900)
      const text = `${line}\n${'b'.repeat(200)}`
      const chunks = splitMessage(text)
      expect(chunks.length).toBe(2)
      expect(chunks[0]).toBe(line)
    })
  })

  describe('handleAskUserChunk', () => {
    beforeEach(() => {
      getChannelConversations().clear()
    })

    it('ignores payloads without conversationId', () => {
      // Should not throw
      _handleAskUserChunk({ type: 'ask_user', requestId: 'abc' })
    })

    it('ignores payloads for unbound conversations', () => {
      // No channel bound to conversation 999
      _handleAskUserChunk({
        type: 'ask_user',
        conversationId: 999,
        requestId: 'abc',
        questions: '[]',
      })
      // Should not throw — silently ignored
    })

    it('ignores payloads with invalid questions JSON', () => {
      getChannelConversations().set('ch1', 42)
      // Invalid JSON should be caught internally
      _handleAskUserChunk({
        type: 'ask_user',
        conversationId: 42,
        requestId: 'abc',
        questions: 'not-json',
      })
    })
  })

  describe('buildModalForQuestions', () => {
    const question: AskUserQuestion = {
      header: 'Auth method',
      question: 'Which auth method?',
      options: [
        { label: 'OAuth', description: 'OAuth 2.0' },
        { label: 'JWT', description: 'JSON Web Tokens' },
      ],
      multiSelect: false,
    }

    it('creates modal with correct customId', () => {
      const modal = _buildModalForQuestions('req-123', [question], [0])
      expect(modal.data.custom_id).toBe('askuser_submit_req-123')
    })

    it('creates modal with title', () => {
      const modal = _buildModalForQuestions('req-123', [question], [0])
      expect(modal.data.title).toBe('Réponse')
    })

    it('creates one text input per question', () => {
      const q2: AskUserQuestion = {
        header: 'Library',
        question: 'Which library?',
        options: [],
        multiSelect: false,
      }
      const modal = _buildModalForQuestions('req-123', [question, q2], [0, 1])
      expect(modal.components.length).toBe(2)
    })

    it('limits to 5 text inputs', () => {
      const questions = Array.from({ length: 7 }, (_, i) => ({
        header: `Q${i}`,
        question: `Question ${i}?`,
        options: [],
        multiSelect: false,
      })) as AskUserQuestion[]
      const indices = questions.map((_, i) => i)
      const modal = _buildModalForQuestions('req-123', questions, indices)
      expect(modal.components.length).toBe(5)
    })

    it('sets placeholder from options', () => {
      const modal = _buildModalForQuestions('req-123', [question], [0])
      const inputRow = modal.components[0]
      const input = inputRow.components[0]
      expect(input.data.placeholder).toBe('OAuth, JWT')
    })

    it('truncates label to 45 chars', () => {
      const longQ: AskUserQuestion = {
        header: 'A'.repeat(100),
        question: 'test',
        options: [],
        multiSelect: false,
      }
      const modal = _buildModalForQuestions('req-123', [longQ], [0])
      const input = modal.components[0].components[0]
      expect(input.data.label!.length).toBeLessThanOrEqual(45)
    })
  })
})
