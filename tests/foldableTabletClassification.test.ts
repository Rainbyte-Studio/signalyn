import { expect, it } from 'vitest';
import { classifyStrategicRelevance } from '../src/server/strategicRelevanceGate';

it.each([
  [{ title: 'Apple: Αναδιπλούμενο iPad 20 ιντσών έως 5.000 δολάρια' }, 'TABLET', 'ipad'],
  [{ title: 'Apple leak', excerpt: 'The foldable iPad is still in development.' }, 'TABLET', 'ipad'],
  [{ title: 'Apple prepares a foldable iPhone', excerpt: 'A future iPad is also in development.' }, 'SMARTPHONE', 'iphone'],
  [{ title: 'Samsung introduces a foldable phone' }, 'SMARTPHONE', 'foldable phone'],
] as const)('classifies %j using the strongest evidence in the relevant field', (input, category, keyword) => {
  const result = classifyStrategicRelevance(input);
  expect(result).toMatchObject({ decision: 'IN_SCOPE', category });
  expect(result.matchedKeywords).toContain(keyword);
});
