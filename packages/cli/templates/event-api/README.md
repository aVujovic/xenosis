# {{packageName}}

Async event contract for `{{nameKebab}}-service`. Built with
[`defineEventApi`](https://xenosis.org/docs/events/) from
`@xenosisorg/xenosis-core`.

## Using as a producer

```jsonc
// xenosis.config.json — the service that emits the events
{
  "events": {
    "{{nameCamel}}": {
      "package": "{{packageName}}",
      "transport": "kafka",
      "mode": "producer"
    }
  }
}
```

```ts
import type { EventBus } from '@xenosisorg/xenosis-core';
import type {{ApiPascal}} from '{{packageName}}';

class SomethingService {
  constructor(private deps: { events: { {{nameCamel}}: EventBus<typeof {{ApiPascal}}> } }) {}

  async doIt() {
    await this.deps.events.{{nameCamel}}.somethingHappened.publish(
      { id: 'x' },
      { id: 'x', at: new Date().toISOString() },
    );
  }
}
```

## Using as a consumer

```jsonc
// xenosis.config.json — the service that reacts
{
  "events": {
    "{{nameCamel}}": {
      "package": "{{packageName}}",
      "transport": "kafka",
      "mode": "consumer",
      "groupId": "my-consumer-group"
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

- [`xenosis graph --events --tree`](https://xenosis.org/docs/events/) — visualise producer/consumer mesh in the CLI.
- The dashboard's **Events** tab during `xenosis dev`.
