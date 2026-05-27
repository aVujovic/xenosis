import { describe, it, expect, expectTypeOf } from 'vitest';
import { z } from 'zod';
import { defineSocketApi } from './defineSocketApi';
import type { SocketHandler, MessageBody } from './types';

describe('defineSocketApi', () => {
  // Tiny shared API used across the type-level assertions below.
  const chatApi = defineSocketApi({
    name: 'chat',
    path: '/ws/chat',
    clientMessages: {
      sendMessage: z.object({ roomId: z.string(), text: z.string().min(1) }),
      typing: z.object({ roomId: z.string(), typing: z.boolean() }),
    },
    serverMessages: {
      message: z.object({
        type: z.literal('message'),
        roomId: z.string(),
        userId: z.string(),
        text: z.string(),
      }),
    },
    channels: {
      room: { paramSchema: z.object({ roomId: z.string() }) },
      global: {},
    },
  });

  // ── runtime assertions ─────────────────────────────────────────────────
  it('preserves the definition object as-is', () => {
    expect(chatApi.name).toBe('chat');
    expect(chatApi.path).toBe('/ws/chat');
    expect(Object.keys(chatApi.clientMessages)).toEqual(['sendMessage', 'typing']);
    expect(Object.keys(chatApi.serverMessages)).toEqual(['message']);
    expect(Object.keys(chatApi.channels)).toEqual(['room', 'global']);
  });

  it('rejects definitions with a missing name', () => {
    expect(() =>
      defineSocketApi({
        name: '',
        path: '/ws/x',
        clientMessages: {},
        serverMessages: {},
        channels: {},
      }),
    ).toThrow(/name.*required/i);
  });

  it('rejects definitions whose path does not start with /', () => {
    expect(() =>
      defineSocketApi({
        name: 'x',
        path: 'ws/x',
        clientMessages: {},
        serverMessages: {},
        channels: {},
      }),
    ).toThrow(/path.*must start with/i);
  });

  // ── type-level assertions ──────────────────────────────────────────────
  // These don't run any code — they fail at type-check time if the inferred
  // shapes regress. `expectTypeOf` is vitest's static type assertion.

  it('infers clientMessages body types', () => {
    type SendMessageBody = MessageBody<typeof chatApi.clientMessages.sendMessage>;
    expectTypeOf<SendMessageBody>().toEqualTypeOf<{ roomId: string; text: string }>();
  });

  it('SocketHandler enforces a method per clientMessage', () => {
    // Valid implementation — TS accepts this.
    type Handler = SocketHandler<typeof chatApi>;
    const okHandler: Handler = {
      async sendMessage(_ctx, body) {
        // body is inferred from sendMessageSchema
        expectTypeOf(body).toEqualTypeOf<{ roomId: string; text: string }>();
      },
      async typing(_ctx, body) {
        expectTypeOf(body).toEqualTypeOf<{ roomId: string; typing: boolean }>();
      },
    };
    // The optional lifecycle hooks aren't required; the literal above
    // compiles without them.
    expect(typeof okHandler.sendMessage).toBe('function');
  });
});
