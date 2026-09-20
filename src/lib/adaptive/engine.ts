import type { MasteryConfig } from './config'
import type { AdaptiveLevel } from './levels'

export type MasteryLevelName =
  | 'Beginner'
  | 'Developing'
  | 'Proficient'
  | 'Advanced'
  | 'Mastered'

// One confirmed answer to one question. `credit` is marks awarded / marks available (0 to 1),
// taken from a human-confirmed evaluation, never from an AI proposal.
export interface AnswerEvent {
  questionId: string
  assessmentId: string
  credit: number
  level: AdaptiveLevel
  timeSec: number | null
  answeredAt: Date
}

export interface MasteryComponents {
  accuracy: number
  recent: number
  difficulty: number
  consistency: number
  raw: number
  confidence: number
  target: number
  highestLevelDemonstrated: number
  capApplied: 'difficulty' | 'evidence' | null
  weights: MasteryConfig['weights']
}

export interface EvidenceCheck {
  met: boolean
  blockers: Array<string>
}

export interface MasteryState {
  questionsAttempted: number
  correctAnswers: number
  wrongAnswers: number
  accuracy: number
  recentAccuracy: number
  difficultyScore: number
  consistencyScore: number
  masteryScore: number
  masteryLevel: MasteryLevelName
  currentLevel: AdaptiveLevel
  hardQuestionsCorrect: number
  masterQuestionsCorrect: number
  consecutiveCorrect: number
  consecutiveWrong: number
  assessmentCount: number
  lastAssessedAt: Date | null
  avgResponseSec: number | null
  evidence: EvidenceCheck
  components: MasteryComponents
}

export function levelForScore(
  score: number,
  config: MasteryConfig,
): MasteryLevelName {
  const l = config.levels
  if (score >= l.mastered) return 'Mastered'
  if (score >= l.advanced) return 'Advanced'
  if (score >= l.proficient) return 'Proficient'
  if (score >= l.developing) return 'Developing'
  return 'Beginner'
}

function mean(values: Array<number>): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
}

function stddev(values: Array<number>): number {
  if (values.length === 0) return 0
  const m = mean(values)
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)))
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function emptyState(config: MasteryConfig): MasteryState {
  return {
    questionsAttempted: 0,
    correctAnswers: 0,
    wrongAnswers: 0,
    accuracy: 0,
    recentAccuracy: 0,
    difficultyScore: 0,
    consistencyScore: 0,
    masteryScore: 0,
    masteryLevel: 'Beginner',
    currentLevel: 1,
    hardQuestionsCorrect: 0,
    masterQuestionsCorrect: 0,
    consecutiveCorrect: 0,
    consecutiveWrong: 0,
    assessmentCount: 0,
    lastAssessedAt: null,
    avgResponseSec: null,
    evidence: {
      met: false,
      blockers: [`Needs at least ${config.evidence.minQuestions} questions`],
    },
    components: {
      accuracy: 0,
      recent: 0,
      difficulty: 0,
      consistency: 0,
      raw: 0,
      confidence: 0,
      target: 0,
      highestLevelDemonstrated: 0,
      capApplied: null,
      weights: config.weights,
    },
  }
}

/**
 * The whole mastery calculation, as a pure function over a concept's answer history.
 *
 * It replays the answers one at a time. After each answer it works out a target score from
 *   accuracy (60%) + recent performance (20%) + difficulty achieved (10%) + consistency (10%),
 * pulls the target towards 50 while there is little evidence, caps it (only easy questions cannot
 * reach Advanced; no Mastered without the evidence rule), and then moves the running score towards
 * the target by at most a few points. That last step is why one mistake barely moves the score,
 * repeated mistakes move it more, and correct answers restore it gradually.
 *
 * The same replay decides the concept's current difficulty step (1 to 4): it only changes after a
 * window of answers, never on a single question.
 */
