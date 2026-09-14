const COMBINING_MARKS = /\p{M}/gu;

const DOTLESS_I = /ı/gu;

/**
 * Folds a string to a case- and diacritic-free form for substring search.
 *
 * Guard: `toLocaleLowerCase("en")`, never `toLowerCase()` and never the host
 * locale. `"İsrail".toLowerCase()` is `"i" + U+0307`, so it does not contain
 * `"israil"` — and in Turkish eight country names begin with `İ`. Decomposing
 * first and dropping the combining marks is what collapses that dot, along with
 * the accents in `Türkiye` and `Çekya`.
 *
 * Guard: `ı` is replaced explicitly. Unlike `ğ ş ç ö ü`, the dotless i is a
 * letter in its own right rather than a composition, so NFD leaves it standing
 * and a reader typing `ısrail` would match nothing.
 *
 * Guard: the host locale is refused because under `tr` case rules `"I"` lowers
 * to `"ı"`, which would break the very search this repairs — on Turkish
 * machines only, which is the worst way for it to break.
 */
export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(DOTLESS_I, "i")
    .toLocaleLowerCase("en");
}
