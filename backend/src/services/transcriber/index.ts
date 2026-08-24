import { OpenAI } from 'openai';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import llm from '../../utils/llm/llm';
import { config } from '../../config/env';

export type TranscriptionProvider = 'openai' | 'google' | 'assemblyai' | 'elevenlabs' | 'gemini';

export type TranscriptionResult = {
    text: string;
    provider: TranscriptionProvider;
    duration?: number;
    confidence?: number;
    studyMaterials?: StudyMaterials;
};

export type StudyMaterials = {
    summary: string;
    keyPoints: string[];
    topics: string[];
    categories: string[];
    searchableKeywords: string[];
    studyGuide: {
        mainConcepts: string[];
        importantTerms: { term: string; definition: string; }[];
        questions: string[];
        takeaways: string[];
    };
    timestamps?: { time: number; content: string; topic: string; }[];
};

function getOpenAI(): OpenAI {
    if (!config.openai) {
        throw new Error('OPENAI_API_KEY is required for this transcription provider');
    }
    return new OpenAI({ apiKey: config.openai });
}

function geminiApiKey(): string {
    return config.gemini || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
}

export function normalizeYouTubeUrl(input: string): string | null {
    const raw = String(input || '').trim();
    if (!raw) return null;
    try {
        const u = new URL(raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`);
        const host = u.hostname.replace(/^www\./, '').toLowerCase();
        if (host === 'youtu.be') {
            const id = u.pathname.split('/').filter(Boolean)[0];
            return id ? `https://www.youtube.com/watch?v=${id}` : null;
        }
        if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
            const v = u.searchParams.get('v');
            if (v) return `https://www.youtube.com/watch?v=${v}`;
            const parts = u.pathname.split('/').filter(Boolean);
            if ((parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'embed') && parts[1]) {
                return `https://www.youtube.com/watch?v=${parts[1]}`;
            }
        }
    } catch {
        return null;
    }
    return null;
}

export async function transcribeYouTube(youtubeUrl: string): Promise<TranscriptionResult> {
    const url = normalizeYouTubeUrl(youtubeUrl);
    if (!url) throw new Error('Enter a public YouTube watch, shorts, or youtu.be link');

    const payload = await geminiGenerateFromParts([
        { text: STUDY_TRANSCRIPT_PROMPT + '\nRules: public-video content only. If there is little speech, transcribe what you can.' },
        { file_data: { file_uri: url } },
    ], 'Gemini could not watch that video. Use a public YouTube link (not private or unlisted).');

    return resultFromPayload(payload, 'YouTube');
}

const STUDY_TRANSCRIPT_PROMPT = `Watch or listen to this media and return ONLY valid JSON with this shape:
{
  "transcription": "full spoken transcript, as faithful as possible",
  "summary": "2-3 sentence overview",
  "keyPoints": ["..."],
  "topics": ["..."],
  "categories": ["..."],
  "searchableKeywords": ["..."],
  "studyGuide": {
    "mainConcepts": ["..."],
    "importantTerms": [{"term":"...","definition":"..."}],
    "questions": ["..."],
    "takeaways": ["..."]
  }
}
No markdown fences.`;

function resultFromPayload(payload: any, category: string): TranscriptionResult {
    const text = String(payload.transcription || payload.transcript || '').trim();
    if (!text) throw new Error('No transcript could be generated from that video');
    return {
        text,
        provider: 'gemini',
        studyMaterials: {
            summary: payload.summary || '',
            keyPoints: payload.keyPoints || [],
            topics: payload.topics || [],
            categories: payload.categories || [category],
            searchableKeywords: payload.searchableKeywords || [],
            studyGuide: {
                mainConcepts: payload.studyGuide?.mainConcepts || [],
                importantTerms: payload.studyGuide?.importantTerms || [],
                questions: payload.studyGuide?.questions || [],
                takeaways: payload.studyGuide?.takeaways || [],
            },
        },
    };
}

