/** Kept out of the views so the app shell can render the draft's own nav. */
export type DraftTab = 'board' | 'teams' | 'history'

export const DRAFT_TABS: { key: DraftTab; label: string }[] = [
  { key: 'teams', label: 'Teams' },
  { key: 'board', label: 'Draft List' },
  { key: 'history', label: 'History' },
]
