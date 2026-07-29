# {{packageName}}

Async event contract for `{{nameKebab}}-service`. Built with
[`defineEventApi`](https://xenosis.org/docs/events/) from
`@xenosisorg/xenosis-core`.

## Using as a producer

Every binding declares an explicit `publishes` list — enforced at the
TypeScript level, at boot, and in CI (`xenosis events verify`). Publishing a
topic that isn't declared is a compile error.

```jsonc
// xenosis.config.json — the service that emits the events
{
  "events": {
    "{{nameCamel}}": {
      "package": "{{packageName}}",
      "transport": "kafka",
      "mode": "producer",
      "publishes": ["somethingHappened"]
    }
  }
}
```

```ts
import type { ProducerBus } from '@xenosisorg/xenosis-core';
import {{ApiPascal}} from '{{packageName}}';

// Narrowed to the declared publishes list — publishing anything else
// does not type-check.
type {{ApiPascal}}Producer = ProducerBus<typeof {{ApiPascal}}, 'somethingHappened'>;

class SomethingService {
  constructor(private deps: { events: { {{nameCamel}}: {{ApiPascal}}Producer } }) {}

  async doIt() {
    await this.deps.events.{{nameCamel}}.somethingHappened.publish(
      { id: 'x' },
      { id: 'x', at: new Date().toISOString() },
    );
  }
}
```

## Using as a consumer

The `consumes` list must exactly match the handler files in `src/events/` —
a missing handler or an undeclared topic is a boot error.

```jsonc
// xenosis.config.json — the service that reacts
{
  "events": {
    "{{nameCamel}}": {
      "package": "{{packageName}}",
      "transport": "kafka",
      "mode": "consumer",
      "groupId": "my-consumer-group",
      "consumes": ["somethingHappened"]
    }
  }
}
```

```ts
// src/events/SomethingHappened.event.ts
import { defineEventHandler } from '@xenosisorg/xenosis-core';
import {{ApiPascal}} from '{{packageName}}';

export default defineEventHandler(
  {{ApiPascal}}.topics.somethingHappened,
  async (payload, ctx) => {
    ctx.logger.info({ id: payload.id }, '{{nameKebab}} event received');
  },
);
```

## See also

- [`xenosis events verify --workspace`](https://xenosis.org/docs/events/) — CI check that `publishes`/`consumes` match the code (`--fix` autopopulates).
- [`xenosis graph --events --tree`](https://xenosis.org/docs/events/) — visualise producer/consumer mesh in the CLI.
- The dashboard's **Events** tab during `xenosis dev`.
