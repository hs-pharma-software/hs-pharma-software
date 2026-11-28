/** Saves made one after another while the person is already on the next bill:
 * they run one at a time, in the order they were made, so each takes the next
 * number and sees the stock the one before it left. */
let tail: Promise<unknown> = Promise.resolve();

export function inTurn<T>(job: () => Promise<T>): Promise<T> {
  // A save that failed does not stop the ones after it.
  const run = tail.then(job, job);
  tail = run.catch(() => undefined);
  return run;
}
