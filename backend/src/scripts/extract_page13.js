import 'dotenv/config';
import fs from 'node:fs';
import { visionCompletion } from '../lib/openai.js';

async function main() {
  const imagePath = 'C:\\Users\\DELL\\.gemini\\antigravity\\scratch\\page13.png';
  if (!fs.existsSync(imagePath)) {
    console.error('Image file does not exist:', imagePath);
    process.exit(1);
  }

  const fileBuffer = fs.readFileSync(imagePath);
  const base64 = fileBuffer.toString('base64');
  const dataUrl = `data:image/png;base64,${base64}`;

  console.log('Sending page 13 image to OpenAI Vision...');
  try {
    const result = await visionCompletion({
      system:
        'You are an assistant designed to extract all text, pricing tables, product details, packaging specifications, and specifications from vending machine consumables brochures. Extract every single line of text, columns, rates, and pack descriptions accurately.',
      user: 'Extract all content from this page. Pay close attention to product names, quantities per pack, pack details, prices/rates, and specifications.',
      imageUrl: dataUrl,
      model: 'gpt-4o',
    });

    console.log('Extraction complete. Content length:', result.content.length);
    const outputPath = 'C:\\Users\\DELL\\.gemini\\antigravity\\scratch\\page13_text.txt';
    fs.writeFileSync(outputPath, result.content, 'utf-8');
    console.log('Saved content to:', outputPath);
  } catch (error) {
    console.error('Error during vision completion:', error);
  }
}

main();
