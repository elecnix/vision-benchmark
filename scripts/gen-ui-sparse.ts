import { generateUISamples } from '../src/generators/ui-widgets.js';
import { writeFileSync } from 'fs';

(async () => {
  for await (const sample of generateUISamples({ sizes: [{ width: 512, height: 512 }], densities: ['sparse'], variationsPerDensity: 2, seed: 100 })) {
    writeFileSync('/tmp/ui-sparse-' + sample.id + '.png', Buffer.from(sample.imageBase64, 'base64'));
    const gt = sample.groundTruth as any;
    console.log('Saved:', sample.id, '- layout:', gt.layout, '- density:', gt.density, '- widgets:', gt.widgets?.length);
  }
})();