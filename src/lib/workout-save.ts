/** Serialize writes so an older autosave cannot overwrite a completed workout. */
export function createSaveQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(write: () => Promise<T>): Promise<T> => {
    const result = tail.catch(() => undefined).then(write);
    tail = result;
    return result;
  };
}
