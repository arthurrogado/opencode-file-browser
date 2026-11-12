import { createTextNode as _$createTextNode } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { Show, createSignal, createEffect, onCleanup } from "solid-js";
export const isDirty = doc => doc.text !== doc.original;
const gutterWidth = lines => Math.max(4, String(lines).length + 2);
function Gutter(props) {
  const text = () => {
    const first = Math.max(0, props.start);
    const total = Math.max(1, props.height);
    const last = Math.min(props.lines, first + total);
    const values = [];
    for (let line = first + 1; line <= last; line++) values.push(String(line).padStart(gutterWidth(props.lines) - 1, " ") + " ");
    return values.join("\n") || " ";
  };
  return (() => {
    var _el$ = _$createElement("box"),
      _el$2 = _$createElement("text");
    _$insertNode(_el$, _el$2);
    _$setProp(_el$, "flexShrink", 0);
    _$setProp(_el$, "flexDirection", "column");
    _$setProp(_el$2, "wrapMode", "none");
    _$setProp(_el$2, "selectable", false);
    _$insert(_el$2, text);
    _$effect(_p$ => {
      var _v$ = gutterWidth(props.lines),
        _v$2 = props.theme.text.muted;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$, "width", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$2, "fg", _v$2, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$;
  })();
}
export function EditorView(props) {
  let contentScroll;
  let textarea;
  const [cursor, setCursor] = createSignal({
    line: 1,
    column: 1
  });
  const [scrollLine, setScrollLine] = createSignal(0);
  const [viewport, setViewport] = createSignal(24);
  const lineCount = () => (props.doc.text.match(/\n/g)?.length ?? 0) + 1;
  const syncViewport = () => {
    const scroll = contentScroll;
    if (scroll && !scroll.isDestroyed) setViewport(scroll.viewport.height);
    if (textarea && !textarea.isDestroyed) {
      setScrollLine(textarea.scrollY);
      setViewport(textarea.height);
    }
  };

  // The editor scrolls inside the textarea; the gutter follows its scrollY.
  // Keyboard and mouse moves both end up here, and the timer catches drags.
  const timer = setInterval(syncViewport, 120);
  onCleanup(() => clearInterval(timer));
  createEffect(() => {
    props.doc.path;
    setCursor({
      line: 1,
      column: 1
    });
    setScrollLine(0);
  });

  // The browser owns focus. When it moves to the explorer or the git panel the
  // textarea must release the keyboard, otherwise letters keep landing here.
  createEffect(() => {
    const element = textarea;
    if (!element || element.isDestroyed) return;
    if (props.focused && props.editing && !props.markdownPreview) element.focus();else element.blur();
  });
  createEffect(() => {
    const target = props.line;
    if (!target) return;
    const scroll = contentScroll;
    if (!scroll || scroll.isDestroyed) return;
    setTimeout(() => {
      if (scroll.isDestroyed) return;
      scroll.scrollTo(Math.max(0, target - 3));
    }, 80);
  });
  const gutter = () => props.settings.lineNumbers && !(props.editing && props.settings.wrap);
  return (() => {
    var _el$3 = _$createElement("box"),
      _el$11 = _$createElement("box"),
      _el$12 = _$createElement("text"),
      _el$13 = _$createElement("text"),
      _el$14 = _$createElement("text"),
      _el$15 = _$createTextNode(`Ln `),
      _el$16 = _$createTextNode(`, Col `),
      _el$17 = _$createElement("text"),
      _el$18 = _$createElement("text"),
      _el$19 = _$createElement("text");
    _$insertNode(_el$3, _el$11);
    _$setProp(_el$3, "flexDirection", "column");
    _$setProp(_el$3, "flexGrow", 1);
    _$setProp(_el$3, "minHeight", 0);
    _$insert(_el$3, _$createComponent(Show, {
      get when() {
        return _$memo(() => !!props.editing)() && !props.markdownPreview;
      },
      get children() {
        var _el$4 = _$createElement("box"),
          _el$5 = _$createElement("box"),
          _el$6 = _$createElement("textarea");
        _$insertNode(_el$4, _el$5);
        _$setProp(_el$4, "flexDirection", "row");
        _$setProp(_el$4, "flexGrow", 1);
        _$setProp(_el$4, "minHeight", 0);
        _$insert(_el$4, _$createComponent(Show, {
          get when() {
            return gutter();
          },
          get children() {
            return _$createComponent(Gutter, {
              get theme() {
                return props.theme;
              },
              get lines() {
                return lineCount();
              },
              get start() {
                return scrollLine();
              },
              get height() {
                return viewport();
              }
            });
          }
        }), _el$5);
        _$insertNode(_el$5, _el$6);
        _$setProp(_el$5, "flexGrow", 1);
        _$setProp(_el$5, "minWidth", 0);
        _$setProp(_el$5, "minHeight", 0);
        _$use(element => {
          textarea = element;
          setTimeout(() => {
            if (element && !element.isDestroyed && props.focused) element.focus();
          }, 30);
        }, _el$6);
        _$setProp(_el$6, "onContentChange", () => {
          if (!textarea || textarea.isDestroyed) return;
          const next = textarea.plainText;
          // The buffer can emit one empty change before initialValue lands;
          // never let that wipe the document we just loaded.
          if (next === "" && props.doc.text !== "") return;
          props.onText(next);
        });
        _$setProp(_el$6, "onCursorChange", event => {
          setCursor({
            line: event.line + 1,
            column: event.visualColumn + 1
          });
          props.onCursor(event.line + 1, event.visualColumn + 1);
          syncViewport();
        });
        _$setProp(_el$6, "onKeyDown", event => {
          if (!props.onKey) return;
          if (!props.onKey(event)) return;
          event.preventDefault?.();
          event.stopPropagation?.();
          // Hand focus back to the keymap layer; otherwise the textarea
          // keeps consuming arrows and Enter after we leave the editor.
          if (event.name === "escape" || event.name === "tab") textarea?.blur();
        });
        _$setProp(_el$6, "onMouseScroll", () => setTimeout(syncViewport, 0));
        _$effect(_p$ => {
          var _v$3 = props.doc.text,
            _v$4 = props.syntax,
            _v$5 = props.settings.wrap ? "word" : "none",
            _v$6 = props.theme.background.base,
            _v$7 = props.theme.text.base,
            _v$8 = props.theme.text.base,
            _v$9 = props.theme.background.base;
          _v$3 !== _p$.e && (_p$.e = _$setProp(_el$6, "initialValue", _v$3, _p$.e));
          _v$4 !== _p$.t && (_p$.t = _$setProp(_el$6, "syntaxStyle", _v$4, _p$.t));
          _v$5 !== _p$.a && (_p$.a = _$setProp(_el$6, "wrapMode", _v$5, _p$.a));
          _v$6 !== _p$.o && (_p$.o = _$setProp(_el$6, "backgroundColor", _v$6, _p$.o));
          _v$7 !== _p$.i && (_p$.i = _$setProp(_el$6, "textColor", _v$7, _p$.i));
          _v$8 !== _p$.n && (_p$.n = _$setProp(_el$6, "focusedTextColor", _v$8, _p$.n));
          _v$9 !== _p$.s && (_p$.s = _$setProp(_el$6, "focusedBackgroundColor", _v$9, _p$.s));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined,
          o: undefined,
          i: undefined,
          n: undefined,
          s: undefined
        });
        return _el$4;
      }
    }), _el$11);
    _$insert(_el$3, _$createComponent(Show, {
      get when() {
        return !props.editing || props.markdownPreview;
      },
      get children() {
        return _$createComponent(Show, {
          get when() {
            return _$memo(() => !!props.doc.markdown)() && props.markdownPreview;
          },
          get fallback() {
            return (() => {
              var _el$20 = _$createElement("scrollbox"),
                _el$21 = _$createElement("box"),
                _el$24 = _$createElement("box"),
                _el$25 = _$createElement("code");
              _$insertNode(_el$20, _el$21);
              _$use(element => {
                contentScroll = element;
                setTimeout(syncViewport, 30);
              }, _el$20);
              _$setProp(_el$20, "flexGrow", 1);
              _$setProp(_el$20, "minHeight", 0);
              _$setProp(_el$20, "verticalScrollbarOptions", {
                visible: true
              });
              _$setProp(_el$20, "onMouseScroll", () => setTimeout(syncViewport, 0));
              _$insertNode(_el$21, _el$24);
              _$setProp(_el$21, "flexDirection", "row");
              _$setProp(_el$21, "flexShrink", 0);
              _$insert(_el$21, _$createComponent(Show, {
                get when() {
                  return gutter();
                },
                get children() {
                  var _el$22 = _$createElement("box"),
                    _el$23 = _$createElement("text");
                  _$insertNode(_el$22, _el$23);
                  _$setProp(_el$22, "flexShrink", 0);
                  _$setProp(_el$22, "flexDirection", "column");
                  _$setProp(_el$23, "wrapMode", "none");
                  _$setProp(_el$23, "selectable", false);
                  _$insert(_el$23, () => Array.from({
                    length: lineCount()
                  }, (_, index) => String(index + 1).padStart(gutterWidth(lineCount()) - 1, " ") + " ").join("\n"));
                  _$effect(_p$ => {
                    var _v$18 = gutterWidth(lineCount()),
                      _v$19 = props.theme.text.muted;
                    _v$18 !== _p$.e && (_p$.e = _$setProp(_el$22, "width", _v$18, _p$.e));
                    _v$19 !== _p$.t && (_p$.t = _$setProp(_el$23, "fg", _v$19, _p$.t));
                    return _p$;
                  }, {
                    e: undefined,
                    t: undefined
                  });
                  return _el$22;
                }
              }), _el$24);
              _$insertNode(_el$24, _el$25);
              _$setProp(_el$24, "flexGrow", 1);
              _$setProp(_el$24, "minWidth", 0);
              _$setProp(_el$25, "wrapMode", "none");
              _$effect(_p$ => {
                var _v$20 = props.doc.text,
                  _v$21 = props.doc.type,
                  _v$22 = props.syntax;
                _v$20 !== _p$.e && (_p$.e = _$setProp(_el$25, "content", _v$20, _p$.e));
                _v$21 !== _p$.t && (_p$.t = _$setProp(_el$25, "filetype", _v$21, _p$.t));
                _v$22 !== _p$.a && (_p$.a = _$setProp(_el$25, "syntaxStyle", _v$22, _p$.a));
                return _p$;
              }, {
                e: undefined,
                t: undefined,
                a: undefined
              });
              return _el$20;
            })();
          },
          get children() {
            var _el$7 = _$createElement("scrollbox"),
              _el$8 = _$createElement("box"),
              _el$9 = _$createElement("markdown");
            _$insertNode(_el$7, _el$8);
            _$setProp(_el$7, "flexGrow", 1);
            _$setProp(_el$7, "minHeight", 0);
            _$setProp(_el$7, "verticalScrollbarOptions", {
              visible: true
            });
            _$insertNode(_el$8, _el$9);
            _$setProp(_el$8, "paddingLeft", 1);
            _$setProp(_el$8, "paddingRight", 1);
            _$setProp(_el$8, "flexShrink", 0);
            _$setProp(_el$9, "conceal", true);
            _$effect(_p$ => {
              var _v$0 = props.doc.text,
                _v$1 = props.syntax,
                _v$10 = props.theme.markdown.text,
                _v$11 = props.theme.background.base;
              _v$0 !== _p$.e && (_p$.e = _$setProp(_el$9, "content", _v$0, _p$.e));
              _v$1 !== _p$.t && (_p$.t = _$setProp(_el$9, "syntaxStyle", _v$1, _p$.t));
              _v$10 !== _p$.a && (_p$.a = _$setProp(_el$9, "fg", _v$10, _p$.a));
              _v$11 !== _p$.o && (_p$.o = _$setProp(_el$9, "bg", _v$11, _p$.o));
              return _p$;
            }, {
              e: undefined,
              t: undefined,
              a: undefined,
              o: undefined
            });
            return _el$7;
          }
        });
      }
    }), _el$11);
    _$insert(_el$3, _$createComponent(Show, {
      get when() {
        return props.doc.truncated;
      },
      get children() {
        var _el$0 = _$createElement("box"),
          _el$1 = _$createElement("text");
        _$insertNode(_el$0, _el$1);
        _$setProp(_el$0, "height", 1);
        _$setProp(_el$0, "flexShrink", 0);
        _$setProp(_el$0, "paddingLeft", 2);
        _$insertNode(_el$1, _$createTextNode(`truncated for display · open with an external editor for the full file`));
        _$setProp(_el$1, "wrapMode", "none");
        _$effect(_$p => _$setProp(_el$1, "fg", props.theme.text.feedback.warning.base, _$p));
        return _el$0;
      }
    }), _el$11);
    _$insertNode(_el$11, _el$12);
    _$insertNode(_el$11, _el$13);
    _$insertNode(_el$11, _el$14);
    _$insertNode(_el$11, _el$17);
    _$insertNode(_el$11, _el$18);
    _$insertNode(_el$11, _el$19);
    _$setProp(_el$11, "height", 1);
    _$setProp(_el$11, "flexShrink", 0);
    _$setProp(_el$11, "flexDirection", "row");
    _$setProp(_el$11, "gap", 2);
    _$setProp(_el$11, "paddingLeft", 2);
    _$setProp(_el$11, "paddingRight", 2);
    _$setProp(_el$12, "wrapMode", "none");
    _$insert(_el$12, (() => {
      var _c$ = _$memo(() => !!props.editing);
      return () => _c$() ? "edit" : props.markdownPreview && props.doc.markdown ? "preview" : "read";
    })());
    _$setProp(_el$13, "wrapMode", "none");
    _$insert(_el$13, () => props.doc.type);
    _$insertNode(_el$14, _el$15);
    _$insertNode(_el$14, _el$16);
    _$setProp(_el$14, "wrapMode", "none");
    _$insert(_el$14, () => cursor().line, _el$16);
    _$insert(_el$14, () => cursor().column, null);
    _$setProp(_el$17, "wrapMode", "none");
    _$insert(_el$17, () => isDirty(props.doc) ? "unsaved" : "saved");
    _$setProp(_el$18, "wrapMode", "none");
    _$setProp(_el$18, "flexGrow", 1);
    _$setProp(_el$18, "truncate", true);
    _$insert(_el$18, () => props.doc.external ? "external" : "");
    _$setProp(_el$19, "wrapMode", "none");
    _$insert(_el$19, () => props.settings.wrap && props.editing ? "wrap on" : "");
    _$effect(_p$ => {
      var _v$12 = props.theme.text.muted,
        _v$13 = props.theme.text.muted,
        _v$14 = props.theme.text.muted,
        _v$15 = isDirty(props.doc) ? props.theme.text.feedback.warning.base : props.theme.text.muted,
        _v$16 = props.theme.text.muted,
        _v$17 = props.theme.text.muted;
      _v$12 !== _p$.e && (_p$.e = _$setProp(_el$12, "fg", _v$12, _p$.e));
      _v$13 !== _p$.t && (_p$.t = _$setProp(_el$13, "fg", _v$13, _p$.t));
      _v$14 !== _p$.a && (_p$.a = _$setProp(_el$14, "fg", _v$14, _p$.a));
      _v$15 !== _p$.o && (_p$.o = _$setProp(_el$17, "fg", _v$15, _p$.o));
      _v$16 !== _p$.i && (_p$.i = _$setProp(_el$18, "fg", _v$16, _p$.i));
      _v$17 !== _p$.n && (_p$.n = _$setProp(_el$19, "fg", _v$17, _p$.n));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined
    });
    return _el$3;
  })();
}