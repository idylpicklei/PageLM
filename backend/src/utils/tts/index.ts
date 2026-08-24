import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { EdgeTTS } from 'node-edge-tts'
import { config } from '../../config/env'

export type TSeg = { text: string; voice?: string; speaker?: string }
export type TSay = (segs: TSeg[], dir: string, base: string, emit?: (m: any) => void) => Promise<string>

// @speech-sdk/core is ESM-only and this backend compiles to CJS, so the import() must survive tsc transpilation
const dynImport = new Function('s', 'return import(s)') as (s: string) => Promise<any>

let sdkLoad: Promise<{ generateConversation: any; factories: Record<string, any> }> | null = null

function sdk() {
  if (!sdkLoad) {
    sdkLoad = Promise.all([dynImport('@speech-sdk/core'), dynImport('@speech-sdk/core/providers')]).then(([core, prov]) => ({
      generateConversation: core.generateConversation,
      factories: {
        cartesia: prov.createCartesia,
        deepgram: prov.createDeepgram,
        elevenlabs: prov.createElevenLabs,
        'fal-ai': prov.createFal,
        'fish-audio': prov.createFishAudio,
        google: prov.createGoogle,
        hume: prov.createHume,
        inworld: prov.createInworld,
        minimax: prov.createMiniMax,
        mistral: prov.createMistral,
        murf: prov.createMurf,
        openai: prov.createOpenAI,
        resemble: prov.createResemble,
        xai: prov.createXai
      }
    }))
  }
  return sdkLoad
}

function ff(dir: string, parts: string[], out: string, emit?: (m: any) => void) {
  return new Promise<string>((res, rej) => {
    const list = path.join(dir, 'list.txt')
    const listContent = parts.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
    fs.writeFileSync(list, listContent)
    
    const bin = config.ffmpeg || 'ffmpeg'
    
    const p = spawn(bin, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'libmp3lame', '-b:a', '192k', out], { stdio: 'pipe' })
    
    p.stderr.on('data', d => {
      const msg = String(d)
      emit && emit({ type: 'ffmpeg', data: msg })
    })
    
    p.on('close', c => {
      if (c === 0) {
        res(out)
      } else {
        rej(new Error('ffmpeg_failed'))
      }
    })
    
    p.on('error', err => {
      rej(err)
    })
  })
}

async function synth_edge(segs: TSeg[], dir: string, base: string, emit?: (m: any) => void) {
  const v0 = config.tts_voice_edge || 'en-US-AvaNeural'
  const v1 = config.tts_voice_alt_edge || 'en-US-AndrewNeural'
  
  const files: string[] = []

  async function convertSegmentWithRetry(seg: TSeg, voice: string, outputFile: string, segmentIndex: number, maxRetries = 3) {
    let lastError: any = null
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const tts = new EdgeTTS({
          voice: voice,
          lang: voice.split('-').slice(0, 2).join('-'),
          outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
          timeout: 15000
        })
        
        await tts.ttsPromise(seg.text, outputFile)
        
        const stats = fs.statSync(outputFile)
        if (stats.size === 0) {
          throw new Error('Generated file is empty')
        }
        
        return
        
      } catch (err: any) {
        lastError = err
        
        if (attempt < maxRetries) {
          const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000) // Exponential backoff: 1s, 2s, 4s (max 5s)
          await new Promise(resolve => setTimeout(resolve, waitTime))
        }
      }
    }
    
    throw new Error(`Failed to convert segment ${segmentIndex + 1} after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`)
  }

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    const v = s.voice || (i % 2 ? v1 : v0)
    const f = path.join(dir, `${base}.${i}.mp3`)
    
    await convertSegmentWithRetry(s, v, f, i)
    
    files.push(f)
    emit && emit({ type: 'audio_progress', i, len: segs.length })
  }

  const out = path.join(dir, `${base}.mp3`)
  const result = await ff(dir, files, out, emit)
  return result
}

const GEMINI_VOICES = new Set([
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede",
  "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
  "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
  "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
])

function speakable(text: string): string {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function geminiVoice(requested: string | undefined, fallback: string): string {
  if (requested && GEMINI_VOICES.has(requested)) return requested
  return fallback
}

function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1, bitDepth = 16): Buffer {
  const header = Buffer.alloc(44)
  const dataSize = pcm.length
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + dataSize, 4)
  header.write("WAVE", 8)
  header.write("fmt ", 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE((sampleRate * channels * bitDepth) / 8, 28)
  header.writeUInt16LE((channels * bitDepth) / 8, 32)
  header.writeUInt16LE(bitDepth, 34)
  header.write("data", 36)
  header.writeUInt32LE(dataSize, 40)
  return Buffer.concat([header, pcm])
}

