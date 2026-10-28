// Deep copy of arrays, typed arrays and plain objects; functions and class instances are kept by reference. `structuredClone` throws on functions nested in options, e.g. shot easings.
function copy<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copy) as T;
  if (ArrayBuffer.isView(value))
    return (value as unknown as Float64Array).slice() as T;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = copy(entry);
    return out as T;
  }
  return value;
}

/**
 * Assign defined options without aliasing: arrays are written into existing
 * ones, other values copied. `lens`, functions and class instances are kept by
 * reference.
 */
export function assignOptions<T extends object>(target: T, options: object): T {
  const self = target as Record<string, unknown>;

  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue;

    // Own data properties only: accessors may return copies.
    const current = Object.getOwnPropertyDescriptor(target, key)?.value;

    if (
      Array.isArray(current) &&
      (Array.isArray(value) || ArrayBuffer.isView(value))
    ) {
      // References held elsewhere, e.g. `camera.position`, stay valid.
      current.splice(
        0,
        current.length,
        ...Array.from(value as ArrayLike<unknown>, copy),
      );
    } else {
      // Lenses may be live views with getters, e.g. from adapters.
      self[key] = key === "lens" ? value : copy(value);
    }
  }

  return target;
}
