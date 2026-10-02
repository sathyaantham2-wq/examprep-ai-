// What a student should do next with one concept or one chapter, and why.
//
// Each piece of advice applies one well-established finding about how people learn, named in
// `principle` so she can see it is not arbitrary: spaced practice, retrieval practice, worked
// examples before problems, mixed (interleaved) practice, practising the weakest part first, and
// short sessions often. Wording follows F072: what to do next and what she gains, never what she
// did wrong.
//
// Pure functions over numbers the overview already sends to the browser; nothing here touches the
// database, so the same module is safe to import from a component.

export interface ConceptAdviceInput {
  mastery_level: string
  accuracy: number | null
  recent_accuracy: number | null
  questions_attempted: number
  /** 'due' and 'lapsed' mean a mastered concept is ready for revision. */
  retention: string
}

export interface StudyAdvice {
  /** The learning principle behind the advice, shown as a small label. */
  principle: string
  /** What to do next, as an instruction. */
  action: string
  /** Why that helps, in one sentence. */
  reason: string
}

// Below this many answers a percentage says very little, so no judgement is made from it.
const MIN_ANSWERS_TO_JUDGE = 5
// How far recent accuracy must move from overall accuracy before it is called a change.
const TREND_POINTS = 15

export function conceptAdvice(c: ConceptAdviceInput): StudyAdvice {
  if (c.retention === 'due' || c.retention === 'lapsed') {
    return {
      principle: 'Spaced practice',
      action: 'Revise this now with a short set.',
      reason:
        'You knew this well. Recalling it just as it starts to fade is what makes it stay until the exam.',
    }
  }
  if (c.questions_attempted === 0) {
    return {
      principle: 'A low-stakes start',
      action: 'Try a short Easy set first.',
      reason:
        'A first attempt shows where to begin, even with mistakes in it. Nothing here counts against you.',
    }
  }
  if (c.mastery_level === 'Mastered') {
    return {
      principle: 'Spaced practice',
      action: 'Leave this one for now.',
      reason:
        'It will come back for revision at the right time. Today is better spent on a concept that is still growing.',
    }
  }
  if (c.questions_attempted < MIN_ANSWERS_TO_JUDGE) {
    return {
      principle: 'Enough answers to tell',
      action: 'Answer a few more questions here.',
      reason:
        'Two or three answers can mislead. Five or six give a true picture of where you stand.',
    }
  }

  const accuracy = c.accuracy ?? 0
  const recent = c.recent_accuracy
  if (accuracy < 50) {
    return {
      principle: 'Worked examples first',
      action: 'Go through one solved example, then try an Easy set.',
      reason:
        'While a topic is still new, studying a solved example teaches more than struggling through questions alone.',
    }
  }
  if (recent !== null && recent <= accuracy - TREND_POINTS) {
    return {
      principle: 'Little and often',
      action:
        'Come back to this with a short set today, and again in two days.',
      reason: `Your recent answers (${Math.round(recent)}%) are below your usual (${Math.round(accuracy)}%). Short, repeated sessions rebuild it faster than one long one.`,
    }
  }
  if (recent !== null && recent >= accuracy + TREND_POINTS && accuracy < 80) {
    return {
      principle: 'Effort is working',
      action: 'Keep going with one more set.',
      reason: `Your recent answers (${Math.round(recent)}%) are well above your overall (${Math.round(accuracy)}%). The practice is paying off.`,
    }
  }
  if (accuracy < 80) {
    return {
      principle: 'Retrieval practice',
      action: 'Practise from memory: answer first, check afterwards.',
      reason:
        'Pulling an answer out of your memory strengthens it far more than reading the notes again.',
    }
  }
  return {
    principle: 'Stretch and mix',
    action: 'Step up: try harder questions, mixed with another chapter.',
    reason:
      'Harder, mixed questions feel slower, but they build the understanding that lasts into the exam.',
  }
}

export interface ChapterAdviceConcept extends ConceptAdviceInput {
  concept_id: string
  concept_name: string
  mastery_score: number | null
}

export interface ChapterAdvice extends StudyAdvice {
  /**
   * The concepts to practise first: revision that is due, then the lowest scores among the ones
   * she has started. Empty when the whole chapter is the right thing to practise.
   */
  focus_concept_ids: Array<string>
}

// A focused paper stays on a few concepts; more than this and it is just the chapter again.
const MAX_FOCUS_CONCEPTS = 3

export function chapterAdvice(
  concepts: Array<ChapterAdviceConcept>,
): ChapterAdvice {
  const started = concepts.filter((c) => c.questions_attempted > 0)
  const due = concepts.filter(
    (c) => c.retention === 'due' || c.retention === 'lapsed',
  )
  const notMastered = started.filter((c) => c.mastery_level !== 'Mastered')

  if (started.length === 0) {
    return {
      principle: 'A low-stakes start',
      action: 'Start this chapter with a short Easy paper.',
      reason:
        'It finds your level in each concept, so later papers spend your time where it helps most.',
      focus_concept_ids: [],
    }
  }
  if (due.length > 0) {
    return {
      principle: 'Spaced practice',
      action:
        due.length === 1
          ? `Revise ${due[0].concept_name} now.`
          : `Revise the ${due.length} concepts that are due.`,
      reason:
        'You knew these well. A quick recall now, before they fade, keeps them until the exam.',
      focus_concept_ids: due
        .slice(0, MAX_FOCUS_CONCEPTS)
        .map((c) => c.concept_id),
    }
  }
  if (notMastered.length === 0) {
    const untried = concepts.length - started.length
    if (untried > 0) {
      return {
        principle: 'A low-stakes start',
        action: `Try the ${untried} concept${untried === 1 ? '' : 's'} you have not started yet.`,
        reason:
          'Everything you have started here is mastered. The rest of the chapter is the next step.',
        focus_concept_ids: concepts
          .filter((c) => c.questions_attempted === 0)
          .slice(0, MAX_FOCUS_CONCEPTS)
          .map((c) => c.concept_id),
      }
    }
    return {
      principle: 'Spaced practice',
      action: 'This chapter is mastered. Leave it for now.',
      reason:
        'It will come back for revision at the right time. Today is better spent on another chapter.',
      focus_concept_ids: [],
    }
  }

  const weakest = [...notMastered].sort(
    (a, b) => (a.mastery_score ?? 0) - (b.mastery_score ?? 0),
  )
  // Only worth singling concepts out when they are a part of the chapter, not all of it.
  const focus =
    notMastered.length < concepts.length ||
    notMastered.length > MAX_FOCUS_CONCEPTS
      ? weakest.slice(0, MAX_FOCUS_CONCEPTS)
      : []
  if (focus.length === 0) {
    return {
      principle: 'Mixed practice',
      action: 'Practise the whole chapter together.',
      reason:
        'Mixing its concepts in one paper makes you choose the method each time, which is exactly what the exam asks.',
      focus_concept_ids: [],
    }
  }
  return {
    principle: 'Weakest part first',
    action:
      focus.length === 1
        ? `Work on ${focus[0].concept_name} first.`
        : `Work on the ${focus.length} concepts with the most to gain.`,
    reason:
      'A short paper on just these moves your chapter score more than repeating what you already know.',
    focus_concept_ids: focus.map((c) => c.concept_id),
  }
}
