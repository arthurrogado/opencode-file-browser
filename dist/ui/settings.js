import { memo as _$memo } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { For, createSignal } from "solid-js";
import { MouseButton, TextAttributes } from "@opentui/core";
import { DEFAULTS } from "../lib/settings.js";
const ROWS = [{
  key: "simple",
  label: "Simple mode",
  hint: "classic list + preview only",
  kind: "toggle"
}, {
  key: "lineNumbers",
  label: "Line numbers",
  hint: "line numbers in viewer and editor",
  kind: "toggle"
}, {
  key: "wrap",
  label: "Wrap lines",
  hint: "wrap text (hides line numbers)",
  kind: "toggle"
}, {
  key: "tree",
  label: "Folders",
  hint: "expand in place or navigate into",
  kind: "choice",
  values: ["expand", "navigate"]
}, {
  key: "panelPreview",
  label: "Panel preview",
  hint: "preview inside the session panel",
  kind: "toggle"
}, {
  key: "changes",
  label: "Changes panel",
  hint: "git stage, commit, push",
  kind: "toggle"
}, {
  key: "hidden",
  label: "Hidden files",
  hint: "list dotfiles",
  kind: "toggle"
}, {
  key: "mouse",
  label: "Mouse",
  hint: "click, scroll and drag",
  kind: "toggle"
}, {
  key: "search",
  label: "Search",
  hint: "default search target",
  kind: "choice",
  values: ["name", "content"]
}, {
  key: "caseSensitive",
  label: "Case sensitive",
  hint: "match case in searches",
  kind: "toggle"
}, {
  key: "confirmDiscard",
  label: "Confirm discard",
  hint: "ask before discarding",
  kind: "toggle"
}];
export function SettingsDialog(props) {
  const theme = props.context.theme;
  const [index, setIndex] = createSignal(0);
  const [draft, setDraft] = createSignal({
    ...props.value
  });
  const set = mutation => {
    const next = {
      ...draft()
    };
    mutation(next);
    setDraft(next);
    props.onChange(mutation);
  };
  const cycle = (row, direction = 1) => {
    const current = draft()[row.key];
    if (row.kind === "toggle") {
      set(next => {
        ;
        next[row.key] = !current;
      });
      return;
    }
    const values = row.values ?? [];
    const at = values.indexOf(String(current));
    const target = values[(at + direction + values.length) % values.length];
    set(next => {
      ;
      next[row.key] = target;
    });
  };
  const label = row => {
    const value = draft()[row.key];
    if (row.kind === "toggle") return value ? "on" : "off";
    return String(value);
  };
  props.context.keymap.layer(() => ({
    mode: "global",
    priority: 200,
    commands: [{
      id: "file-browser.settings.down",
      title: "Next preference",
      bind: "down,j",
      run: () => setIndex(value => Math.min(ROWS.length - 1, value + 1))
    }, {
      id: "file-browser.settings.up",
      title: "Previous preference",
      bind: "up,k",
      run: () => setIndex(value => Math.max(0, value - 1))
    }, {
      id: "file-browser.settings.toggle",
      title: "Toggle preference",
      bind: "space,return",
      run: () => cycle(ROWS[index()])
    }, {
      id: "file-browser.settings.prev",
      title: "Previous value",
      bind: "left",
      run: () => cycle(ROWS[index()], -1)
    }, {
      id: "file-browser.settings.next",
      title: "Next value",
      bind: "right",
      run: () => cycle(ROWS[index()])
    }, {
      id: "file-browser.settings.reset",
      title: "Restore defaults",
      bind: "r",
      run: () => set(next => Object.assign(next, DEFAULTS))
    }, {
      id: "file-browser.settings.close",
      title: "Close preferences",
      bind: "escape,q",
      run: () => props.onClose()
    }]
  }));
  return (() => {
    var _el$ = _$createElement("box"),
      _el$2 = _$createElement("box"),
      _el$3 = _$createElement("text"),
      _el$5 = _$createElement("text"),
      _el$7 = _$createElement("box"),
      _el$8 = _$createElement("text");
    _$insertNode(_el$, _el$2);
    _$insertNode(_el$, _el$7);
    _$setProp(_el$, "flexDirection", "column");
    _$setProp(_el$, "padding", 1);
    _$setProp(_el$, "gap", 0);
    _$insertNode(_el$2, _el$3);
    _$insertNode(_el$2, _el$5);
    _$setProp(_el$2, "flexDirection", "row");
    _$setProp(_el$2, "gap", 1);
    _$insertNode(_el$3, _$createTextNode(`Preferences`));
    _$insertNode(_el$5, _$createTextNode(`saved automatically`));
    _$setProp(_el$5, "flexGrow", 1);
    _$setProp(_el$5, "truncate", true);
    _$insert(_el$, _$createComponent(For, {
      each: ROWS,
      children: (row, position) => (() => {
        var _el$0 = _$createElement("box"),
          _el$1 = _$createElement("box"),
          _el$10 = _$createElement("text"),
          _el$11 = _$createElement("text"),
          _el$12 = _$createElement("text");
        _$insertNode(_el$0, _el$1);
        _$insertNode(_el$0, _el$12);
        _$setProp(_el$0, "flexDirection", "column");
        _$setProp(_el$0, "height", 2);
        _$setProp(_el$0, "paddingLeft", 1);
        _$setProp(_el$0, "paddingRight", 1);
        _$setProp(_el$0, "onMouseUp", event => {
          if (event.button !== MouseButton.LEFT || !draft().mouse) return;
          event.stopPropagation();
          setIndex(position());
          cycle(row);
        });
        _$insertNode(_el$1, _el$10);
        _$insertNode(_el$1, _el$11);
        _$setProp(_el$1, "flexDirection", "row");
        _$setProp(_el$1, "gap", 1);
        _$setProp(_el$10, "wrapMode", "none");
        _$setProp(_el$10, "flexGrow", 1);
        _$setProp(_el$10, "truncate", true);
        _$insert(_el$10, () => (position() === index() ? "› " : "  ") + row.label);
        _$setProp(_el$11, "wrapMode", "none");
        _$setProp(_el$11, "flexShrink", 0);
        _$insert(_el$11, (() => {
          var _c$ = _$memo(() => row.kind === "choice");
          return () => _c$() ? `‹ ${label(row)} ›` : label(row);
        })());
        _$setProp(_el$12, "wrapMode", "none");
        _$setProp(_el$12, "truncate", true);
        _$setProp(_el$12, "paddingLeft", 2);
        _$insert(_el$12, () => row.hint);
        _$effect(_p$ => {
          var _v$6 = position() === index() ? theme.background.raised.max : theme.background.base,
            _v$7 = position() === index() ? theme.text.action.primary.selected : theme.text.base,
            _v$8 = draft()[row.key] === DEFAULTS[row.key] ? theme.text.muted : theme.text.feedback.success.base,
            _v$9 = theme.text.muted;
          _v$6 !== _p$.e && (_p$.e = _$setProp(_el$0, "backgroundColor", _v$6, _p$.e));
          _v$7 !== _p$.t && (_p$.t = _$setProp(_el$10, "fg", _v$7, _p$.t));
          _v$8 !== _p$.a && (_p$.a = _$setProp(_el$11, "fg", _v$8, _p$.a));
          _v$9 !== _p$.o && (_p$.o = _$setProp(_el$12, "fg", _v$9, _p$.o));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined,
          o: undefined
        });
        return _el$0;
      })()
    }), _el$7);
    _$insertNode(_el$7, _el$8);
    _$setProp(_el$7, "height", 1);
    _$setProp(_el$7, "paddingTop", 1);
    _$setProp(_el$7, "flexDirection", "row");
    _$setProp(_el$7, "gap", 2);
    _$insertNode(_el$8, _$createTextNode(`↑↓ · space · ←→ · r · esc`));
    _$setProp(_el$8, "wrapMode", "none");
    _$setProp(_el$8, "flexGrow", 1);
    _$setProp(_el$8, "truncate", true);
    _$effect(_p$ => {
      var _v$ = theme.background.base,
        _v$2 = theme.text.base,
        _v$3 = TextAttributes.BOLD,
        _v$4 = theme.text.muted,
        _v$5 = theme.text.muted;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$, "backgroundColor", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$3, "fg", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp(_el$3, "attributes", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp(_el$5, "fg", _v$4, _p$.o));
      _v$5 !== _p$.i && (_p$.i = _$setProp(_el$8, "fg", _v$5, _p$.i));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined
    });
    return _el$;
  })();
}