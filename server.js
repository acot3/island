require('dotenv').config();
const express = require('express');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const anthropic = new Anthropic();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.post('/api/tts', async (req, res) => {
  try {
    const { voice_id, text } = req.body;
    if (!voice_id || !text) return res.status(400).json({ error: 'voice_id and text required' });
    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`, {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.3, similarity_boost: 0.8, speed: 1.0 },
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[/api/tts] ElevenLabs error', resp.status, errText);
      return res.status(resp.status).send(errText);
    }
    const ab = await resp.arrayBuffer();
    res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': ab.byteLength });
    res.send(Buffer.from(ab));
  } catch (err) {
    console.error('[/api/tts]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/claude', async (req, res) => {
  try {
    const { system, messages, max_tokens, tools, tool_choice } = req.body;
    const params = {
      model: 'claude-sonnet-4-6',
      max_tokens: max_tokens || 1500,
      messages,
    };
    if (system) params.system = system;
    if (tools) params.tools = tools;
    if (tool_choice) params.tool_choice = tool_choice;
    const message = await anthropic.messages.create(params);
    res.json({ content: message.content, stop_reason: message.stop_reason });
  } catch (err) {
    console.error('[/api/claude]', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`King Krab prototype on http://localhost:${PORT}`));
