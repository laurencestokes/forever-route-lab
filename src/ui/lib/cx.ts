/** Joins class names, dropping falsy entries: `cx('a', on && 'b', null)` gives `'a b'` or `'a'`. */
export function cx(...names: readonly (string | false | null | undefined)[]): string {
  let out = '';
  for (const name of names) {
    if (name) out = out === '' ? name : `${out} ${name}`;
  }
  return out;
}
