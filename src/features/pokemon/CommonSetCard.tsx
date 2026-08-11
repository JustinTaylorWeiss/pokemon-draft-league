import { useEffect, useState } from 'react'
import type { CommonSet, ItemDex, MoveDex, Pokemon, StatKey, TypeName } from '../../data/types'
import { BST_ORDER, NATURES, STAT_LABELS, natureMultiplier, statAtLevel } from '../../lib/stats'
import { TypeChip } from '../../components/TypeChip'
import { itemIconStyle } from '../../data/load'

/** Doubles formats read as "Gen 9 Doubles OU" rather than "gen9doublesou". */
function formatLabel(format: string): string {
  return format
    .replace(/^gen(\d+)/, 'Gen $1 ')
    .replace(/doublesou/, 'Doubles OU')
    .replace(/vgc(\d+)/, 'VGC $1')
    .replace(/nationaldex/, 'National Dex')
    .replace(/\b(ou|uu|ru|nu|pu|zu|lc|ag)\b/g, (m) => m.toUpperCase())
    .replace(/ubers/, 'Ubers')
    .replace(/monotype/, 'Monotype')
    .trim()
}

/** "252 Atk / 4 SpD / 252 Spe", the way a teambuilder writes a spread. */
function spreadLine(values: Partial<Record<StatKey, number>>, skip: (v: number) => boolean): string {
  return BST_ORDER
    .filter((k) => values[k] !== undefined && !skip(values[k]!))
    .map((k) => `${values[k]} ${STAT_LABELS[k]}`)
    .join(' / ')
}

interface Props {
  mon: Pokemon
  set: CommonSet
  moves: MoveDex | null
  items: ItemDex | null
}

/**
 * The set people actually run, in full: moves, item, ability, nature, Tera,
 * and the spread with the stats it produces.
 *
 * Showdown ships two kinds — a single measured usage set, and Smogon's curated
 * analysis sets, of which a Pokémon can have several. Where there is more than
 * one they are offered as pills rather than merged, because they are genuine
 * alternatives with different items and spreads, not one set.
 */
export function CommonSetCard({ mon, set, moves, items }: Props) {
  const [index, setIndex] = useState(0)
  useEffect(() => { setIndex(0) }, [mon.name])

  const spread = set.spreads[Math.min(index, set.spreads.length - 1)]
  if (!spread) return null

  const level = spread.level ?? 100
  const nature = NATURES[spread.nature ?? '']
  const evLine = spreadLine(spread.evs, () => false)
  // Only worth showing when something has been deliberately dropped from 31.
  const ivLine = spread.ivs ? spreadLine(spread.ivs, (v) => v === 31) : ''

  return (
    <section className="modal-card set-card">
      <h3>
        Most-used Set
        <span className="set-format">{formatLabel(set.format)}</span>
      </h3>

      {set.spreads.length > 1 && (
        <div className="set-pills">
          {set.spreads.map((s, i) => (
            <button
              key={s.name} type="button"
              className={i === index ? 'is-active' : ''}
              onClick={() => setIndex(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <ul className="set-moves">
        {spread.moves.map((move) => {
          // Slashed alternatives are one slot; the first is what the chip shows.
          const primary = move.split('/')[0].trim()
          const data = moves?.[primary.toLowerCase().replace(/[^a-z0-9]/g, '')]
          return (
            <li key={move}>
              {data ? <TypeChip type={data.type} /> : <span className="type-chip is-blank" />}
              <span className="set-move-name">{move}</span>
              {data && (
                <em>{data.basePower > 0 ? `${data.basePower} BP` : data.category}</em>
              )}
            </li>
          )
        })}
      </ul>

      <dl className="set-facts">
        {spread.item && (
          <div>
            <dt>Item</dt>
            <dd className="set-item">
              {(() => {
                const item = items?.[spread.item.toLowerCase().replace(/[^a-z0-9]/g, '')]
                return item ? (
                  <span className="item-icon" style={itemIconStyle(item.spritenum)} title={item.desc} />
                ) : null
              })()}
              {spread.item}
            </dd>
          </div>
        )}
        {spread.ability && <div><dt>Ability</dt><dd>{spread.ability}</dd></div>}
        {spread.nature && (
          <div>
            <dt>Nature</dt>
            <dd>
              {spread.nature}
              {nature && (
                <em className="nature-effect">
                  {' '}+{STAT_LABELS[nature.plus]} −{STAT_LABELS[nature.minus]}
                </em>
              )}
            </dd>
          </div>
        )}
        {spread.teraType && (
          <div>
            <dt>Tera</dt>
            <dd><TypeChip type={spread.teraType as TypeName} /></dd>
          </div>
        )}
        {level !== 100 && <div><dt>Level</dt><dd>{level}</dd></div>}
      </dl>

      <div className="set-spread">
        <span className="set-spread-label">EVs</span>
        <span>{evLine || <em className="none">none</em>}</span>
      </div>
      {ivLine && (
        <div className="set-spread">
          <span className="set-spread-label">IVs</span>
          <span>{ivLine}</span>
        </div>
      )}

      {/* What that spread actually produces, which is the number people are
          reaching for when they read a set. */}
      <table className="set-stats">
        <tbody>
          <tr>
            {BST_ORDER.map((k) => <th key={k} scope="col">{STAT_LABELS[k]}</th>)}
          </tr>
          <tr>
            {BST_ORDER.map((k) => (
              <td
                key={k}
                className={
                  nature?.plus === k ? 'stat-up' : nature?.minus === k ? 'stat-down' : undefined
                }
              >
                {statAtLevel(
                  mon.baseStats[k],
                  spread.evs[k] ?? 0,
                  natureMultiplier(spread.nature, k),
                  k === 'hp',
                  spread.ivs?.[k] ?? 31,
                  level,
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="modal-hint">Stats at level {level} with this spread.</p>
    </section>
  )
}
