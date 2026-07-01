import type { EventTransportProvider } from './types.js';
import { kafkaTransport } from './kafka.transport.js';

/**
 * Redpanda adapter — wire-compatible with Kafka, so we reuse the kafkajs-based
 * implementation. The differences with Kafka are operational (idempotent
 * producers are on by default; brokers don't need ZooKeeper) rather than at
 * the protocol layer — kafkajs talks to a Redpanda broker without changes.
 *
 * Exists as its own `name` so `xenosis graph` and the dev dashboard can show
 * "this binding goes to Redpanda" instead of "kafka" — useful when a workspace
 * mixes both, or when a service later wants to swap the broker without code
 * changes.
 */
export const redpandaTransport: EventTransportProvider = {
  name: 'redpanda',

  async createProducer(rawConfig, deps) {
    return kafkaTransport.createProducer(rawConfig, deps);
  },

  async createConsumer(rawConfig, deps) {
    return kafkaTransport.createConsumer(rawConfig, deps);
  },
};
