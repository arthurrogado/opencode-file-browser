import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
/** @jsxImportSource @opentui/solid */

import { Plugin } from "@opencode/plugin/tui";
import { Show } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import path from "node:path";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Browser, ROUTE } from "./browser.js";
function BrowserRoute(props) {
  const dimensions = useTerminalDimensions();
  const location = () => props.data?.directory ? {
    directory: props.data.directory
  } : props.context.location ?? props.context.data.location.default();
  return (() => {
    var _el$ = _$createElement("box");
    _$setProp(_el$, "position", "absolute");
    _$setProp(_el$, "zIndex", 2500);
    _$setProp(_el$, "left", 0);
    _$setProp(_el$, "top", 0);
    _$insert(_el$, _$createComponent(Browser, {
      get context() {
        return props.context;
      },
      location: location,
      onClose: () => props.context.ui.router.navigate(props.data?.returnRoute ?? {
        type: "home"
      })
    }));
    _$effect(_p$ => {
      var _v$ = dimensions().width,
        _v$2 = dimensions().height;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$, "width", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$, "height", _v$2, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$;
  })();
}
function Commands(props) {
  const [view] = props.context.storage.store("view", {
    initial: {
      fullscreen: false
    }
  });
  const [, updatePending] = props.context.storage.memory("pending", {
    initial: {
      seq: 0
    }
  });
  const [, sendAction] = props.context.storage.memory("action", {
    initial: {
      seq: 0
    }
  });
  const act = name => {
    void sendAction(draft => {
      draft.name = name;
      draft.seq += 1;
    });
    ensureOpen();
  };
  const ensureOpen = () => {
    const route = props.context.ui.router.current();
    const panel = props.context.ui.panel.current();
    if (route.type === "session" && panel?.sessionID === route.sessionID && panel.name === ROUTE) return;
    if (route.type === "plugin" && route.name === ROUTE) return;
    if (props.context.ui.panel.open(ROUTE, {
      presentation: view.fullscreen ? "fullscreen" : "panel"
    })) return;
    const returnRoute = route.type === "home" ? {
      type: "home"
    } : route.type === "session" ? {
      type: "session",
      sessionID: route.sessionID
    } : {
      type: "plugin",
      id: route.id,
      name: route.name,
      ...(route.data ? {
        data: {
          ...route.data
        }
      } : {})
    };
    // Defer so the key that opened us finishes dispatching before the route
    // mounts its own keymap layer.
    setTimeout(() => props.context.ui.router.navigate({
      type: "plugin",
      name: ROUTE,
      data: {
        sessionID: route.type === "session" ? route.sessionID : undefined,
        directory: route.type === "session" ? props.context.data.session.get(route.sessionID)?.location?.directory ?? props.context.data.location.default().directory : props.context.data.location.default().directory,
        returnRoute
      }
    }), 0);
  };
  const askPath = async () => {
    const value = await props.context.ui.dialog.prompt({
      title: "Open file by path",
      description: "Absolute path, or relative to the project. ~ points to your home.",
      placeholder: "/path/to/file or ../notes.md"
    });
    const target = value?.trim();
    if (!target) return;
    void updatePending(draft => {
      draft.path = target;
      draft.seq += 1;
    });
    ensureOpen();
  };
  const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const update = async () => {
    if (!existsSync(path.join(pluginRoot, ".git"))) {
      props.context.ui.toast.show({
        variant: "info",
        message: "This install is managed by OpenCode. Update it with `opencode plugin update` or reinstall the package.",
        duration: 8000
      });
      return;
    }
    props.context.ui.toast.show({
      message: "Checking for updates…"
    });
    const result = await new Promise(resolve => {
      execFile("git", ["pull", "--ff-only"], {
        cwd: pluginRoot,
        timeout: 60_000
      }, (error, stdout, stderr) => {
        resolve({
          ok: !error,
          text: `${stdout}${stderr}`.trim()
        });
      });
    });
    const last = result.text.split("\n").filter(Boolean).pop() ?? "";
    props.context.ui.toast.show({
      variant: result.ok ? "success" : "error",
      message: result.ok ? `File browser updated. ${last}` : `Update failed: ${last || "git pull failed"}`,
      duration: 8000
    });
  };
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [{
      id: "file-browser.open",
      title: "Open file browser",
      description: "Browse, preview, edit and review changes",
      group: "Files",
      palette: true,
      suggested: true,
      slash: {
        name: "files",
        aliases: ["browse", "arquivos"]
      },
      bind: "<leader>f",
      run() {
        const route = props.context.ui.router.current();
        props.context.ui.dialog.clear();
        if (route.type === "plugin" && route.name === ROUTE) {
          const back = route.data?.returnRoute ?? {
            type: "home"
          };
          props.context.ui.router.navigate(back.type === "plugin" && back.name === ROUTE ? {
            type: "home"
          } : back);
          return;
        }
        const panel = props.context.ui.panel.current();
        if (route.type === "session" && panel?.sessionID === route.sessionID && panel.name === ROUTE) {
          props.context.ui.panel.close();
          return;
        }
        ensureOpen();
      }
    }, {
      id: "file-browser.open_path",
      title: "Open file by path",
      description: "Type a path and open it in the file browser",
      group: "Files",
      palette: true,
      bind: "<leader>o",
      run: askPath
    }, {
      id: "file-browser.settings.global",
      title: "File browser: preferences",
      description: "Open the preferences modal",
      group: "Files",
      palette: true,
      slash: {
        name: "files-settings",
        aliases: ["preferencias-arquivos"]
      },
      run: () => act("settings")
    }, {
      id: "file-browser.action.simple",
      title: "File browser: toggle simple mode",
      description: "Classic list + preview, nothing else",
      group: "Files",
      palette: true,
      bind: false,
      run: () => act("simple")
    }, {
      id: "file-browser.action.hidden",
      title: "File browser: toggle hidden files",
      group: "Files",
      palette: true,
      bind: false,
      run: () => act("hidden")
    }, {
      id: "file-browser.action.numbers",
      title: "File browser: toggle line numbers",
      group: "Files",
      palette: true,
      bind: false,
      run: () => act("lineNumbers")
    }, {
      id: "file-browser.action.changes",
      title: "File browser: focus changes",
      description: "Stage, commit, pull and push",
      group: "Files",
      palette: true,
      bind: false,
      run: () => act("changes")
    }, {
      id: "file-browser.action.stage",
      title: "File browser: stage all changes",
      group: "Files",
      palette: true,
      bind: false,
      run: () => act("stage")
    }, {
      id: "file-browser.action.refresh",
      title: "File browser: refresh",
      description: "Reload tree, file and git status",
      group: "Files",
      palette: true,
      bind: false,
      run: () => act("refresh")
    }, {
      id: "file-browser.action.help",
      title: "File browser: keyboard shortcuts",
      group: "Files",
      palette: true,
      bind: false,
      run: () => act("help")
    }, {
      id: "file-browser.action.close",
      title: "File browser: close",
      group: "Files",
      palette: true,
      bind: false,
      run: () => act("close")
    }, {
      id: "file-browser.update",
      title: "Update file browser",
      description: "Pull the latest version from GitHub",
      group: "Files",
      palette: true,
      slash: {
        name: "files-update",
        aliases: ["update-files"]
      },
      run: update
    }]
  }));
  return null;
}
export default Plugin.define({
  id: "opencode-file-browser",
  setup(context) {
    const offPanel = context.ui.slot({
      append: "session.panel",
      render: panel => _$createComponent(Show, {
        get when() {
          return panel.name === ROUTE;
        },
        get children() {
          return _$createComponent(Browser, {
            context: context,
            location: () => context.data.session.get(panel.sessionID)?.location ?? context.data.location.default(),
            panel: panel,
            get onClose() {
              return panel.close;
            }
          });
        }
      })
    });
    const offRoute = context.ui.router.register({
      name: ROUTE,
      render: ({
        data
      }) => _$createComponent(BrowserRoute, {
        context: context,
        data: data
      })
    });
    const offCommands = context.ui.slot({
      append: "app",
      render: () => _$createComponent(Commands, {
        context: context
      })
    });
    return () => {
      offRoute();
      offPanel();
      offCommands();
    };
  }
});