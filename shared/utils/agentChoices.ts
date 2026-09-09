interface CustomChoiceOption {
  id: string
  label: string
  description?: string
  custom?: boolean
}

/** Also used by restored cards so older sessions can accept custom answers. */
export function withCustomChoiceOption<T extends CustomChoiceOption>(options: T[]): Array<T | CustomChoiceOption> {
  if (options.some(option => option.custom))
    return options
  const ids = new Set(options.map(option => option.id))
  let id = 'other'
  for (let suffix = 2; ids.has(id); suffix++)
    id = `other_${suffix}`
  return [...options, {
    id,
    label: 'Other',
    description: 'Type your own answer.',
    custom: true,
  }]
}
