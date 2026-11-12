export const DEFAULTS = {
  simple: false,
  lineNumbers: true,
  wrap: false,
  tree: "collapsed",
  panelPreview: true,
  changes: true,
  hidden: false,
  mouse: true,
  search: "name",
  confirmDiscard: true,
  tabWidth: 2
};
export function useSettings(context) {
  const [store, update] = context.storage.store("settings", {
    initial: DEFAULTS
  });
  return {
    value: () => ({
      ...DEFAULTS,
      ...store
    }),
    update,
    reset: () => update(draft => {
      Object.assign(draft, DEFAULTS);
    })
  };
}