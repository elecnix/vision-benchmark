import { generateUISamples } from '../src/generators/ui-widgets.js';
import { writeFileSync } from 'fs';

(async () => {
  const titles: Record<string, string> = {};
  for await (const sample of generateUISamples({ sizes: [{ width: 512, height: 512 }], densities: ['sparse', 'normal', 'dense'], variationsPerDensity: 4, seed: 42 })) {
    titles[sample.id] = (sample.groundTruth as any).title;
  }
  console.log(JSON.stringify(titles, null, 2));
})();