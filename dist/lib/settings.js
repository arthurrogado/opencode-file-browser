export const DEFAULTS = {
  simple: false,
  lineNumbers: true,
  wrap: false,
  tree: "expand",
  panelPreview: true,
  changes: true,
  hidden: false,
  mouse: true,
  search: "name",
  caseSensitive: false,
  confirmDiscard: true
};
export function useSettings(context) {
  const [store, update] = context.storage.store("settings", {
    initial: DEFAULTS
  });
  const value = () => {
    const merged = {
      ...DEFAULTS,
      ...store
    };
    // Older builds stored `collapsed` / `all`; keep those users working.
    if (merged.tree === "collapsed" || merged.tree === "all") merged.tree = "expand";
    return merged;
  };
  return {
    value,
    update,
    reset: () => update(draft => {
      Object.assign(draft, DEFAULTS);
    })
  };
}