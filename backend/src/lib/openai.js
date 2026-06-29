// Thin OpenAI client wrapper. Uses fetch directly so we don't need the npm package.
const API = 'https://api.openai.com/v1';

export async function chatCompletion({
  system,
  user,
  model = 'gpt-4o-mini',
  temperature = 0.4,
  responseFormat,
}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error('OPENAI_API_KEY missing in backend/.env');
  }
  const body = {
    model,
    temperature,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
  if (responseFormat) body.response_format = { type: responseFormat };
  const res = await fetch(`${API}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return {
    content: data.choices?.[0]?.message?.content?.trim() || '',
    model: data.model,
    usage: data.usage || {},
  };
}
export async function visionCompletion({
  system,
  user,
  imageUrl,
  model = 'gpt-4o',
  temperature = 0.1,
}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY missing');

  const res = await fetch(`${API}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: user },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      max_tokens: 2000,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI Vision ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return {
    content: data.choices?.[0]?.message?.content?.trim() || '',
    model: data.model,
    usage: data.usage || {},
  };
}

function responseOutputText(data) {
  if (data.output_text) return data.output_text.trim();
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .map((part) => part.text || part.output_text || '')
    .join('')
    .trim();
}

export async function fileCompletion({
  system,
  user,
  fileBuffer,
  filename,
  mimeType = 'application/pdf',
  model = 'gpt-4o',
  temperature = 0.1,
}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY missing');

  const base64 = Buffer.from(fileBuffer).toString('base64');
  const res = await fetch(`${API}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      instructions: system,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_file',
              filename: filename || 'bill.pdf',
              file_data: `data:${mimeType};base64,${base64}`,
            },
            { type: 'input_text', text: user },
          ],
        },
      ],
      max_output_tokens: 3000,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI File ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return {
    content: responseOutputText(data),
    model: data.model,
    usage: data.usage || {},
  };
}

export async function fileUrlCompletion({
  system,
  user,
  fileUrl,
  model = 'gpt-4o',
  temperature = 0.1,
}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY missing');

  const res = await fetch(`${API}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      instructions: system,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_file', file_url: fileUrl },
            { type: 'input_text', text: user },
          ],
        },
      ],
      max_output_tokens: 3000,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI File URL ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return {
    content: responseOutputText(data),
    model: data.model,
    usage: data.usage || {},
  };
}