function toModelText(out: any): string {
    if (!out) return '';
    if (typeof out === 'string') return out;
    if (typeof out?.content === 'string') return out.content;
    if (Array.isArray(out?.content)) return out.content.map((p: any) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
    return String(out?.content || '');
}

async function geminiGenerateFromParts(parts: unknown[], notFoundMessage: string): Promise<any> {
    const key = geminiApiKey();
    if (!key) throw new Error('Gemini API key is not configured');
    const model = config.gemini_model || 'gemini-3.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }] }),
        signal: AbortSignal.timeout(8 * 60 * 1000),
    });
    const raw = await r.text();
    if (!r.ok) {
        if (r.status === 400 || r.status === 403 || r.status === 404) throw new Error(notFoundMessage);
        throw new Error(`Gemini request failed (${r.status})`);
    }
    try {
        const data = JSON.parse(raw) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n').trim() || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        return jsonMatch ? JSON.parse(jsonMatch[0]) : { transcription: text };
    } catch {
        throw new Error('Gemini returned an unreadable transcript');
    }
}

function extractAudio(input: string): Promise<string> {
    const out = `${input}.mp3`;
    return new Promise((resolve, reject) => {
        const p = spawn(config.ffmpeg || 'ffmpeg', ['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', out], { stdio: 'pipe' });
        p.on('close', (code) => {
            if (code === 0 && fs.existsSync(out)) resolve(out);
            else reject(new Error('Could not extract audio from that video'));
        });
        p.on('error', () => reject(new Error('ffmpeg is not available to process video')));
    });
}

