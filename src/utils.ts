export function memoize<T, U>(fn: (arg: T) => U): ((arg: T) => U) & { results: Map<T, U> } {
  const results = new Map<T, U>();
  const visiting = new Set<T>();

  return Object.assign(
    (value: T) => {
      if (results.has(value))
        return results.get(value)!;
      if (visiting.has(value))
        throw new Error('Cycle detected');
      visiting.add(value);
      const result = fn(value);
      results.set(value, result);
      visiting.delete(value);
      return result;
    },
    { results },
  );
}
