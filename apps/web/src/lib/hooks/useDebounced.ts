import { useEffect, useState } from 'react';

/**
 * Returns `value` debounced by `ms` milliseconds. Useful for search inputs
 * where we don't want to fire a query on every keystroke.
 */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}