async function uploadGeminiFile(filePath: string, mimeType: string): Promise<string> {
    const key = geminiApiKey();
    if (!key) throw new Error('Gemini API key is not configured');
    const body = fs.readFileSync(filePath);
    const start = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: {
            'X-Goog-Upload-Protocol': 'resumable',
            'X-Goog-Upload-Command': 'start',
            'X-Goog-Upload-Header-Content-Length': String(body.length),
            'X-Goog-Upload-Header-Content-Type': mimeType,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file: { display_name: path.basename(filePath) } }),
    });
    const uploadUrl = start.headers.get('x-goog-upload-url');
    if (!start.ok || !uploadUrl) throw new Error('Could not start Gemini file upload');
    const finish = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
            'Content-Length': String(body.length),
            'X-Goog-Upload-Offset': '0',
            'X-Goog-Upload-Command': 'upload, finalize',
        },
        body,
    });
    const uploaded = await finish.json() as { file?: { uri?: string; name?: string; state?: string } };
    let file = uploaded.file;
    for (let i = 0; i < 30 && file?.name && file.state && file.state !== 'ACTIVE'; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const poll = await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}?key=${encodeURIComponent(key)}`);
        const next = await poll.json() as { state?: string; uri?: string; name?: string };
        file = { uri: next.uri || file.uri, name: next.name || file.name, state: next.state };
    }
    if (!file?.uri) throw new Error('Gemini did not finish processing that file');
    return file.uri;
}

export async function transcribeMediaFile(filePath: string, mimeType: string): Promise<TranscriptionResult> {
    let workPath = filePath;
    let workMime = mimeType || 'application/octet-stream';
    if (workMime.startsWith('video/') || !workMime.startsWith('audio/')) {
        try {
            workPath = await extractAudio(filePath);
            workMime = 'audio/mpeg';
        } catch (err) {
            if (workMime.startsWith('video/')) throw err;
        }
    }
    const size = fs.statSync(workPath).size;
    if (size > 80 * 1024 * 1024) {
        throw new Error('That video is too long for transcription. Try a shorter clip.');
    }
    const parts: unknown[] = [{ text: STUDY_TRANSCRIPT_PROMPT }];
    if (size > 18 * 1024 * 1024) {
        const uri = await uploadGeminiFile(workPath, workMime);
        parts.push({ file_data: { mime_type: workMime, file_uri: uri } });
    } else {
        parts.push({ inline_data: { mime_type: workMime, data: fs.readFileSync(workPath).toString('base64') } });
    }
    const payload = await geminiGenerateFromParts(parts, 'Gemini could not read that audio or video file.');
    return resultFromPayload(payload, 'Recording');
}

export async function transcribeAudio(filePath: string, provider: TranscriptionProvider = 'gemini', mimeType = 'audio/webm'): Promise<TranscriptionResult> {
    if (provider === 'gemini' || mimeType.startsWith('video/') || !config.openai) {
        return transcribeMediaFile(filePath, mimeType);
    }

    let result: TranscriptionResult;

    switch (provider) {
        case 'openai':
            result = await transcribeWithOpenAI(filePath);
            break;
        case 'google':
            result = await transcribeWithGoogle(filePath);
            break;
        case 'assemblyai':
            result = await transcribeWithAssemblyAI(filePath);
            break;
        case 'elevenlabs':
            result = await transcribeWithElevenLabs(filePath);
            break;
        default:
            throw new Error(`Unknown provider: ${provider}`);
    }

    if (result.text && result.text.length > 50) {
        result.studyMaterials = await generateStudyMaterials(result.text);
    }

    return result;
}

async function transcribeWithOpenAI(filePath: string): Promise<TranscriptionResult> {
    try {
        const audioFile = fs.createReadStream(filePath);

        const transcription = await getOpenAI().audio.transcriptions.create({
            file: audioFile,
            model: 'whisper-1',
        });

        return {
            text: transcription.text,
            provider: 'openai',
        };
    } catch (error: any) {
        console.error('OpenAI transcription error:', error);
        throw new Error(`OpenAI transcription failed: ${error.message}`);
    }
}

async function transcribeWithGoogle(filePath: string): Promise<TranscriptionResult> {
    try {
        if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !config.google_creds) {
            throw new Error('Google Cloud credentials not configured');
        }

        let speech: any;
        try {
            speech = await eval(`import('@google-cloud/speech')`);
        } catch (importError) {
            throw new Error('Google Cloud Speech SDK not installed. Run: npm install @google-cloud/speech');
        }

        const client = new speech.SpeechClient();

        const audioBytes = fs.readFileSync(filePath);

        const audioConfig = {
            encoding: 'WEBM_OPUS' as any,
            sampleRateHertz: 48000,
            languageCode: 'en-US',
            enableAutomaticPunctuation: true,
        };

        const request = {
            audio: { content: audioBytes },
            config: audioConfig,
        };

        const [response] = await client.recognize(request);

        if (!response.results || response.results.length === 0) {
            throw new Error('No transcription results from Google Speech');
        }

        const transcription = response.results
            .map(result => result.alternatives?.[0]?.transcript || '')
            .join(' ');

        const confidence = response.results[0]?.alternatives?.[0]?.confidence || 0;

        return {
            text: transcription,
            provider: 'google',
            confidence,
        };
    } catch (error: any) {
        console.error('Google Speech transcription error:', error);
        throw new Error(`Google Speech transcription failed: ${error.message}`);
    }
}

async function transcribeWithAssemblyAI(filePath: string): Promise<TranscriptionResult> {
    try {
        const apiKey = process.env.ASSEMBLYAI_API_KEY;
        if (!apiKey) {
            throw new Error('AssemblyAI API key not configured');
        }

        const audioData = fs.readFileSync(filePath);

        const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/octet-stream',
            },
            body: audioData,
        });

        if (!uploadResponse.ok) {
            throw new Error(`Upload failed: ${uploadResponse.statusText}`);
        }

        const { upload_url } = await uploadResponse.json();

        const transcriptResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                audio_url: upload_url,
                punctuate: true,
                format_text: true,
            }),
        });

        if (!transcriptResponse.ok) {
            throw new Error(`Transcription request failed: ${transcriptResponse.statusText}`);
        }

        const { id } = await transcriptResponse.json();

        let status = 'queued';
        let result: any;

        while (status !== 'completed' && status !== 'error') {
            await new Promise(resolve => setTimeout(resolve, 1000));

            const pollResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                },
            });

            if (!pollResponse.ok) {
                throw new Error(`Polling failed: ${pollResponse.statusText}`);
            }

            result = await pollResponse.json();
            status = result.status;
        }

        if (status === 'error') {
            throw new Error(`AssemblyAI transcription failed: ${result.error}`);
        }

        return {
            text: result.text || '',
            provider: 'assemblyai',
            confidence: result.confidence,
        };
    } catch (error: any) {
        console.error('AssemblyAI transcription error:', error);
        throw new Error(`AssemblyAI transcription failed: ${error.message}`);
    }
}

async function transcribeWithElevenLabs(filePath: string): Promise<TranscriptionResult> {
    try {
        const apiKey = config.eleven_api_key;
        if (!apiKey) {
            throw new Error('ElevenLabs API key not configured');
        }

        const audioData = fs.readFileSync(filePath);
        const formData = new FormData();
        formData.append('audio', new Blob([audioData]), 'audio.webm');

        const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
            method: 'POST',
            headers: {
                'xi-api-key': apiKey,
            },
            body: formData,
        });

        if (!response.ok) {
            throw new Error(`ElevenLabs API error: ${response.statusText}`);
        }

        const result = await response.json();

        return {
            text: result.text || '',
            provider: 'elevenlabs',
        };
    } catch (error: any) {
        console.error('ElevenLabs transcription error:', error);
        throw new Error(`ElevenLabs transcription failed: ${error.message}`);
    }
}

async function generateStudyMaterials(transcriptionText: string): Promise<StudyMaterials> {
    try {
        const prompt = `Analyze this transcription and create organized study materials:

