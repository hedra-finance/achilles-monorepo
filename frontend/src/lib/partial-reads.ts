/** Keep an unavailable read distinct from a confirmed zero or false value. */
export async function readIndependently<K extends string | number, V>(
  keys: readonly K[],
  read: (key: K) => Promise<V>
) {
  const results = await Promise.allSettled(keys.map((key) => read(key)))
  const values = {} as Partial<Record<K, V>>
  const unavailable: K[] = []
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') values[keys[index]] = result.value
    else unavailable.push(keys[index])
  })
  return { values, unavailable }
}
