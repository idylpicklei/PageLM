import { transcribeAudio, transcribeYouTube, TranscriptionProvider, TranscriptionResult } from "../../services/transcriber";
import { config } from "../../config/env";
import fs from "fs";
import os from "os";
import path from "path";
import Busboy from "busboy";
import crypto from "crypto";
import { userContext } from "../../utils/user-context";

type ParsedTranscriptionRequest = {
    provider: TranscriptionProvider;
    files: Array<{ path: string; filename: string; mimeType: string }>;
};

type Job = {
    status: "pending" | "done" | "error";
    phase: string;
    result?: TranscriptionResult;
    error?: string;
};

const jobs = new Map<string, Job>();

function parseTranscriptionRequest(req: any): Promise<ParsedTranscriptionRequest> {
    return new Promise((resolve, reject) => {
        const bb = Busboy({ headers: req.headers, limits: { fileSize: 200 * 1024 * 1024 } });
        let provider: TranscriptionProvider = (config.transcription_provider as TranscriptionProvider) || "gemini";
        const files: Array<{ path: string; filename: string; mimeType: string }> = [];
        let pending = 0;
        let ended = false;
        let failed = false;
        const done = () => {
            if (!failed && ended && pending === 0) {
                resolve({ provider, files });
            }
        };

        const uploadDir = path.join(os.tmpdir(), "pagelm-transcribe");
        fs.mkdirSync(uploadDir, { recursive: true });

        bb.on("field", (name, value) => {
            if (name === "provider") provider = value as TranscriptionProvider;
        });

        bb.on("file", (_name, file, info: any) => {
            pending++;
            const filename = String(info?.filename || "audio").replace(/[^a-zA-Z0-9._-]/g, "_");
            const mimeType = info?.mimeType || info?.mime || "audio/webm";
            const filePath = path.join(uploadDir, `${Date.now()}-${filename}`);
            const writeStream = fs.createWriteStream(filePath);

            file.on("limit", () => {
                failed = true;
                reject(new Error("That file is too large. Use a clip under 200MB."));
            });
            file.on("error", (e) => {
                failed = true;
                reject(e);
            });
            writeStream.on("error", (e) => {
                failed = true;
                reject(e);
            });
            writeStream.on("finish", () => {
                files.push({ path: filePath, filename, mimeType });
                pending--;
                done();
            });

            file.pipe(writeStream);
        });

        bb.on("error", (e) => {
            failed = true;
            reject(e);
        });
        bb.on("finish", () => {
            ended = true;
            done();
        });

        req.pipe(bb);
    });
}

function startJob(run: (setPhase: (phase: string) => void) => Promise<TranscriptionResult>): { jobId: string } {
    const jobId = crypto.randomUUID();
    const job: Job = { status: "pending", phase: "Starting…" };
    jobs.set(jobId, job);
    const ctx = userContext.getStore();
    const work = async () => {
        try {
            const result = await run((phase) => {
                job.phase = phase;
            });
            job.status = "done";
            job.phase = "Done";
            job.result = result;
        } catch (e: any) {
            job.status = "error";
            job.phase = "Error";
            job.error = e?.message || "Transcription failed";
        }
    };
    setImmediate(() => {
        if (ctx) userContext.run(ctx, () => void work());
        else void work();
    });
    return { jobId };
}

export function transcriberRoutes(app: any) {
    app.get("/transcriber/:jobId", (req: any, res: any) => {
        const job = jobs.get(String(req.params.jobId || ""));
        if (!job) return res.status(404).json({ ok: false, error: "Transcription job not found. Try again." });
        if (job.status === "pending") {
            return res.json({ ok: true, status: "pending", phase: job.phase });
        }
        if (job.status === "error") {
            return res.json({ ok: false, status: "error", error: job.error || "Transcription failed" });
        }
        return res.json({
            ok: true,
            status: "done",
            transcription: job.result?.text,
            provider: job.result?.provider,
            duration: job.result?.duration,
            confidence: job.result?.confidence,
            studyMaterials: job.result?.studyMaterials,
        });
    });

    app.post("/transcriber", async (req: any, res: any) => {
        try {
            const contentType = req.headers["content-type"] || "";

            if (contentType.includes("application/json")) {
                const youtubeUrl = String(req.body?.youtubeUrl || req.body?.url || "").trim();
                if (!youtubeUrl) {
                    return res.status(400).json({ ok: false, error: "youtubeUrl required" });
                }
                const { jobId } = startJob(async (setPhase) => {
                    setPhase("Watching YouTube video…");
                    return transcribeYouTube(youtubeUrl);
                });
                return res.status(202).json({ ok: true, jobId });
            }

            if (!contentType.includes("multipart/form-data")) {
                return res.status(400).json({
                    ok: false,
                    error: "Send an audio file or a YouTube URL",
                });
            }

            const { provider, files } = await parseTranscriptionRequest(req);

            if (!files || files.length === 0) {
                return res.status(400).json({
                    ok: false,
                    error: "No audio file provided",
                });
            }

            const audioFile = files[0];
            if (!audioFile.mimeType.startsWith("audio/") && !audioFile.mimeType.startsWith("video/")) {
                return res.status(400).json({
                    ok: false,
                    error: "File must be an audio or video file",
                });
            }

            const { jobId } = startJob(async (setPhase) => {
                setPhase(audioFile.mimeType.startsWith("video/") ? "Extracting audio from video…" : "Transcribing…");
                try {
                    return await transcribeAudio(audioFile.path, provider, audioFile.mimeType);
                } finally {
                    try { fs.unlinkSync(audioFile.path); } catch {}
                    try { fs.unlinkSync(`${audioFile.path}.mp3`); } catch {}
                }
            });
            return res.status(202).json({ ok: true, jobId });
        } catch (error: any) {
            console.error("Transcription route error:", error);
            res.status(500).json({
                ok: false,
                error: error.message || "Transcription failed",
            });
        }
    });
}
