import { generateOCRSamples } from '../src/generators/ocr.js';
import { writeFileSync } from 'fs';

(async () => {
  const samples = [];
  for (const sample of generateOCRSamples({ sizes: [{ width: 512, height: 512 }] })) {
    samples.push(sample);
    const gt = sample.groundTruth as any;
    if (sample.id.includes('paragraph-row-bottom')) {
      writeFileSync('/tmp/ocr-row-bottom-gen.png', Buffer.from(sample.imageBase64, 'base64'));
      console.log('Saved:', sample.id);
      console.log('  desc:', sample.groundTruthDescription.slice(0, 100));
      console.log('  words:', gt.words);
      break;
    }
  }
  console.log('Total samples:', samples.length);
})();