function parseAudioRate(mimeType: string | undefined): number {
  const m = /rate=(\d+)/i.exec(mimeType || "")
  return m ? Number(m[1]) : 24000
}

function geminiApiKey(): string {
  return config.gemini || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || ""
}

let resolvedGeminiTtsModel = ""

function geminiTtsModels(): string[] {
  return Array.from(new Set([
    resolvedGeminiTtsModel,
    config.gemini_tts_model,
    "gemini-2.5-flash-preview-tts",
    "gemini-2.5-flash-tts",
  ].filter(Boolean)))
}

async function geminiTtsRequest(text: string, speechConfig: Record<string, unknown>): Promise<{ pcm: Buffer; mimeType: string }> {
  const key = geminiApiKey()
  if (!key) throw new Error("gemini_api_key_missing")

  const body = JSON.stringify({
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig,
    },
  })

  let lastError = "gemini_tts_failed"
  for (const model of geminiTtsModels()) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    })
    const raw = await r.text()
    if (!r.ok) {
      lastError = `gemini_tts_http_${r.status}: ${raw.slice(0, 240)}`
      if (r.status === 404) continue
      throw new Error(lastError)
    }
    const data = JSON.parse(raw) as {
      candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>
    }
    const inline = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData
    if (!inline?.data) {
      lastError = "gemini_tts_empty_audio"
      continue
    }
    resolvedGeminiTtsModel = model
    return { pcm: Buffer.from(inline.data, "base64"), mimeType: inline.mimeType || "audio/L16;codec=pcm;rate=24000" }
  }

  throw new Error(lastError)
}

async function writeGeminiAudio(pcm: Buffer, mimeType: string, file: string): Promise<void> {
  if (/mpeg|mp3/i.test(mimeType)) {
    await fs.promises.writeFile(file, pcm)
    return
  }
  const wav = file.replace(/\.mp3$/i, ".wav")
  await fs.promises.writeFile(wav, pcmToWav(pcm, parseAudioRate(mimeType)))
  await new Promise<void>((resolve, reject) => {
    const p = spawn(config.ffmpeg || "ffmpeg", ["-y", "-i", wav, "-c:a", "libmp3lame", "-b:a", "192k", file], { stdio: "pipe" })
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error("ffmpeg_failed"))))
    p.on("error", reject)
  })
}

async function synth_gemini(segs: TSeg[], dir: string, base: string, emit?: (m: any) => void) {
  const v0 = config.tts_voice_gemini || "Kore"
  const v1 = config.tts_voice_alt_gemini || "Puck"
  const usable = segs.map((s, i) => ({
    text: speakable(s.text),
    speaker: (s.speaker || (i % 2 ? "B" : "A")).replace(/[^A-Za-z0-9]/g, "") || (i % 2 ? "B" : "A"),
    voice: geminiVoice(s.voice, i % 2 ? v1 : v0),
  })).filter((s) => s.text)

  if (!usable.length) throw new Error("gemini_tts_no_text")

  const speakers = Array.from(new Map(usable.map((s) => [s.speaker, s.voice])).entries()).slice(0, 2)

  try {
    if (speakers.length === 2) {
      const prompt = [
        `TTS the following conversation between ${speakers[0][0]} and ${speakers[1][0]}.`,
        "Read each line exactly, naturally, as a lively podcast.",
        ...usable.map((s) => `${s.speaker}: ${s.text}`),
      ].join("\n")
      const { pcm, mimeType } = await geminiTtsRequest(prompt, {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: speakers.map(([speaker, voice]) => ({
            speaker,
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
          })),
        },
      })
      const out = path.join(dir, `${base}.mp3`)
      await writeGeminiAudio(pcm, mimeType, out)
      emit && emit({ type: "audio_progress", i: usable.length - 1, len: usable.length })
      return out
    }
  } catch (err) {
    emit && emit({ type: "warn", message: `Gemini multi-speaker TTS failed, falling back to per-segment: ${String((err as Error)?.message || err)}` })
  }

  const files: string[] = []
  for (let i = 0; i < usable.length; i++) {
    const s = usable[i]
    const f = path.join(dir, `${base}.${i}.mp3`)
    let lastError: Error | null = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { pcm, mimeType } = await geminiTtsRequest(s.text, {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voice } },
        })
        await writeGeminiAudio(pcm, mimeType, f)
        lastError = null
        break
      } catch (err: any) {
        lastError = err
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt))
      }
    }
    if (lastError) throw new Error(`Failed to convert segment ${i + 1} after 3 attempts: ${lastError.message}`)
    files.push(f)
    emit && emit({ type: "audio_progress", i, len: usable.length })
  }

  return await ff(dir, files, path.join(dir, `${base}.mp3`), emit)
}

