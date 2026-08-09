/**
 * Renders a partner team name one member per line, keeping the "+" on the end
 * of the line above. "Arune + Justin / Numeral" otherwise wraps wherever it
 * runs out of room, which splits a single person's name across two lines.
 */
export function TeamName({ name }: { name: string }) {
  const parts = name.split(' + ')
  if (parts.length < 2) return <>{name}</>
  return (
    <>
      {parts.map((part, i) => (
        <span key={i} className="team-name-part">
          {/* Non-breaking space so a narrow column never strands the "+"
              alone on a line of its own. */}
          {part}{i < parts.length - 1 ? ' +' : ''}
        </span>
      ))}
    </>
  )
}
