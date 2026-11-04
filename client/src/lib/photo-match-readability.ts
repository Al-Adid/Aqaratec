import { parsePhotoGallery } from "./property-photo-gallery";
import { loadPropertyPhotoById } from "./property-media";

/** Reads bounded local references only; no file write or guessed remote URL. */
export async function readMatchingPhotoIds(
  scopeKey: string,
  input: readonly string[]
): Promise<{ ids: string[]; missingCount: number }> {
  const requested = parsePhotoGallery(JSON.stringify({ v: 1, ids: input })).ids;
  const available = await Promise.all(
    requested.map(async id => {
      try {
        return (await loadPropertyPhotoById(scopeKey, id)) ? id : undefined;
      } catch {
        return undefined;
      }
    })
  );
  const ids = available.filter((id): id is string => id !== undefined);
  return { ids, missingCount: requested.length - ids.length };
}
