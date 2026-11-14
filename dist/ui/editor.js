import { createComponent as _$createComponent } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { Show, createMemo, createSignal, createEffect, onCleanup } from "solid-js";
import { TextAttributes } from "@opentui/core";
export const isDirty = doc => doc.diff ? false : doc.text !== doc.original;
const gutterWidth = lines => Math.max(4, String(lines).length + 2);
const KEYWORDS = new Set("abstract as async await break case catch class const continue debugger default delete do else enum export extends false finally for from function get if implements import in instanceof interface let new null of private protected public readonly return set static super switch this throw true try type typeof undefined var void while yield".split(" "));
/**
 * Cheap per-line tokenizer. The host textarea has no tree-sitter integration,
 * so edit mode keeps colours through extmarks instead of the renderer's
 * highlighter. Only the common languages get real rules; everything else gets
 * comments/strings/numbers.
 */
function tokenize(line, type) {
  const tokens = [];
  const push = (start, end, kind) => {
    if (end > start) tokens.push([start, end, kind]);
  };
  const markdown = type === "markdown";
  const python = type === "python" || type === "bash";
  const hashComments = python || type === "yaml" || type === "toml" || type === "ruby";
  if (markdown) {
    const heading = /^(#{1,6})\s+.*$/.exec(line);
    if (heading) {
      push(0, line.length, "keyword");
      return tokens;
    }
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      push(fence.index, fence.index + fence[0].trim().length, "type");
      return tokens;
    }
    for (const match of line.matchAll(/(`[^`]+`)|(\[[^\]]*\]\([^)]*\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g)) {
      const kind = match[1] ? "string" : match[2] ? "function" : "keyword";
      push(match.index, match.index + match[0].length, kind);
    }
    return tokens;
  }
  const pattern = /(\/\/.*$|#.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|([{}()[\];,.:=+\-*/<>!&|?]+)/g;
  let match;
  while (match = pattern.exec(line)) {
    const [text,, stringValue, number, word, punct] = match;
    const start = match.index;
    if (match[1] && (match[1].startsWith("//") || match[1].startsWith("#") || match[1].startsWith("/*"))) {
      // `#` is only a comment when the language says so; otherwise it is a
      // private field or a CSS colour and must be left alone.
      if (hashComments || match[1].startsWith("//") || match[1].startsWith("/*")) {
        push(start, start + text.length, "comment");
        break;
      }
    }
    if (stringValue) push(start, start + text.length, "string");else if (number) push(start, start + text.length, "number");else if (word) {
      if (KEYWORDS.has(word)) push(start, start + text.length, "keyword");else if (/^[A-Z]/.test(word)) push(start, start + text.length, "type");else if (line[pattern.lastIndex] === "(") push(start, start + text.length, "function");
    } else if (punct) push(start, start + text.length, "punctuation");
  }
  return tokens;
}
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

/** One-column scroll indicator drawn from the absolute scroll position. */
function ScrollBar(props) {
  const S = "\u2588";
  const text = () => {
    const height = Math.max(1, props.height);
    if (props.total <= props.viewport || props.viewport <= 0) return "░".repeat(height);
    const thumb = Math.max(1, Math.round(props.viewport / props.total * height));
    const max = props.total - props.viewport;
    const at = Math.round(Math.max(0, Math.min(max, props.start)) / max * (height - thumb));
    return "░".repeat(at) + S.repeat(thumb) + "░".repeat(Math.max(0, height - at - thumb));
  };
  return (() => {
    var _el$3 = _$createElement("box"),
      _el$4 = _$createElement("text");
    _$insertNode(_el$3, _el$4);
    _$setProp(_el$3, "width", 1);
    _$setProp(_el$3, "flexShrink", 0);
    _$setProp(_el$3, "flexDirection", "column");
    _$setProp(_el$4, "wrapMode", "none");
    _$setProp(_el$4, "selectable", false);
    _$insert(_el$4, text);
    _$effect(_$p => _$setProp(_el$4, "fg", props.theme.text.feedback.info.base, _$p));
    return _el$3;
  })();
}
export function EditorView(props) {
  let contentScroll;
  let textarea;
  let findInput;
  let highlightTypeId;
  let highlightTimer;
  let mounted = true;
  const mountedAt = Date.now();
  const [cursor, setCursor] = createSignal({
    line: 1,
    column: 1
  });
  const [scrollLine, setScrollLine] = createSignal(0);
  const [viewport, setViewport] = createSignal(24);
  const [findOpen, setFindOpen] = createSignal(false);
  const [findQuery, setFindQuery] = createSignal("");
  const [findStatus, setFindStatus] = createSignal("");
  const [previewLine, setPreviewLine] = createSignal(1);
  const [hOffset, setHOffset] = createSignal(0);
  const [hWidth, setHWidth] = createSignal(0);
  let hbar;
  const longest = createMemo(() => {
    let max = 0;
    for (const line of props.doc.text.split("\n", 5000)) if (line.length > max) max = line.length;
    return max;
  });
  onCleanup(() => {
    mounted = false;
    clearInterval(timer);
    clearTimeout(highlightTimer);
    if (textarea && !textarea.isDestroyed) {
      try {
        const cursor = textarea.logicalCursor;
        props.onPosition?.({
          line: cursor.row + 1,
          column: cursor.col + 1
        });
      } catch {}
    } else if (contentScroll && !contentScroll.isDestroyed) {
      props.onPosition?.({
        scroll: contentScroll.scrollTop
      });
    }
  });
  const lineCount = () => (props.doc.text.match(/\n/g)?.length ?? 0) + 1;
  const syncViewport = () => {
    const scroll = contentScroll;
    if (scroll && !scroll.isDestroyed) setViewport(scroll.viewport.height);
    if (textarea && !textarea.isDestroyed) {
      setScrollLine(textarea.scrollY);
      setViewport(textarea.height);
      try {
        const viewport = textarea.editorView.getViewport();
        setHOffset(viewport.offsetX);
        setHWidth(viewport.width);
      } catch {}
    }
    if (scroll && !scroll.isDestroyed) {
      const total = Math.max(1, lineCount());
      const max = Math.max(1, scroll.scrollHeight - scroll.viewport.height);
      const line = Math.min(total, Math.max(1, Math.round(scroll.scrollTop / max * (total - 1)) + 1));
      setPreviewLine(line);
      props.onPosition?.({
        scroll: scroll.scrollTop,
        line
      });
    }
  };
  const timer = setInterval(syncViewport, 100);
  const focusNow = () => {
    const element = textarea;
    if (!element || element.isDestroyed || !mounted) return;
    try {
      element.focus();
    } catch {}
  };

  // The host reconciles focus one frame after a pane switch, so a single
  // focus() call can be undone. Retry briefly until the textarea really owns
  // the keyboard; this is what made editing "lock up" after tab navigation.
  const focusEditor = () => {
    for (const delay of [0, 24, 60, 120, 220]) setTimeout(() => {
      if (!mounted) return;
      if (!props.focused || !props.editing || props.markdownPreview) return;
      if (textarea && !textarea.isDestroyed && !textarea.focused) focusNow();
    }, delay);
  };
  createEffect(() => {
    // Read the reactive props *before* the ref check: reading only the plain
    // `textarea` variable would leave the effect with no dependencies and it
    // would never run again after the first (ref-less) run.
    const want = props.focused && props.editing && !props.markdownPreview;
    const element = textarea;
    if (want) focusEditor();else if (element && !element.isDestroyed) {
      try {
        element.blur();
      } catch {}
    }
  });
  createEffect(() => {
    const revision = props.doc.rev ?? 0;
    if (!revision) return;
    const element = textarea;
    if (!element || element.isDestroyed) return;
    try {
      element.editBuffer.setText(props.doc.text);
      setCursor({
        line: 1,
        column: 1
      });
      scheduleHighlight();
    } catch {}
  });
  createEffect(() => {
    props.doc.path;
    setCursor({
      line: 1,
      column: 1
    });
    setScrollLine(0);
    setFindOpen(false);
    setFindQuery("");
    setTimeout(() => {
      syncViewport();
      scheduleHighlight();
    }, 40);
  });

  // Turning wrapping on and off reflows the buffer; reset the horizontal
  // offset so the text never ends up scrolled past the visible area.
  let lastWrap = props.settings.wrap;
  createEffect(() => {
    const wrap = props.settings.wrap;
    if (wrap === lastWrap) return;
    lastWrap = wrap;
    const element = textarea;
    if (!element || element.isDestroyed) return;
    setTimeout(() => {
      try {
        // Some hosts rebuild the buffer when the wrap mode changes; restore it
        // from the document if that left the editor blank.
        if (props.doc.text && !element.plainText) element.editBuffer.setText(props.doc.text);
        const viewport = element.editorView.getViewport();
        if (viewport.width > 0 && viewport.height > 0) {
          element.editorView.setViewport(0, viewport.offsetY, viewport.width, viewport.height, false);
        }
        syncViewport();
      } catch {}
    }, 40);
  });

  // ---------------------------------------------------------------- highlight
  function ensureType() {
    if (highlightTypeId !== undefined) return highlightTypeId;
    const element = textarea;
    if (!element || element.isDestroyed) return undefined;
    highlightTypeId = element.extmarks.registerType("ofb-highlight");
    return highlightTypeId;
  }
  function applyHighlights() {
    const element = textarea;
    if (!element || element.isDestroyed) return;
    if (props.settings.simple || props.markdownPreview || props.doc.diff) return;
    const text = props.doc.text;
    if (text.length > 200_000 || lineCount() > 3_000) return;
    const typeId = ensureType();
    if (typeId === undefined) return;
    try {
      for (const mark of element.extmarks.getAllForTypeId(typeId)) element.extmarks.delete(mark.id);
    } catch {}
    const style = name => {
      const id = props.syntax.getStyleId(name);
      return id === undefined ? null : id;
    };
    const ids = {
      comment: style("comment"),
      string: style("string"),
      number: style("number"),
      keyword: style("keyword"),
      function: style("function"),
      type: style("type"),
      punctuation: style("punctuation")
    };
    let lineStart = 0;
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (line.length <= 400) {
        for (const [start, end, kind] of tokenize(line, props.doc.type)) {
          const styleId = ids[kind];
          if (!styleId) continue;
          try {
            element.extmarks.create({
              start: lineStart + start,
              end: lineStart + end,
              styleId,
              priority: 10,
              typeId
            });
          } catch {}
        }
      }
      lineStart += line.length + 1;
    }
  }
  function scheduleHighlight() {
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      try {
        applyHighlights();
      } catch {}
    }, 180);
  }

  // -------------------------------------------------------------- find in file
  function runFind(from = textarea?.cursorOffset ?? 0) {
    const query = findQuery();
    if (!query || !textarea) return;
    const text = props.doc.text.toLowerCase();
    const needle = query.toLowerCase();
    const at = text.indexOf(needle, from);
    const found = at >= 0 ? at : text.indexOf(needle, 0);
    if (found < 0) {
      setFindStatus("not found");
      return;
    }
    try {
      textarea.editBuffer.setCursorByOffset(found);
      setFindStatus(`match at ${found + 1}`);
    } catch {}
  }
  function leaveFind() {
    setFindOpen(false);
    setFindQuery("");
    setFindStatus("");
    focusEditor();
  }
  const gutter = () => props.settings.lineNumbers && !props.settings.wrap;
  if (props.doc.oversize) {
    return (() => {
      var _el$5 = _$createElement("box"),
        _el$6 = _$createElement("text"),
        _el$8 = _$createElement("text"),
        _el$9 = _$createTextNode(` lines · `),
        _el$0 = _$createElement("text");
      _$insertNode(_el$5, _el$6);
      _$insertNode(_el$5, _el$8);
      _$insertNode(_el$5, _el$0);
      _$setProp(_el$5, "flexDirection", "column");
      _$setProp(_el$5, "flexGrow", 1);
      _$setProp(_el$5, "minHeight", 0);
      _$setProp(_el$5, "alignItems", "center");
      _$setProp(_el$5, "justifyContent", "center");
      _$setProp(_el$5, "gap", 1);
      _$insertNode(_el$6, _$createTextNode(`file too large to render`));
      _$insertNode(_el$8, _el$9);
      _$setProp(_el$8, "wrapMode", "none");
      _$insert(_el$8, () => props.doc.lines ?? "many", _el$9);
      _$insert(_el$8, () => props.doc.type, null);
      _$insertNode(_el$0, _$createTextNode(`The TUI stays responsive by not loading it. Open it in an external editor, or raise the limits in src/lib/util.ts if you really need it here.`));
      _$setProp(_el$0, "wrapMode", "word");
      _$effect(_p$ => {
        var _v$3 = props.theme.text.feedback.warning.base,
          _v$4 = TextAttributes.BOLD,
          _v$5 = props.theme.text.base,
          _v$6 = props.theme.text.muted;
        _v$3 !== _p$.e && (_p$.e = _$setProp(_el$6, "fg", _v$3, _p$.e));
        _v$4 !== _p$.t && (_p$.t = _$setProp(_el$6, "attributes", _v$4, _p$.t));
        _v$5 !== _p$.a && (_p$.a = _$setProp(_el$8, "fg", _v$5, _p$.a));
        _v$6 !== _p$.o && (_p$.o = _$setProp(_el$0, "fg", _v$6, _p$.o));
        return _p$;
      }, {
        e: undefined,
        t: undefined,
        a: undefined,
        o: undefined
      });
      return _el$5;
    })();
  }
  return (() => {
    var _el$10 = _$createElement("box"),
      _el$22 = _$createElement("box"),
      _el$36 = _$createElement("box"),
      _el$37 = _$createElement("text"),
      _el$38 = _$createElement("text"),
      _el$39 = _$createElement("text"),
      _el$40 = _$createElement("text"),
      _el$41 = _$createElement("text");
    _$insertNode(_el$10, _el$22);
    _$insertNode(_el$10, _el$36);
    _$setProp(_el$10, "flexDirection", "column");
    _$setProp(_el$10, "flexGrow", 1);
    _$setProp(_el$10, "minHeight", 0);
    _$insert(_el$10, _$createComponent(Show, {
      get when() {
        return findOpen();
      },
      get children() {
        var _el$11 = _$createElement("box"),
          _el$12 = _$createElement("text"),
          _el$14 = _$createElement("box"),
          _el$15 = _$createElement("input"),
          _el$16 = _$createElement("text");
        _$insertNode(_el$11, _el$12);
        _$insertNode(_el$11, _el$14);
        _$insertNode(_el$11, _el$16);
        _$setProp(_el$11, "height", 1);
        _$setProp(_el$11, "flexShrink", 0);
        _$setProp(_el$11, "flexDirection", "row");
        _$setProp(_el$11, "gap", 1);
        _$setProp(_el$11, "paddingLeft", 1);
        _$setProp(_el$11, "paddingRight", 1);
        _$insertNode(_el$12, _$createTextNode(`find`));
        _$setProp(_el$12, "wrapMode", "none");
        _$insertNode(_el$14, _el$15);
        _$setProp(_el$14, "flexGrow", 1);
        _$setProp(_el$14, "minWidth", 0);
        _$use(element => {
          findInput = element;
          setTimeout(() => {
            try {
              element.focus();
            } catch {}
          }, 20);
        }, _el$15);
        _$setProp(_el$15, "placeholder", "text in this file");
        _$setProp(_el$15, "onInput", value => {
          setFindQuery(value);
          setFindStatus("");
        });
        _$setProp(_el$15, "onKeyDown", event => {
          const key = String(event.name ?? event.key ?? "").toLowerCase();
          if (key === "escape") {
            event.preventDefault?.();
            leaveFind();
            return;
          }
          if (key === "return") {
            event.preventDefault?.();
            runFind((textarea?.cursorOffset ?? 0) + 1);
          }
        });
        _$setProp(_el$16, "wrapMode", "none");
        _$insert(_el$16, () => findStatus() || "enter next · esc close");
        _$effect(_p$ => {
          var _v$7 = props.theme.text.base,
            _v$8 = TextAttributes.BOLD,
            _v$9 = findQuery(),
            _v$0 = props.theme.background.raised.base,
            _v$1 = props.theme.text.base,
            _v$10 = props.theme.text.muted;
          _v$7 !== _p$.e && (_p$.e = _$setProp(_el$12, "fg", _v$7, _p$.e));
          _v$8 !== _p$.t && (_p$.t = _$setProp(_el$12, "attributes", _v$8, _p$.t));
          _v$9 !== _p$.a && (_p$.a = _$setProp(_el$15, "value", _v$9, _p$.a));
          _v$0 !== _p$.o && (_p$.o = _$setProp(_el$15, "backgroundColor", _v$0, _p$.o));
          _v$1 !== _p$.i && (_p$.i = _$setProp(_el$15, "textColor", _v$1, _p$.i));
          _v$10 !== _p$.n && (_p$.n = _$setProp(_el$16, "fg", _v$10, _p$.n));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined,
          o: undefined,
          i: undefined,
          n: undefined
        });
        return _el$11;
      }
    }), _el$22);
    _$insert(_el$10, _$createComponent(Show, {
      get when() {
        return _$memo(() => !!props.editing)() && !props.markdownPreview;
      },
      get children() {
        var _el$17 = _$createElement("box"),
          _el$18 = _$createElement("text"),
          _el$20 = _$createElement("text");
        _$insertNode(_el$17, _el$18);
        _$insertNode(_el$17, _el$20);
        _$setProp(_el$17, "height", 1);
        _$setProp(_el$17, "flexShrink", 0);
        _$setProp(_el$17, "flexDirection", "row");
        _$setProp(_el$17, "gap", 2);
        _$setProp(_el$17, "paddingLeft", 2);
        _$setProp(_el$17, "paddingRight", 2);
        _$insertNode(_el$18, _$createTextNode(`editing`));
        _$setProp(_el$18, "wrapMode", "none");
        _$setProp(_el$18, "flexShrink", 0);
        _$insertNode(_el$20, _$createTextNode(`ctrl+s save · ctrl+f find · esc leaves · F4 preview`));
        _$setProp(_el$20, "wrapMode", "none");
        _$setProp(_el$20, "truncate", true);
        _$setProp(_el$20, "flexGrow", 1);
        _$effect(_p$ => {
          var _v$11 = props.theme.text.feedback.warning.base,
            _v$12 = props.theme.text.muted;
          _v$11 !== _p$.e && (_p$.e = _$setProp(_el$18, "fg", _v$11, _p$.e));
          _v$12 !== _p$.t && (_p$.t = _$setProp(_el$20, "fg", _v$12, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$17;
      }
    }), _el$22);
    _$setProp(_el$22, "flexDirection", "column");
    _$setProp(_el$22, "flexGrow", 1);
    _$setProp(_el$22, "minHeight", 0);
    _$insert(_el$22, _$createComponent(Show, {
      get when() {
        return _$memo(() => !!props.editing)() && !props.markdownPreview;
      },
      get children() {
        return [(() => {
          var _el$23 = _$createElement("box"),
            _el$24 = _$createElement("box"),
            _el$25 = _$createElement("textarea");
          _$insertNode(_el$23, _el$24);
          _$setProp(_el$23, "flexDirection", "row");
          _$setProp(_el$23, "flexGrow", 1);
          _$setProp(_el$23, "minHeight", 0);
          _$insert(_el$23, _$createComponent(Show, {
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
          }), _el$24);
          _$insertNode(_el$24, _el$25);
          _$setProp(_el$24, "flexGrow", 1);
          _$setProp(_el$24, "minWidth", 0);
          _$setProp(_el$24, "minHeight", 0);
          _$use(element => {
            textarea = element;
            props.onReady?.({
              newline: () => {
                if (!element || element.isDestroyed) return;
                try {
                  element.editBuffer.newLine();
                  props.onText(element.plainText);
                  scheduleHighlight();
                  syncViewport();
                } catch {}
              }
            });
            setTimeout(() => {
              if (element && !element.isDestroyed) {
                try {
                  if (props.initialLine) {
                    element.editBuffer.setCursor((props.initialLine ?? 1) - 1, (props.initialColumn ?? 1) - 1);
                  }
                } catch {}
                if (props.focused) focusEditor();
              }
              scheduleHighlight();
              syncViewport();
            }, 30);
          }, _el$25);
          _$setProp(_el$25, "onContentChange", () => {
            if (!textarea || textarea.isDestroyed) return;
            const next = textarea.plainText;
            if (next === "" && props.doc.text !== "") return;
            props.onText(next);
            scheduleHighlight();
            syncViewport();
          });
          _$setProp(_el$25, "onCursorChange", event => {
            setCursor({
              line: event.line + 1,
              column: event.visualColumn + 1
            });
            props.onCursor(event.line + 1, event.visualColumn + 1);
            props.onPosition?.({
              line: event.line + 1,
              column: event.visualColumn + 1
            });
            syncViewport();
          });
          _$setProp(_el$25, "onKeyDown", event => {
            // A key that opened this document can still be dispatched after
            // the textarea mounts; don't let it land in the buffer.
            if (Date.now() - mountedAt < 120) {
              event.preventDefault?.();
              event.stopPropagation?.();
              return;
            }
            const key = String(event.name ?? event.key ?? "").toLowerCase();
            const ctrl = !!(event.ctrl || event.meta);
            if (key === "return") {
              event.preventDefault?.();
              event.stopPropagation?.();
              try {
                textarea?.editBuffer.newLine();
                props.onText(textarea?.plainText ?? props.doc.text);
                scheduleHighlight();
              } catch {}
              return;
            }
            if (ctrl && key === "f") {
              event.preventDefault?.();
              event.stopPropagation?.();
              setFindOpen(true);
              return;
            }
            if (!props.onKey) return;
            if (!props.onKey(event)) return;
            event.preventDefault?.();
            event.stopPropagation?.();
            if (key === "escape" || key === "tab") textarea?.blur();
          });
          _$setProp(_el$25, "onMouseDown", event => {
            if (event.button !== 0) return;
            event.stopPropagation?.();
            const element = textarea;
            if (!element || element.isDestroyed) return;
            focusNow();
            try {
              const row = Math.floor(event.y - element.screenY) + element.scrollY;
              const col = Math.max(0, Math.floor(event.x - element.screenX));
              element.editBuffer.setCursor(Math.max(0, row), col);
              syncViewport();
            } catch {}
          });
          _$setProp(_el$25, "onMouseScroll", () => setTimeout(syncViewport, 0));
          _$insert(_el$23, _$createComponent(ScrollBar, {
            get theme() {
              return props.theme;
            },
            get start() {
              return scrollLine();
            },
            get total() {
              return lineCount();
            },
            get viewport() {
              return viewport();
            },
            get height() {
              return viewport();
            }
          }), null);
          _$effect(_p$ => {
            var _v$13 = props.doc.text,
              _v$14 = props.syntax,
              _v$15 = props.settings.wrap ? "word" : "none",
              _v$16 = props.theme.background.base,
              _v$17 = props.theme.text.base,
              _v$18 = props.theme.text.base,
              _v$19 = props.theme.background.base;
            _v$13 !== _p$.e && (_p$.e = _$setProp(_el$25, "initialValue", _v$13, _p$.e));
            _v$14 !== _p$.t && (_p$.t = _$setProp(_el$25, "syntaxStyle", _v$14, _p$.t));
            _v$15 !== _p$.a && (_p$.a = _$setProp(_el$25, "wrapMode", _v$15, _p$.a));
            _v$16 !== _p$.o && (_p$.o = _$setProp(_el$25, "backgroundColor", _v$16, _p$.o));
            _v$17 !== _p$.i && (_p$.i = _$setProp(_el$25, "textColor", _v$17, _p$.i));
            _v$18 !== _p$.n && (_p$.n = _$setProp(_el$25, "focusedTextColor", _v$18, _p$.n));
            _v$19 !== _p$.s && (_p$.s = _$setProp(_el$25, "focusedBackgroundColor", _v$19, _p$.s));
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
          return _el$23;
        })(), _$createComponent(Show, {
          get when() {
            return _$memo(() => !!(!props.settings.wrap && longest() > hWidth()))() && hWidth() > 0;
          },
          get children() {
            var _el$26 = _$createElement("box"),
              _el$27 = _$createElement("box"),
              _el$28 = _$createElement("box"),
              _el$29 = _$createElement("text");
            _$insertNode(_el$26, _el$27);
            _$insertNode(_el$26, _el$28);
            _$setProp(_el$26, "height", 1);
            _$setProp(_el$26, "flexShrink", 0);
            _$setProp(_el$26, "flexDirection", "row");
            _$setProp(_el$27, "flexShrink", 0);
            _$insertNode(_el$28, _el$29);
            _$use(element => hbar = element, _el$28);
            _$setProp(_el$28, "flexGrow", 1);
            _$setProp(_el$28, "onMouseUp", event => {
              if (event.button !== 0 || !hbar || !textarea || textarea.isDestroyed) return;
              event.stopPropagation?.();
              const width = Math.max(1, hbar.width);
              const x = Math.max(0, Math.min(width, event.x - hbar.screenX));
              const span = Math.max(0, longest() - hWidth());
              const target = Math.round(x / width * span);
              try {
                const viewport = textarea.editorView.getViewport();
                textarea.editorView.setViewport(target, viewport.offsetY, viewport.width, viewport.height, false);
                syncViewport();
              } catch {}
            });
            _$setProp(_el$29, "wrapMode", "none");
            _$setProp(_el$29, "selectable", false);
            _$insert(_el$29, () => {
              const width = Math.max(1, hbar?.width ?? hWidth());
              const total = Math.max(1, longest());
              const visible = Math.max(1, hWidth());
              const thumb = Math.max(1, Math.round(visible / total * width));
              const span = Math.max(1, total - visible);
              const at = Math.round(Math.min(span, hOffset()) / span * (width - thumb));
              return "░".repeat(Math.max(0, at)) + "█".repeat(thumb) + "░".repeat(Math.max(0, width - at - thumb));
            });
            _$effect(_p$ => {
              var _v$20 = gutter() ? gutterWidth(lineCount()) : 0,
                _v$21 = props.theme.text.feedback.info.base;
              _v$20 !== _p$.e && (_p$.e = _$setProp(_el$27, "width", _v$20, _p$.e));
              _v$21 !== _p$.t && (_p$.t = _$setProp(_el$29, "fg", _v$21, _p$.t));
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$26;
          }
        })];
      }
    }), null);
    _$insert(_el$22, _$createComponent(Show, {
      get when() {
        return !props.editing || props.markdownPreview;
      },
      get children() {
        return _$createComponent(Show, {
          get when() {
            return _$memo(() => !!props.doc.markdown)() && props.markdownPreview;
          },
          get fallback() {
            return _$createComponent(Show, {
              get when() {
                return props.doc.diff;
              },
              get fallback() {
                return (() => {
                  var _el$46 = _$createElement("scrollbox"),
                    _el$47 = _$createElement("box"),
                    _el$50 = _$createElement("box"),
                    _el$51 = _$createElement("code");
                  _$insertNode(_el$46, _el$47);
                  _$use(element => {
                    contentScroll = element;
                    setTimeout(() => {
                      if (element && !element.isDestroyed) {
                        const target = props.initialScroll ?? (props.initialLine ? Math.max(0, props.initialLine - 1) : 0);
                        if (target) element.scrollTo(target);
                      }
                      syncViewport();
                    }, 40);
                  }, _el$46);
                  _$setProp(_el$46, "flexGrow", 1);
                  _$setProp(_el$46, "minHeight", 0);
                  _$setProp(_el$46, "verticalScrollbarOptions", {
                    visible: true
                  });
                  _$setProp(_el$46, "onMouseScroll", () => setTimeout(syncViewport, 0));
                  _$insertNode(_el$47, _el$50);
                  _$setProp(_el$47, "flexDirection", "row");
                  _$setProp(_el$47, "flexShrink", 0);
                  _$insert(_el$47, _$createComponent(Show, {
                    get when() {
                      return gutter();
                    },
                    get children() {
                      var _el$48 = _$createElement("box"),
                        _el$49 = _$createElement("text");
                      _$insertNode(_el$48, _el$49);
                      _$setProp(_el$48, "flexShrink", 0);
                      _$setProp(_el$48, "flexDirection", "column");
                      _$setProp(_el$49, "wrapMode", "none");
                      _$setProp(_el$49, "selectable", false);
                      _$insert(_el$49, () => Array.from({
                        length: lineCount()
                      }, (_, index) => String(index + 1).padStart(gutterWidth(lineCount()) - 1, " ") + " ").join("\n"));
                      _$effect(_p$ => {
                        var _v$34 = gutterWidth(lineCount()),
                          _v$35 = props.theme.text.muted;
                        _v$34 !== _p$.e && (_p$.e = _$setProp(_el$48, "width", _v$34, _p$.e));
                        _v$35 !== _p$.t && (_p$.t = _$setProp(_el$49, "fg", _v$35, _p$.t));
                        return _p$;
                      }, {
                        e: undefined,
                        t: undefined
                      });
                      return _el$48;
                    }
                  }), _el$50);
                  _$insertNode(_el$50, _el$51);
                  _$setProp(_el$50, "flexGrow", 1);
                  _$setProp(_el$50, "minWidth", 0);
                  _$effect(_p$ => {
                    var _v$36 = !props.settings.wrap,
                      _v$37 = {
                        visible: !props.settings.wrap
                      },
                      _v$38 = props.doc.text,
                      _v$39 = props.doc.type,
                      _v$40 = props.syntax,
                      _v$41 = props.settings.wrap ? "word" : "none";
                    _v$36 !== _p$.e && (_p$.e = _$setProp(_el$46, "scrollX", _v$36, _p$.e));
                    _v$37 !== _p$.t && (_p$.t = _$setProp(_el$46, "horizontalScrollbarOptions", _v$37, _p$.t));
                    _v$38 !== _p$.a && (_p$.a = _$setProp(_el$51, "content", _v$38, _p$.a));
                    _v$39 !== _p$.o && (_p$.o = _$setProp(_el$51, "filetype", _v$39, _p$.o));
                    _v$40 !== _p$.i && (_p$.i = _$setProp(_el$51, "syntaxStyle", _v$40, _p$.i));
                    _v$41 !== _p$.n && (_p$.n = _$setProp(_el$51, "wrapMode", _v$41, _p$.n));
                    return _p$;
                  }, {
                    e: undefined,
                    t: undefined,
                    a: undefined,
                    o: undefined,
                    i: undefined,
                    n: undefined
                  });
                  return _el$46;
                })();
              },
              get children() {
                var _el$44 = _$createElement("scrollbox"),
                  _el$45 = _$createElement("diff");
                _$insertNode(_el$44, _el$45);
                _$setProp(_el$44, "flexGrow", 1);
                _$setProp(_el$44, "minHeight", 0);
                _$setProp(_el$44, "verticalScrollbarOptions", {
                  visible: true
                });
                _$setProp(_el$45, "view", "unified");
                _$setProp(_el$45, "wrapMode", "none");
                _$effect(_p$ => {
                  var _v$31 = props.doc.text,
                    _v$32 = props.doc.type,
                    _v$33 = props.syntax;
                  _v$31 !== _p$.e && (_p$.e = _$setProp(_el$45, "diff", _v$31, _p$.e));
                  _v$32 !== _p$.t && (_p$.t = _$setProp(_el$45, "filetype", _v$32, _p$.t));
                  _v$33 !== _p$.a && (_p$.a = _$setProp(_el$45, "syntaxStyle", _v$33, _p$.a));
                  return _p$;
                }, {
                  e: undefined,
                  t: undefined,
                  a: undefined
                });
                return _el$44;
              }
            });
          },
          get children() {
            var _el$30 = _$createElement("scrollbox"),
              _el$31 = _$createElement("box"),
              _el$32 = _$createElement("markdown");
            _$insertNode(_el$30, _el$31);
            _$use(element => {
              contentScroll = element;
              setTimeout(() => {
                if (element && !element.isDestroyed) {
                  const target = props.initialScroll ?? (props.initialLine ? Math.max(0, props.initialLine - 1) : 0);
                  if (target) element.scrollTo(target);
                }
                syncViewport();
              }, 40);
            }, _el$30);
            _$setProp(_el$30, "flexGrow", 1);
            _$setProp(_el$30, "minHeight", 0);
            _$setProp(_el$30, "verticalScrollbarOptions", {
              visible: true
            });
            _$insertNode(_el$31, _el$32);
            _$setProp(_el$31, "paddingLeft", 1);
            _$setProp(_el$31, "paddingRight", 1);
            _$setProp(_el$31, "flexShrink", 0);
            _$setProp(_el$32, "conceal", true);
            _$effect(_p$ => {
              var _v$22 = props.doc.text,
                _v$23 = props.syntax,
                _v$24 = props.theme.markdown.text,
                _v$25 = props.theme.background.base;
              _v$22 !== _p$.e && (_p$.e = _$setProp(_el$32, "content", _v$22, _p$.e));
              _v$23 !== _p$.t && (_p$.t = _$setProp(_el$32, "syntaxStyle", _v$23, _p$.t));
              _v$24 !== _p$.a && (_p$.a = _$setProp(_el$32, "fg", _v$24, _p$.a));
              _v$25 !== _p$.o && (_p$.o = _$setProp(_el$32, "bg", _v$25, _p$.o));
              return _p$;
            }, {
              e: undefined,
              t: undefined,
              a: undefined,
              o: undefined
            });
            return _el$30;
          }
        });
      }
    }), null);
    _$insert(_el$10, _$createComponent(Show, {
      get when() {
        return props.doc.truncated;
      },
      get children() {
        var _el$33 = _$createElement("box"),
          _el$34 = _$createElement("text");
        _$insertNode(_el$33, _el$34);
        _$setProp(_el$33, "height", 1);
        _$setProp(_el$33, "flexShrink", 0);
        _$setProp(_el$33, "paddingLeft", 2);
        _$insertNode(_el$34, _$createTextNode(`truncated for display · open with an external editor for the full file`));
        _$setProp(_el$34, "wrapMode", "none");
        _$effect(_$p => _$setProp(_el$34, "fg", props.theme.text.feedback.warning.base, _$p));
        return _el$33;
      }
    }), _el$36);
    _$insertNode(_el$36, _el$37);
    _$insertNode(_el$36, _el$38);
    _$insertNode(_el$36, _el$39);
    _$insertNode(_el$36, _el$40);
    _$insertNode(_el$36, _el$41);
    _$setProp(_el$36, "height", 1);
    _$setProp(_el$36, "flexShrink", 0);
    _$setProp(_el$36, "flexDirection", "row");
    _$setProp(_el$36, "gap", 2);
    _$setProp(_el$36, "paddingLeft", 2);
    _$setProp(_el$36, "paddingRight", 2);
    _$setProp(_el$37, "wrapMode", "none");
    _$setProp(_el$37, "flexShrink", 0);
    _$setProp(_el$37, "onMouseUp", event => {
      if (event.button !== 0) return;
      event.stopPropagation?.();
      props.onToggleMode?.();
    });
    _$insert(_el$37, (() => {
      var _c$ = _$memo(() => !!props.editing);
      return () => _c$() ? "edit" : _$memo(() => !!props.doc.diff)() ? "diff" : props.markdownPreview && props.doc.markdown ? "preview" : "read";
    })());
    _$setProp(_el$38, "wrapMode", "none");
    _$setProp(_el$38, "flexShrink", 0);
    _$insert(_el$38, () => props.doc.type);
    _$setProp(_el$39, "wrapMode", "none");
    _$setProp(_el$39, "flexShrink", 0);
    _$insert(_el$39, (() => {
      var _c$2 = _$memo(() => !!props.editing);
      return () => _c$2() ? `Ln ${cursor().line}, Col ${cursor().column}` : `Ln ${previewLine()}/${lineCount()}`;
    })());
    _$setProp(_el$40, "wrapMode", "none");
    _$setProp(_el$40, "flexShrink", 0);
    _$insert(_el$40, () => isDirty(props.doc) ? "unsaved" : "saved");
    _$setProp(_el$41, "wrapMode", "none");
    _$setProp(_el$41, "truncate", true);
    _$setProp(_el$41, "flexGrow", 1);
    _$setProp(_el$41, "minWidth", 0);
    _$insert(_el$41, () => props.doc.external ? "external" : "");
    _$insert(_el$36, _$createComponent(Show, {
      get when() {
        return _$memo(() => !!props.settings.wrap)() && props.editing;
      },
      get children() {
        var _el$42 = _$createElement("text");
        _$insertNode(_el$42, _$createTextNode(`wrap`));
        _$setProp(_el$42, "wrapMode", "none");
        _$setProp(_el$42, "flexShrink", 0);
        _$effect(_$p => _$setProp(_el$42, "fg", props.theme.text.muted, _$p));
        return _el$42;
      }
    }), null);
    _$effect(_p$ => {
      var _v$26 = props.theme.text.action.primary.selected,
        _v$27 = props.theme.text.muted,
        _v$28 = props.theme.text.muted,
        _v$29 = isDirty(props.doc) ? props.theme.text.feedback.warning.base : props.theme.text.muted,
        _v$30 = props.theme.text.muted;
      _v$26 !== _p$.e && (_p$.e = _$setProp(_el$37, "fg", _v$26, _p$.e));
      _v$27 !== _p$.t && (_p$.t = _$setProp(_el$38, "fg", _v$27, _p$.t));
      _v$28 !== _p$.a && (_p$.a = _$setProp(_el$39, "fg", _v$28, _p$.a));
      _v$29 !== _p$.o && (_p$.o = _$setProp(_el$40, "fg", _v$29, _p$.o));
      _v$30 !== _p$.i && (_p$.i = _$setProp(_el$41, "fg", _v$30, _p$.i));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined
    });
    return _el$10;
  })();
}