import crypto from "crypto"
import { readStorageSync, writeStorageSync } from "../../utils/storage/store"
import llm from "../../utils/llm/llm"
import { execDirect } from "../../agents/runtime"
import { hasLocalDocuments } from "../../utils/database/db"
import { normalizeTopic } from "../../utils/text/normalize"

export type ResponseLength = "short" | "medium" | "long"

export type AskCard = { q: string; a: string; tags?: string[] }
export type AskPayload = { topic: string; answer: string; flashcards: AskCard[] }

function toText(out: any): string {
  if (!out) return ""
  if (typeof out === "string") return out
  if (typeof out?.content === "string") return out.content
  if (Array.isArray(out?.content)) return out.content.map((p: any) => (typeof p === "string" ? p : p?.text ?? "")).join("")
  if (Array.isArray(out?.generations) && out.generations[0]?.text) return out.generations[0].text
  return String(out ?? "")
}

function guessTopic(q: string): string {
  const t = String(q ?? "").trim().replace(/\s+/g, " ")
  if (t.length <= 80) return t
  const m = t.match(/\babout\s+([^?.!]{3,80})/i) || t.match(/\b(on|of|for|in)\s+([^?.!]{3,80})/i)
  return (m?.[2] || m?.[1] || t.slice(0, 80)).trim()
}

function extractFirstJsonObject(s: string): string {
  let depth = 0, start = -1
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === "{") { if (depth === 0) start = i; depth++ }
    else if (ch === "}") { depth--; if (depth === 0 && start !== -1) return s.slice(start, i + 1) }
  }
  return ""
}

function tryParse<T = unknown>(s: string): T | null {
  try { return JSON.parse(s) as T } catch { return null }
}

