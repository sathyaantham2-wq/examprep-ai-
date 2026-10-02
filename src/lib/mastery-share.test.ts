import { describe, expect, it } from 'vitest'
import { masteryShareText, whatsAppUrl } from './mastery-share'
import type { SubjectView } from '../components/adaptive-overview'

function subject(name: string, chapters: Array<[string, number, string, number | null]>): SubjectView {
  return {
    subject_id: name,
    subject_name: name,
    has_content: true,
    concepts_total: 0,
    concepts_assessed: 0,
    average_mastery: null,
    mastered_count: 0,
    chapters: chapters.map(([part, no, chapter_name, average_mastery]) => ({
      chapter_id: `${name}-${part}-${no}`,
      chapter_name,
      part,
      chapter_no: no,
      average_mastery,
      concepts: [],
    })),
  }
}

describe('masteryShareText', () => {
  it('lists assessed chapters with rounded percentages, and leaves out unassessed ones', () => {
    const text = masteryShareText('Asha', [
      subject('Mathematics', [
        ['I', 1, 'Fractions', 82.4],
        ['II', 3, 'Data', 40.6],
        ['I', 2, 'Not started yet', null],
      ]),
      subject('Science', [['I', 1, 'Light', null]]),
    ])
    expect(text).toBe(
      [
        "Asha's chapter mastery on PrepPlan",
        '',
        'Mathematics',
        '- Ch 1 Fractions: 82%',
        '- II Ch 3 Data: 41%',
      ].join('\n'),
    )
  })

  it('says so when nothing has been assessed', () => {
    expect(masteryShareText('Asha', [subject('Mathematics', [['I', 1, 'x', null]])])).toContain(
      'No chapters assessed yet.',
    )
  })

  it('never includes an email or marks wording', () => {
    const text = masteryShareText('Asha', [subject('Mathematics', [['I', 1, 'Fractions', 50]])])
    expect(text).not.toMatch(/@|marks/i)
  })
})

describe('whatsAppUrl', () => {
  it('encodes the text for wa.me', () => {
    expect(whatsAppUrl('a b\n50%')).toBe('https://wa.me/?text=a%20b%0A50%25')
  })
})