export function computeMastery(
  events: Array<AnswerEvent>,
  config: MasteryConfig,
): MasteryState {
  if (events.length === 0) return emptyState(config)

  const ordered = [...events].sort(
    (a, b) => a.answeredAt.getTime() - b.answeredAt.getTime(),
  )

  const credits: Array<number> = []
  const assessments = new Set<string>()
  const attemptsByLevel = [0, 0, 0, 0, 0]
  const creditByLevel = [0, 0, 0, 0, 0]
  let correct = 0
  let wrong = 0
  let hardCorrect = 0
  let masterCorrect = 0
  let consecutiveCorrect = 0
  let consecutiveWrong = 0
  let timeSum = 0
  let timeCount = 0
  let score: number | null = null
  let currentLevel: AdaptiveLevel = 1
  let windowStart = 0
  let last: Pick<
    MasteryState,
    'accuracy' | 'recentAccuracy' | 'difficultyScore' | 'consistencyScore' | 'evidence' | 'components'
  > | null = null

  const cfg = config

  for (const [index, event] of ordered.entries()) {
    const credit = Math.min(1, Math.max(0, event.credit))
    credits.push(credit)
    assessments.add(event.assessmentId)
    attemptsByLevel[event.level] += 1
    creditByLevel[event.level] += credit
    if (event.timeSec !== null) {
      timeSum += event.timeSec
      timeCount += 1
    }
    const isCorrect = credit >= cfg.correctCredit
    if (isCorrect) {
      correct += 1
      consecutiveCorrect += 1
      consecutiveWrong = 0
      if (event.level === 3) hardCorrect += 1
      if (event.level === 4) masterCorrect += 1
    } else {
      wrong += 1
      consecutiveWrong += 1
      consecutiveCorrect = 0
    }

    const n = credits.length
    const accuracy = mean(credits) * 100

    const recentSlice = credits.slice(-cfg.recency.window)
    const weightSum = (recentSlice.length * (recentSlice.length + 1)) / 2
    const recent =
      (recentSlice.reduce((sum, c, i) => sum + c * (i + 1), 0) / weightSum) * 100

    let highest = 0
    for (let level = 1; level <= 4; level++) {
      const attempts = attemptsByLevel[level]
      if (
        attempts >= cfg.difficulty.demonstrateMinAttempts &&
        (creditByLevel[level] / attempts) * 100 >= cfg.difficulty.demonstrateMinRate
      ) {
        highest = level
      }
    }
    const difficultyScore = highest * 25

    const consistencySlice = credits.slice(-cfg.recency.window)
    const consistency =
      consistencySlice.length < 3
        ? 50
        : 100 * (1 - Math.min(1, stddev(consistencySlice) / 0.5))

    const raw =
      accuracy * cfg.weights.accuracy +
      recent * cfg.weights.recent +
      difficultyScore * cfg.weights.difficulty +
      consistency * cfg.weights.consistency

    const confidence = Math.min(1, n / cfg.adjustment.fullConfidenceAt)
    let target = 50 + (raw - 50) * confidence
    let capApplied: MasteryComponents['capApplied'] = null

    const difficultyCap =
      highest >= 3
        ? 100
        : cfg.difficulty.scoreCapByHighestLevel[String(highest) as '0' | '1' | '2']
    if (target > difficultyCap) {
      target = difficultyCap
      capApplied = 'difficulty'
    }

    const recentForEvidence = credits.slice(-cfg.evidence.recentWindow)
    const blockers: Array<string> = []
    if (n < cfg.evidence.minQuestions) {
      blockers.push(`Needs at least ${cfg.evidence.minQuestions} questions (has ${n})`)
    }
    if (accuracy < cfg.evidence.minAccuracy) {
      blockers.push(`Overall accuracy must be ${cfg.evidence.minAccuracy}% or more (is ${round1(accuracy)}%)`)
    }
    if (
      recentForEvidence.length < cfg.evidence.recentWindow ||
      mean(recentForEvidence) * 100 < cfg.evidence.minRecentAccuracy
    ) {
      blockers.push(
        `The last ${cfg.evidence.recentWindow} questions must be ${cfg.evidence.minRecentAccuracy}% or more correct`,
      )
    }
    if (hardCorrect + masterCorrect < cfg.evidence.minHardOrMasterCorrect) {
      blockers.push(
        `Needs ${cfg.evidence.minHardOrMasterCorrect} correct Hard or Master answers (has ${hardCorrect + masterCorrect})`,
      )
    }
    if (assessments.size < cfg.evidence.minAssessments) {
      blockers.push(`Needs answers from ${cfg.evidence.minAssessments} separate tests (has ${assessments.size})`)
    }
    const evidence: EvidenceCheck = { met: blockers.length === 0, blockers }

    const noMasteryCeiling = cfg.levels.mastered - 0.1
    if (!evidence.met && target > noMasteryCeiling) {
      target = noMasteryCeiling
      capApplied = 'evidence'
    }

    if (score === null) {
      score = target
    } else if (target < score) {
      const maxDrop =
        consecutiveWrong >= 2
          ? cfg.adjustment.maxDropPerAnswerRepeated
          : cfg.adjustment.maxDropPerAnswer
      score = score - Math.min(score - target, maxDrop)
    } else {
      score = score + Math.min(target - score, cfg.adjustment.maxRisePerAnswer)
    }

    // Difficulty step: judged on a rolling window since the last change, never on one question.
    // Moving UP needs good answers at the current level or above: easy questions answered after
    // the level has already risen prove nothing about the harder level. Moving DOWN counts every
    // answer in the window.
    const window = ordered.slice(windowStart, index + 1).map((e) => ({
      credit: Math.min(1, Math.max(0, e.credit)),
      level: e.level,
    }))
    const recentWindow = window.slice(-cfg.difficulty.windowSize)
    const atOrAbove = recentWindow.filter((w) => w.level >= currentLevel)
    if (
      currentLevel < 4 &&
      atOrAbove.length >= cfg.difficulty.minAnswersToChange &&
      mean(atOrAbove.map((w) => w.credit)) * 100 >= cfg.difficulty.increaseAt
    ) {
      currentLevel = (currentLevel + 1) as AdaptiveLevel
      windowStart = index + 1
    } else if (
      currentLevel > 1 &&
      recentWindow.length >= cfg.difficulty.minAnswersToChange &&
      mean(recentWindow.map((w) => w.credit)) * 100 < cfg.difficulty.decreaseBelow
    ) {
      currentLevel = (currentLevel - 1) as AdaptiveLevel
      windowStart = index + 1
    }

    last = {
      accuracy,
      recentAccuracy: mean(recentForEvidence) * 100,
      difficultyScore,
      consistencyScore: consistency,
      evidence,
      components: {
        accuracy: round1(accuracy),
        recent: round1(recent),
        difficulty: difficultyScore,
        consistency: round1(consistency),
        raw: round1(raw),
        confidence: Math.round(confidence * 100) / 100,
        target: round1(target),
        highestLevelDemonstrated: highest,
        capApplied,
        weights: cfg.weights,
      },
    }
  }

  const finalScore = round1(score ?? 0)
  const finalLast = last!
  return {
    questionsAttempted: credits.length,
    correctAnswers: correct,
    wrongAnswers: wrong,
    accuracy: round1(finalLast.accuracy),
    recentAccuracy: round1(finalLast.recentAccuracy),
    difficultyScore: finalLast.difficultyScore,
    consistencyScore: round1(finalLast.consistencyScore),
    masteryScore: finalScore,
    masteryLevel: levelForScore(finalScore, cfg),
    currentLevel,
    hardQuestionsCorrect: hardCorrect,
    masterQuestionsCorrect: masterCorrect,
    consecutiveCorrect,
    consecutiveWrong,
    assessmentCount: assessments.size,
    lastAssessedAt: ordered[ordered.length - 1].answeredAt,
    avgResponseSec: timeCount > 0 ? Math.round(timeSum / timeCount) : null,
    evidence: finalLast.evidence,
    components: finalLast.components,
  }
}