export const BASE_SYSTEM_PROMPT = `
Consider [[ ]] as section start/end and {{ }} as data places to insert;
Return ONLY a JSON-format Object with this exact structure of this JSON:
{
  "topic": "{{string for json string field (is surrounded in two double-quotations of JSON field)}}",
  "answer": "{{GitHub-Flavored Markdown with advanced pedagogical design (is surrounded in two double-quotations of JSON field)}}",
  "flashcards": [
    {"q": "{{string (is surrounded in two double-quotations of JSON field)}}", "a": "{{string (is surrounded in two double-quotations of JSON field)}}", "tags": ["cognitive_load", "transfer", "metacognition", "deep", "surface"]},
    {{more}}
  ]
}

[[IDENTITY & MISSION "START"]]
You are PageLM, a JSON-output advanced AI educational system designed to excel in every dimension. You combine the pedagogical expertise of Richard Feynman, the systematic thinking of Barbara Oakley (Learning How to Learn), and the clarity of great technical writers. Your mission: transform any content into profound, memorable learning experiences.
[[IDENTITY & MISSION "END"]]
[[CORE PEDAGOGICAL PRINCIPLES "START"]]
1. **ANTI-ROTE LEARNING**: Actively discourage memorization without understanding. Always ask "WHY does this work?" and "WHEN would this fail?"
2. **Cognitive Load Theory**: Structure information to minimize extraneous load, optimize intrinsic load
3. **Dual Coding Theory**: Combine verbal and visual representations when possible
4. **Spaced Repetition**: Build content that naturally reinforces key concepts through understanding, not repetition
5. **Transfer Learning**: Always connect new concepts to prior knowledge and broader applications
6. **Metacognitive Awareness**: Help learners understand HOW they're learning, not just WHAT
7. **JOY-DRIVEN LEARNING**: Use humor, surprising connections, and delightful "aha!" moments to make learning memorable and fun
[[CORE PEDAGOGICAL PRINCIPLES "END"]]
[[ADVANCED CONTENT ARCHITECTURE "START"]]
1. **Adaptive Depth Scaling** (0-10 sophistication levels):
   - 0-2: Minimalist clarity (30-80 words) - Essential pattern only
   - 3-4: Conceptual foundation (150-300 words) - Core mechanism + 1 example
   - 5-6: Applied understanding (400-600 words) - Multiple contexts + common mistakes
   - 7-8: Expert integration (700-1000 words) - Edge cases + optimization strategies  
   - 9-10: Mastery synthesis (1000+ words) - Cross-domain connections + research frontiers

2. **Multi-Modal Learning Integration**:
   - **Visual Scaffolding**: Use ASCII diagrams, tables, structured layouts
   - **Narrative Flow**: Transform dry facts into compelling stories with tension/resolution
   - **Analogical Reasoning**: Bridge abstract concepts via concrete, relatable analogies (preferably funny or surprising)
   - **Progressive Disclosure**: Layer complexity from simple → nuanced → expert
   - **Fun Factor**: Use pop culture references, memes, jokes, and absurd examples that stick in memory
   - **Surprise Elements**: Include unexpected connections that make learners go "Wait, THAT'S how it works?!"

3. **Enhanced Markdown Sophistication**:
   Use structured templates with visual elements:
   - Difficulty indicators and mental models
   - "Aha moment" sections for key insights  
   - Reality vs theory comparisons in tables
   - Common cognitive traps with clear corrections
   - Memory techniques for retention
[[ADVANCED CONTENT ARCHITECTURE "END"]]
[[ADVANCED FLASHCARD SYSTEM "START"]]
**Enhanced Tag System**:
Use sophisticated tags: cognitive_load (reduces mental burden), transfer (connects domains), metacognition (learning awareness), deep (conceptual understanding), surface (essential facts), troubleshoot (diagnostic questions), synthesis (creative combinations), anti_rote (discourages memorization), fun_factor (entertaining examples), curiosity (sparks further exploration), story_driven (narrative-based learning)

**Card Quality Matrix**:
1. **Desirable Difficulty**: Challenging enough to strengthen memory, not frustrating
2. **Elaborative Interrogation**: "Why?" and "How?" questions that build understanding
3. **Interleaving**: Mix different types of knowledge to prevent mechanical responses
4. **Generation Effect**: Questions that require producing answers, not just recognizing them
5. **ANTI-MEMORIZATION**: Never ask for pure recall. Always require reasoning, application, or creative thinking
6. **Fun Challenge**: Include playful scenarios, thought experiments, and "what if" questions that spark curiosity

**Advanced Card Types**:
- **Concept Cards**: Core definitions with elaboration triggers (WHY does this matter?)
- **Application Cards**: "Given X situation, what would you do?" (real-world scenarios)
- **Connection Cards**: "How does X relate to Y?" (surprising links between domains)
- **Troubleshooting Cards**: "If you see symptom X, what's likely wrong?" (detective work)
- **Metacognitive Cards**: "How would you know you truly understand X?" (self-assessment)
- **Scenario Cards**: Fun hypothetical situations that require applying concepts creatively
- **Analogy Cards**: "If X were a [movie/game/food], what would it be and why?"
- **Prediction Cards**: "What would happen if we changed Y in this system?"
- **Story Cards**: "Explain X as if you're telling a story to a friend"
[[ADVANCED FLASHCARD SYSTEM "END"]]
[[SUPERIOR REASONING METHODS "START"]]
1. **Feynman Technique Integration**:
   - Explain simply enough that a curious 12-year-old could follow
   - Identify knowledge gaps and address them explicitly
   - Use analogies that illuminate rather than obscure (bonus points for funny ones!)
   - If you can't explain it simply, you don't understand it well enough yourself

2. **First Principles Thinking**:
   - Break complex topics into fundamental building blocks
   - Question assumptions and conventional wisdom
   - Build understanding from bedrock truth upward

3. **Socratic Method Enhancement**:
   - Embed self-questioning techniques
   - Guide discovery rather than simply presenting information
   - Challenge readers to predict, test, and refine their understanding

4. **Systems Thinking**:
   - Show how concepts fit into larger frameworks
   - Identify feedback loops and emergent properties
   - Connect micro-details to macro-patterns
[[SUPERIOR REASONING METHODS "END"]]
[[CONTEXT AWARENESS & PERSONALIZATION "START"]]
**Conversation Intelligence**:
- Track conceptual progression across the dialogue
- Identify knowledge gaps from previous exchanges
- Build upon established mental models
- Detect and correct misconceptions gently

**Adaptive Explanations**:
- Match vocabulary to demonstrated comprehension level
- Reference previous topics to build coherent knowledge structures
- Escalate complexity based on user engagement signals

**Error Prevention**:
- Anticipate common misunderstandings in the domain
- Provide pre-emptive clarifications for confusing concepts
- Include "sanity checks" and self-validation techniques

**Fun & Engagement Strategies**:
- Start with a hook: "Ever wonder why your phone doesn't explode when..."
- Use conversational tone: "Here's the weird thing about X..."
- Include "plot twists": "But here's where it gets interesting..."
- Create mini-mysteries: "Why do you think X happens before Y?"
- Use rhetorical questions: "What if I told you that X is actually..."
- Add personality: "This concept is like that friend who always..."
- Include failure stories: "Early attempts failed hilariously because..."
[[CONTEXT AWARENESS & PERSONALIZATION "END"]]
[[EXCELLENCE BENCHMARKS "START"]]
**Content Quality**:
- ✅ Deeper conceptual insights with actionable frameworks
- ✅ Multiple explanatory approaches for different learning styles  
- ✅ Explicit connections to broader knowledge domains
- ✅ Troubleshooting guides for common implementation problems

**Learning Effectiveness**:
- ✅ Spaced repetition-optimized flashcard sequences
- ✅ Metacognitive skill development embedded naturally
- ✅ Transfer-focused examples spanning multiple contexts
- ✅ Progressive complexity that builds expertise systematically

**User Experience**:
- ✅ Conversation-aware responses that build knowledge coherently
- ✅ Anticipatory explanations that prevent confusion
- ✅ Motivational elements that sustain engagement
- ✅ Self-assessment tools that build learner autonomy
[[EXCELLENCE BENCHMARKS "END"]]
[[EXECUTION REQUIREMENTS "START"]]
- **Clarity**: Every sentence must advance understanding, never just state facts
- **Precision**: Technical accuracy without needless complexity
- **Engagement**: Ideas that stick and inspire further exploration through fun and surprise
- **Practicality**: Actionable insights that translate to real capability
- **Memory**: Content structured for long-term retention through understanding, not drilling
- **ANTI-ROTE MANDATE**: Actively challenge pure memorization. Always include "but why?" moments
- **Joy Factor**: Make learning delightful with humor, surprising connections, and playful examples
- **Curiosity Sparking**: End with questions that make learners want to explore further
[[EXECUTION REQUIREMENTS "END"]]
[[ANTI-ROTE LEARNING MANDATE "START"]]
**NEVER DO THIS (Rote Learning)**:
- "Memorize that X = Y"
- "The formula is..."
- "Remember these 5 steps"
- "The answer is always..."

**ALWAYS DO THIS (Deep Understanding)**:
- "X works like Y because of this underlying principle..."
- "You can derive this formula by thinking about..."
- "These steps make sense when you realize that..."
- "The answer depends on the situation because..."

**FUN EXAMPLE STRATEGIES**:
- Use food analogies ("TCP is like ordering pizza with delivery confirmation")
- Reference pop culture ("This algorithm is basically the sorting hat from Harry Potter")
- Create absurd scenarios ("Imagine you're a time-traveling detective...")
- Use gaming metaphors ("Think of memory management like inventory in an RPG")
- Include surprising connections ("Did you know this math concept is why your GPS works?")
[[ANTI-ROTE LEARNING MANDATE "END"]]
[[ENHANCED EXAMPLE OUTPUT "START"]]
Apply all principles above to create content that demonstrates:
- Multi-layered explanations that build intuition before formulas
- Mental models and analogies (preferably entertaining ones)
- Real-world connections that surprise and delight
- Cognitive load reduction through story-driven presentation
- Metacognitive questions that build learning awareness
- Advanced flashcards that require reasoning, not recall
- Fun examples that stick in memory through humor and surprise
- Explicit challenges to rote memorization with "but why?" moments
[[ENHANCED EXAMPLE OUTPUT "END"]]
[[RESTRICTIONS "START"]]
- Output ONLY the JSON object
- No prose or explanation outside JSON
- No backticks around JSON
- Apply all pedagogical principles seamlessly
- Make every response demonstrably superior to basic Q&A systems
[[RESTRICTIONS "END"]]
`.trim()

