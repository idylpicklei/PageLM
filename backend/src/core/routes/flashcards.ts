import db from '../../utils/database/scoped-keyv'

export type SavedFlashcard = {
  id: string
  question: string
  answer: string
  tag: string
  group?: string
  created: number
  due?: number
  interval?: number
  ease?: number
  reps?: number
  lapses?: number
}

type ReviewRating = 'again' | 'good'

const DEFAULT_EASE = 2.5
const MS_PER_DAY = 86_400_000
const MS_AGAIN = 10 * 60 * 1000

async function loadCards(): Promise<SavedFlashcard[]> {
  const cards = await db.get('flashcards')
  return Array.isArray(cards) ? cards : []
}

async function persistCard(card: SavedFlashcard, all: SavedFlashcard[]) {
  const idx = all.findIndex((c) => c.id === card.id)
  if (idx >= 0) all[idx] = card
  await db.set(`flashcard:${card.id}`, card)
  await db.set('flashcards', all)
}

function applyReview(card: SavedFlashcard, rating: ReviewRating): SavedFlashcard {
  const now = Date.now()
  const ease = card.ease ?? DEFAULT_EASE
  const interval = card.interval ?? 0
  const reps = card.reps ?? 0
  const lapses = card.lapses ?? 0

  if (rating === 'again') {
    return {
      ...card,
      reps: 0,
      lapses: lapses + 1,
      ease: Math.max(1.3, ease - 0.2),
      interval: 0,
      due: now + MS_AGAIN,
    }
  }

  const nextReps = reps + 1
  let nextInterval: number
  if (nextReps === 1) nextInterval = 1
  else if (nextReps === 2) nextInterval = 3
  else nextInterval = Math.max(1, Math.round(interval * ease))

  return {
    ...card,
    reps: nextReps,
    interval: nextInterval,
    ease,
    due: now + nextInterval * MS_PER_DAY,
  }
}

export async function saveFlashcardsToGroup(
  group: string,
  cards: Array<{ q?: string; a?: string; question?: string; answer?: string }>,
  tag = 'core'
): Promise<SavedFlashcard[]> {
  const name = String(group || '').trim()
  if (!name || !cards.length) return []
  const all = await loadCards()
  const seen = new Set(
    all
      .filter((c) => String(c.group || '') === name)
      .map((c) => String(c.question || '').trim().toLowerCase())
  )
  const added: SavedFlashcard[] = []
  for (const raw of cards) {
    const question = String(raw.q ?? raw.question ?? '').trim()
    const answer = String(raw.a ?? raw.answer ?? '').trim()
    if (!question || !answer) continue
    const key = question.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const card: SavedFlashcard = {
      id: crypto.randomUUID(),
      question,
      answer,
      tag,
      group: name,
      created: Date.now(),
    }
    all.push(card)
    await db.set(`flashcard:${card.id}`, card)
    added.push(card)
  }
  if (added.length) await db.set('flashcards', all)
  return added
}

export function flashcardRoutes(app: any) {
  app.post('/flashcards', async (req: any, res: any) => {
    try {
      const { question, answer, tag, group } = req.body
      if (!question || !answer || !tag) return res.status(400).send({ error: 'question, answer, tag required' })
      const id = crypto.randomUUID()
      const card: SavedFlashcard = {
        id,
        question,
        answer,
        tag,
        group: typeof group === 'string' && group.trim() ? group.trim() : undefined,
        created: Date.now(),
      }
      const cards = await loadCards()
      cards.push(card)
      await db.set(`flashcard:${id}`, card)
      await db.set('flashcards', cards)
      res.send({ ok: true, flashcard: card })
    } catch (e: any) {
      res.status(500).send({ ok: false, error: e?.message || 'failed' })
    }
  })

  app.get('/flashcards', async (_: any, res: any) => {
    try {
      res.send({ ok: true, flashcards: await loadCards() })
    } catch (e: any) {
      res.status(500).send({ ok: false, error: e?.message || 'failed' })
    }
  })

  app.post('/flashcards/review', async (req: any, res: any) => {
    try {
      const { id, rating } = req.body || {}
      if (!id || (rating !== 'again' && rating !== 'good')) {
        return res.status(400).send({ error: 'id and rating (again|good) required' })
      }
      const cards = await loadCards()
      const idx = cards.findIndex((c) => c.id === id)
      if (idx < 0) return res.status(404).send({ error: 'flashcard not found' })
      const updated = applyReview(cards[idx], rating as ReviewRating)
      await persistCard(updated, cards)
      res.send({ ok: true, flashcard: updated })
    } catch (e: any) {
      res.status(500).send({ ok: false, error: e?.message || 'failed' })
    }
  })

  app.delete('/flashcards/group/:group', async (req: any, res: any) => {
    try {
      const group = decodeURIComponent(String(req.params.group || '')).trim()
      if (!group) return res.status(400).send({ error: 'group required' })
      const cards = await loadCards()
      const keep: SavedFlashcard[] = []
      for (const card of cards) {
        if (String(card.group || '') === group) await db.delete(`flashcard:${card.id}`)
        else keep.push(card)
      }
      await db.set('flashcards', keep)
      res.send({ ok: true })
    } catch (e: any) {
      res.status(500).send({ ok: false, error: e?.message || 'failed' })
    }
  })

  app.delete('/flashcards/:id', async (req: any, res: any) => {
    try {
      const id = req.params.id
      if (!id) return res.status(400).send({ error: 'id required' })
      await db.delete(`flashcard:${id}`)
      const cards = (await loadCards()).filter((c) => c.id !== id)
      await db.set('flashcards', cards)
      res.send({ ok: true })
    } catch (e: any) {
      res.status(500).send({ ok: false, error: e?.message || 'failed' })
    }
  })
}