/** Plain-language answer to "why is this student at this level?" for the audit view. */
export function explainMastery(state: MasteryState, config: MasteryConfig): Array<string> {
  if (state.questionsAttempted === 0) {
    return ['No answers yet. The first assessment uses Easy questions to find where to start.']
  }
  const c = state.components
  const w = config.weights
  const lines = [
    `Mastery ${state.masteryScore} (${state.masteryLevel}) from ${state.questionsAttempted} answers in ${state.assessmentCount} test${state.assessmentCount === 1 ? '' : 's'}.`,
    `Accuracy ${c.accuracy}% x ${w.accuracy}, recent ${c.recent}% x ${w.recent}, difficulty reached ${c.difficulty} x ${w.difficulty}, consistency ${c.consistency} x ${w.consistency} = ${c.raw}.`,
  ]
  if (c.confidence < 1) {
    lines.push(
      `Only ${state.questionsAttempted} of ${config.adjustment.fullConfidenceAt} answers needed for full confidence, so the score is held closer to 50.`,
    )
  }
  if (c.capApplied === 'difficulty') {
    lines.push(
      `Score capped because questions above level ${c.highestLevelDemonstrated} have not yet been answered well.`,
    )
  }
  if (c.capApplied === 'evidence' || !state.evidence.met) {
    lines.push(`Not yet Mastered: ${state.evidence.blockers.join('; ') || 'evidence rule not met'}.`)
  }
  return lines
}

export type RetentionStatus = 'not_applicable' | 'scheduled' | 'due' | 'lapsed'

export interface RetentionState {
  stage: number
  nextAt: Date | null
  status: RetentionStatus
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Retention is revision of a Mastered concept on a widening schedule (7, 21, 60 days by default).
 * A retention test that goes well moves to the next interval; one that goes badly restarts the
 * ladder. If the score later falls out of Mastered the concept is marked 'lapsed' and gets extra
 * questions until it is Mastered again.
 */
export function evolveRetention(params: {
  previousLevel: MasteryLevelName | null
  newLevel: MasteryLevelName
  previous: RetentionState | null
  assessedAt: Date
  assessmentRate: number
  config: MasteryConfig
}): RetentionState {
  const { previousLevel, newLevel, previous, assessedAt, assessmentRate, config } = params
  const days = config.retention.intervalsDays
  const at = (stage: number) => new Date(assessedAt.getTime() + days[stage] * DAY_MS)

  if (newLevel === 'Mastered') {
    if (previousLevel !== 'Mastered' || !previous) {
      return { stage: 0, nextAt: at(0), status: 'scheduled' }
    }
    const wasDue = previous.nextAt !== null && previous.nextAt <= assessedAt
    if (!wasDue) return { ...previous, status: 'scheduled' }
    if (assessmentRate >= 70) {
      const stage = Math.min(previous.stage + 1, days.length - 1)
      return { stage, nextAt: at(stage), status: 'scheduled' }
    }
    return { stage: 0, nextAt: at(0), status: 'scheduled' }
  }

  if (previousLevel === 'Mastered' || previous?.status === 'lapsed') {
    return { stage: 0, nextAt: null, status: 'lapsed' }
  }
  return { stage: 0, nextAt: null, status: 'not_applicable' }
}

export function effectiveRetentionStatus(
  row: { status: RetentionStatus; nextAt: Date | null },
  now: Date,
): RetentionStatus {
  if (row.status === 'scheduled' && row.nextAt !== null && row.nextAt <= now) return 'due'
  return row.status
}