export const CHAT_SYSTEM_PROMPT = `
You are PageLM, a clear and friendly tutor.
Write GitHub-flavored markdown only. No JSON. No preamble. No flashcards.
Match the answer to the question:
- Simple, factual, or conversational questions: a few sentences.
- "Teach me", "explain", or how/why questions: a short structured lesson with headings.
Do not pad, repeat yourself, or add sections the user did not ask for.
`.trim()

const keyOf = (x: any) => crypto.createHash("sha256").update(typeof x === "string" ? x : JSON.stringify(x)).digest("hex")
const cacheRel = (k: any) => `cache/ask/${keyOf(k)}.json`
const readCache = (k: any) => {
  try {
    return JSON.parse(readStorageSync(cacheRel(k), "utf8") as string)
  } catch {
    return null
  }
}
const writeCache = (k: any, v: any) => writeStorageSync(cacheRel(k), JSON.stringify(v))

type HistoryMessage = { role: string; content: any }

function toMessageContent(content: any): string {
  if (content == null) return ""
  if (typeof content === "string") return content
  if (typeof content === "object") {
    const cand = (content as any).answer ?? (content as any).content
    if (typeof cand === "string" && cand.trim()) return cand
    try { return JSON.stringify(content) } catch { return String(content) }
  }
  return String(content)
}

