import test from 'node:test';
import assert from 'node:assert/strict';
import { patchNestJsSwagger } from 'nestjs-zod';

test('Swagger patch used during API startup loads successfully', () => {
    assert.doesNotThrow(() => patchNestJsSwagger());
});
