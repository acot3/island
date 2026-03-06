import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

export async function POST(request: NextRequest) {
  try {
    const { text, voice = 'ash' } = await request.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    // Truncate text if it exceeds OpenAI's limit (4096 chars)
    const truncatedText = text.slice(0, 4096);

    const openai = getOpenAIClient();

    const mp3Response = await openai.audio.speech.create({
      model: 'gpt-4o-mini-tts',
      voice: voice as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' | 'ash',
      input: truncatedText,
      instructions: 'Voice Affect: Low, hushed, and suspenseful; convey tension and intrigue. Tone: Deeply serious and mysterious, maintaining an undercurrent of unease throughout. Pacing: Fast but deliberate, pausing slightly after suspenseful moments to heighten drama. Emotion: Restrained yet intense—voice should subtly tremble or tighten at key suspenseful points. Emphasis: Highlight sensory descriptions to amplify atmosphere. Pauses: Insert meaningful pauses after key phrases to enhance suspense dramatically.',
    });

    // Get the audio data as an ArrayBuffer
    const audioBuffer = await mp3Response.arrayBuffer();

    // Return the audio as a response
    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error('TTS API error:', error);
    return NextResponse.json(
      { error: 'Failed to generate speech' },
      { status: 500 }
    );
  }
}