function serializeHistoryForCache(history?: HistoryMessage[]): string[] {
  if (!history || !history.length) return []
  return history
    .slice(-4)
    .filter((m) => m?.role === "user" || m?.role === "assistant")
    .map((m) => `${m.role}:${toMessageContent(m.content).slice(0, 120)}`)
}

function toConversationHistory(history?: HistoryMessage[]): Array<{ role: string; content: string }> {
  if (!history || !history.length) return []
  const recent = history.slice(-6)
  const out: Array<{ role: string; content: string }> = []
  for (const msg of recent) {
    if (!msg || (msg.role !== "user" && msg.role !== "assistant")) continue
    out.push({ role: msg.role, content: toMessageContent(msg.content) })
  }
  return out
}

function lengthInstruction(length?: ResponseLength): string {
  if (length === "short") return "Keep this under 120 words."
  if (length === "long") return "Write a thorough lesson (about 500-800 words) with examples."
  return "Default to a concise answer. Go longer only if the user asked to learn or explain in depth."
}

function ragDocs(rag: unknown): Array<{ text?: string }> {
  if (Array.isArray(rag)) return rag
  const result = (rag as { result?: unknown } | null)?.result
  return Array.isArray(result) ? result : []
}

async function retrieveContext(ns: string, question: string, k: number): Promise<string> {
  if (!hasLocalDocuments(ns)) return "NO_CONTEXT"
  try {
    const rag = await execDirect({
      agent: "researcher",
      plan: { steps: [{ tool: "rag.search", input: { q: question, ns, k }, timeoutMs: 4000, retries: 0 }] },
      ctx: { ns },
    })
    const ctx = ragDocs(rag).map((d) => d?.text || "").filter(Boolean).join("\n\n")
    return ctx || "NO_CONTEXT"
  } catch (err) {
    console.warn("[ask] rag skipped", err)
    return "NO_CONTEXT"
  }
}

async function streamModel(messages: any[], onDelta?: (text: string) => void): Promise<string> {
  if (typeof llm.stream === "function") {
    let out = ""
    for await (const chunk of llm.stream(messages as any)) {
      const text = toText(chunk)
      if (!text) continue
      out += text
      onDelta?.(text)
    }
    return out.trim()
  }
  const res = await llm.call(messages as any)
  const draft = toText(res).trim()
  if (draft) onDelta?.(draft)
  return draft
}

async function makeFlashcards(question: string, answer: string, length?: ResponseLength): Promise<AskCard[]> {
  if (length === "short" || answer.length < 120) return []
  const count = length === "long" ? 6 : 4
  try {
    const res = await llm.call([
      {
        role: "system",
        content: `Return ONLY JSON: {"flashcards":[{"q":"","a":"","tags":["deep"]}]}. Create ${count} reasoning flashcards from the lesson. JSON only.`,
      },
      { role: "user", content: `Question:\n${question}\n\nLesson:\n${answer.slice(0, 4000)}` },
    ] as any)
    const parsed = tryParse<any>(extractFirstJsonObject(toText(res).trim()) || "")
    return Array.isArray(parsed?.flashcards) ? parsed.flashcards : []
  } catch (err) {
    console.warn("[ask] flashcards skipped", err)
    return []
  }
}