async function synth_eleven(segs: TSeg[], dir: string, base: string, emit?: (m: any) => void) {
  const k = config.eleven_api_key || ''
  const v0 = config.eleven_voice_a || ''
  const v1 = config.eleven_voice_b || v0
  const files: string[] = []

  if (!k) throw new Error('eleven_api_key_missing')

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    const v = s.voice || (i % 2 ? v1 : v0)
    if (!v) throw new Error('eleven_voice_missing')
    const f = path.join(dir, `${base}.${i}.mp3`)

    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${v}`, {
      method: 'POST',
      headers: { 'xi-api-key': k, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: s.text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.4, similarity_boost: 0.8 }
      })
    })
    if (!r.ok) throw new Error(`elevenlabs_http_${r.status}`)
    const b = new Uint8Array(await r.arrayBuffer())
    await fs.promises.writeFile(f, b)
    files.push(f)
    emit && emit({ type: 'audio_progress', i, len: segs.length })
  }

  const out = path.join(dir, `${base}.mp3`)
  return await ff(dir, files, out, emit)
}

async function synth_google(segs: TSeg[], dir: string, base: string, emit?: (m: any) => void) {
  const creds = config.google_creds || process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!creds) throw new Error('google_creds_missing')

  const mod = await import('@google-cloud/text-to-speech')
  const TTS: any = (mod as any).default || mod
  const c = new TTS.TextToSpeechClient()
  const v0 = config.tts_voice_google || 'en-US-Neural2-F'
  const v1 = config.tts_voice_alt_google || 'en-US-Neural2-D'
  const files: string[] = []

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    const v = s.voice || (i % 2 ? v1 : v0)
    const [r] = await c.synthesizeSpeech({
      input: { text: s.text },
      voice: { languageCode: v.split('-').slice(0, 2).join('-'), name: v },
      audioConfig: { audioEncoding: 'MP3' }
    })
    const f = path.join(dir, `${base}.${i}.mp3`)
    await fs.promises.writeFile(f, r.audioContent as Buffer)
    files.push(f)
    emit && emit({ type: 'audio_progress', i, len: segs.length })
  }

  const out = path.join(dir, `${base}.mp3`)
  return await ff(dir, files, out, emit)
}

function sdk_model(m: string, factories: Record<string, any>) {
  // with SPEECHBASE_API_KEY set, the bare string routes every provider through the hosted gateway; otherwise call the provider directly with its own env key
  if (process.env.SPEECHBASE_API_KEY) return m
  const i = m.indexOf('/')
  const provider = i === -1 ? m : m.slice(0, i)
  const modelId = i === -1 ? '' : m.slice(i + 1)
  const factory = factories[provider]
  if (!factory) throw new Error(`speechsdk_unknown_provider_${provider}`)
  return factory()(modelId || undefined)
}

async function synth_speechsdk(segs: TSeg[], dir: string, base: string, emit?: (m: any) => void) {
  const { generateConversation, factories } = await sdk()
  const v0 = config.speech_sdk_voice_a || 'alloy'
  const v1 = config.speech_sdk_voice_b || 'echo'
  const model = sdk_model(config.speech_sdk_model || 'openai/gpt-4o-mini-tts', factories)
  const turns = segs.map((s, i) => ({ text: s.text, voice: s.voice || (i % 2 ? v1 : v0) }))

  // one call renders the whole dialogue: native multi-speaker models when the provider has one, otherwise per-turn synthesis stitched and loudness-normalized (-20 dBFS) by the SDK, so no ffmpeg pass is needed
  const r = await generateConversation({ model, turns, output: { format: 'mp3' } })

  const out = path.join(dir, `${base}.mp3`)
  await fs.promises.writeFile(out, r.audio.uint8Array)
  emit && emit({ type: 'audio_progress', i: segs.length - 1, len: segs.length })
  return out
}

export const tts: TSay = async (segs, dir, base, emit) => {
  const p = config.tts_provider || 'gemini'

  if (p === 'gemini') {
    return synth_gemini(segs, dir, base, emit)
  } else if (p === 'edge') {
    return synth_edge(segs, dir, base, emit)
  } else if (p === 'eleven') {
    return synth_eleven(segs, dir, base, emit)
  } else if (p === 'google') {
    return synth_google(segs, dir, base, emit)
  } else if (p === 'speechsdk') {
    return synth_speechsdk(segs, dir, base, emit)
  } else {
    return synth_gemini(segs, dir, base, emit)
  }
}