TRANSCRIPTION:
${transcriptionText}

Please provide a JSON response with the following structure:
{
    "summary": "Brief overview of the main content (2-3 sentences)",
    "keyPoints": ["Point 1", "Point 2", "Point 3"],
    "topics": ["Topic 1", "Topic 2", "Topic 3"],
    "categories": ["Category like 'Science', 'History', 'Math', etc."],
    "searchableKeywords": ["keyword1", "keyword2", "keyword3"],
    "studyGuide": {
        "mainConcepts": ["Concept 1", "Concept 2"],
        "importantTerms": [{"term": "Term", "definition": "Definition"}],
        "questions": ["Question 1?", "Question 2?"],
        "takeaways": ["Key takeaway 1", "Key takeaway 2"]
    }
}

Make it educational and useful for studying. Focus on extracting the most important information for learning purposes.`;

        const completion = await llm.invoke([
            {
                role: 'system',
                content: 'You are an expert educational content analyzer. Create comprehensive study materials from transcriptions. Always respond with valid JSON only.'
            },
            {
                role: 'user',
                content: prompt
            }
        ] as any);

        const responseText = toModelText(completion).trim();
        if (!responseText) {
            throw new Error('No response from AI');
        }

        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('Invalid JSON response from AI');
        }

        const studyMaterials = JSON.parse(jsonMatch[0]);

        return {
            summary: studyMaterials.summary || 'Content analysis not available',
            keyPoints: studyMaterials.keyPoints || [],
            topics: studyMaterials.topics || [],
            categories: studyMaterials.categories || ['General'],
            searchableKeywords: studyMaterials.searchableKeywords || [],
            studyGuide: {
                mainConcepts: studyMaterials.studyGuide?.mainConcepts || [],
                importantTerms: studyMaterials.studyGuide?.importantTerms || [],
                questions: studyMaterials.studyGuide?.questions || [],
                takeaways: studyMaterials.studyGuide?.takeaways || []
            }
        };
    } catch (error: any) {
        console.error('Study materials generation error:', error);

        return {
            summary: 'Unable to generate summary',
            keyPoints: [],
            topics: [],
            categories: ['General'],
            searchableKeywords: [],
            studyGuide: {
                mainConcepts: [],
                importantTerms: [],
                questions: [],
                takeaways: []
            }
        };
    }
}