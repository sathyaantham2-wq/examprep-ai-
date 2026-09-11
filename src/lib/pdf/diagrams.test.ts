import { describe, expect, it } from 'vitest'
import { renderDiagramSvg, KNOWN_DIAGRAM_KINDS } from './diagrams'

function countTag(svg: string, tag: string): number {
  return (svg.match(new RegExp(`<${tag}[ />]`, 'g')) ?? []).length
}

describe('renderDiagramSvg (F024)', () => {
  it('returns null for a null or unrecognised diagram_kind -- callers fall back to F035s draw-box', () => {
    expect(renderDiagramSvg(null, undefined)).toBeNull()
    expect(renderDiagramSvg('right-triangle', undefined)).toBeNull()
    expect(renderDiagramSvg('some-custom-kind', { anything: true })).toBeNull()
  })

  it('lists exactly the six diagram kinds the plan names', () => {
    expect(KNOWN_DIAGRAM_KINDS.sort()).toEqual(
      [
        'circuit',
        'intersecting-lines',
        'number-line',
        'place-value',
        'ray-diagram',
        'transversal',
      ].sort(),
    )
  })

  describe('intersecting-lines', () => {
    it('draws two crossing lines and renders up to 4 provided labels', () => {
      const svg = renderDiagramSvg('intersecting-lines', {
        labels: ['a', 'b'],
      })
      expect(svg).toBeTruthy()
      expect(countTag(svg!, 'line')).toBe(2)
      expect(svg).toContain('>a<')
      expect(svg).toContain('>b<')
    })

    it('renders with no params at all (labels are optional)', () => {
      const svg = renderDiagramSvg('intersecting-lines', undefined)
      expect(svg).toBeTruthy()
      expect(countTag(svg!, 'line')).toBe(2)
    })

    it('falls back to a labelled placeholder when params fail the schema', () => {
      const svg = renderDiagramSvg('intersecting-lines', { labels: 'not-an-array' })
      expect(svg).toContain('intersecting lines')
      expect(svg).toContain('stroke-dasharray')
    })
  })

  describe('transversal', () => {
    it('draws two parallel lines plus the transversal (3 lines) and up to 8 labels', () => {
      const svg = renderDiagramSvg('transversal', {
        labels: ['1', '2', '3', '4', '5', '6', '7', '8'],
      })!
      expect(countTag(svg, 'line')).toBe(3)
      for (const label of ['1', '2', '3', '4', '5', '6', '7', '8']) {
        expect(svg).toContain(`>${label}<`)
      }
    })
  })

  describe('number-line', () => {
    it('places a tick at every step from min to max and a marker per point', () => {
      const svg = renderDiagramSvg('number-line', {
        min: 0,
        max: 5,
        step: 1,
        points: [{ value: 2, label: 'A' }],
      })!
      // 6 ticks (0..5) -> 6 <line> ticks + 1 base line = 7
      expect(countTag(svg, 'line')).toBe(7)
      expect(countTag(svg, 'circle')).toBe(1)
      expect(svg).toContain('>A<')
    })

    it('rejects max <= min rather than dividing by zero', () => {
      const svg = renderDiagramSvg('number-line', { min: 5, max: 5 })
      expect(svg).toContain('number line')
      expect(svg).toContain('stroke-dasharray')
    })
  })

  describe('place-value', () => {
    it('draws one cell per column/digit pair', () => {
      const svg = renderDiagramSvg('place-value', {
        columns: ['Th', 'H', 'T', 'O'],
        digits: [4, 2, 7, 5],
      })!
      expect(countTag(svg, 'rect')).toBe(4)
      expect(svg).toContain('>Th<')
      expect(svg).toContain('>7<')
    })

    it('requires at least one column and digit', () => {
      const svg = renderDiagramSvg('place-value', { columns: [], digits: [] })
      expect(svg).toContain('place value')
    })
  })

  describe('circuit', () => {
    it('defaults to a battery and a bulb when components is omitted', () => {
      const svg = renderDiagramSvg('circuit', undefined)!
      expect(countTag(svg, 'circle')).toBeGreaterThan(0) // the bulb
      expect(svg).toContain('+') // the battery polarity mark
    })

    it('omits the bulb and switch marks entirely when not requested', () => {
      const svg = renderDiagramSvg('circuit', { components: ['battery'] })!
      expect(countTag(svg, 'circle')).toBe(0)
      expect(svg).toContain('+')
    })

    it('rejects an unknown component name', () => {
      const svg = renderDiagramSvg('circuit', { components: ['resistor'] })
      expect(svg).toContain('circuit')
      expect(svg).toContain('stroke-dasharray')
    })
  })

  describe('ray-diagram', () => {
    it('draws one line per ray from the vertex and labels it', () => {
      const svg = renderDiagramSvg('ray-diagram', {
        rays: [
          { angle: 0, label: 'A' },
          { angle: 90, label: 'B' },
          { angle: 180 },
        ],
      })!
      expect(countTag(svg, 'line')).toBe(3)
      expect(svg).toContain('>A<')
      expect(svg).toContain('>B<')
    })

    it('requires at least one ray', () => {
      const svg = renderDiagramSvg('ray-diagram', { rays: [] })
      expect(svg).toContain('ray diagram')
    })
  })
})