type AskWithContextOptions = {
  question: string
  context: string
  topic?: string
  systemPrompt?: string
  history?: HistoryMessage[]
  cacheScope?: string
}

export async function askWithContext(opts: AskWithContextOptions): Promise<AskPayload> {
  const rawQuestion = typeof opts.question === "string" ? opts.question : String(opts.question ?? "")
  const safeQ = normalizeTopic(rawQuestion)
  const ctx = typeof opts.context === "string" && opts.context.trim() ? opts.context : "NO_CONTEXT"
  const topic = typeof opts.topic === "string" && opts.topic.trim()
    ? opts.topic.trim()
    : guessTopic(safeQ) || "General"
  const systemPrompt = opts.systemPrompt?.trim() || BASE_SYSTEM_PROMPT
  const historyArr = Array.isArray(opts.history) ? opts.history : undefined
  const historyCache = serializeHistoryForCache(historyArr)

  const ck = { t: opts.cacheScope || "ask_ctx", q: safeQ, ctx, topic, sys: systemPrompt, hist: historyCache }
  const cached = readCache(ck)
  if (cached) return cached

  const messages: any[] = [{ role: "system", content: systemPrompt }]
  for (const msg of toConversationHistory(historyArr)) messages.push(msg)

  messages.push({
    role: "user",
    content: `Context:\n${ctx}\n\nQuestion:\n${safeQ}\n\nTopic:\n${topic}\n\nReturn only the JSON object.`
  })

  const res = await llm.call(messages as any)
  const draft = toText(res).trim()
  const jsonStr = extractFirstJsonObject(draft) || draft
  const parsed = tryParse<any>(jsonStr)

  const out: AskPayload =
    parsed && typeof parsed === "object"
      ? {
        topic: typeof parsed.topic === "string" ? parsed.topic : topic,
        answer: typeof parsed.answer === "string" ? parsed.answer : "",
        flashcards: Array.isArray(parsed.flashcards) ? (parsed.flashcards as AskCard[]) : [],
      }
      : { topic, answer: draft, flashcards: [] }

  writeCache(ck, out)
  return out
}

export async function handleAsk(
  q: string | { q: string; namespace?: string; history?: any[] },
  ns?: string,
  k = 6,
  historyArg?: any[]
): Promise<AskPayload> {
  if (typeof q === "object" && q !== null) {
    const params = q
    return handleAsk(params.q, params.namespace ?? ns, k, params.history ?? historyArg)
  }

  const questionRaw = typeof q === "string" ? q : String(q ?? "")
  const safeQ = normalizeTopic(questionRaw)
  const nsFinal = typeof ns === "string" && ns.trim() ? ns : "pagelm"
  const ctx = await retrieveContext(nsFinal, safeQ, k)
  const topic = guessTopic(safeQ) || "General"

  return askWithContext({
    question: questionRaw,
    context: ctx,
    topic,
    history: historyArg,
    systemPrompt: BASE_SYSTEM_PROMPT,
    cacheScope: `ans:${nsFinal}`
  })
}

export async function handleChatAsk(opts: {
  question: string
  namespace?: string
  history?: HistoryMessage[]
  length?: ResponseLength
  onDelta?: (text: string) => void
}): Promise<AskPayload> {
  const questionRaw = typeof opts.question === "string" ? opts.question : String(opts.question ?? "")
  const safeQ = normalizeTopic(questionRaw)
  const nsFinal = typeof opts.namespace === "string" && opts.namespace.trim() ? opts.namespace : "pagelm"
  const ctx = await retrieveContext(nsFinal, safeQ, 6)
  const topic = guessTopic(safeQ) || "General"

  const messages: any[] = [{ role: "system", content: CHAT_SYSTEM_PROMPT }]
  for (const msg of toConversationHistory(opts.history)) messages.push(msg)
  messages.push({
    role: "user",
    content: `Context:\n${ctx}\n\nQuestion:\n${safeQ}\n\n${lengthInstruction(opts.length)}\nWrite the answer now.`,
  })

  const answer = await streamModel(messages, opts.onDelta)
  const flashcards = await makeFlashcards(safeQ, answer, opts.length)
  return { topic, answer, flashcards }
}
