export function createRuntimeScript() {
  return String.raw`(() => {
  if (window.__RDT_CLI_RUNTIME__) {
    return;
  }

  const state = {
    nextNodeId: 1,
    nextRootId: 1,
    fiberIds: new WeakMap(),
    roots: new Map(),
    renderers: new Map(),
    profiler: {
      active: false,
      profileId: null,
      startedAt: null,
      stoppedAt: null,
      events: [],
    },
    overlay: null,
  };

  const tagNames = {
    0: "FunctionComponent",
    1: "ClassComponent",
    3: "HostRoot",
    4: "HostPortal",
    5: "HostComponent",
    6: "HostText",
    7: "Fragment",
    8: "Mode",
    9: "ContextConsumer",
    10: "ContextProvider",
    11: "ForwardRef",
    12: "Profiler",
    13: "SuspenseComponent",
    14: "MemoComponent",
    15: "SimpleMemoComponent",
    16: "LazyComponent",
    19: "SuspenseListComponent",
    22: "OffscreenComponent",
  };

  function getFiberId(fiber) {
    if (!state.fiberIds.has(fiber)) {
      state.fiberIds.set(fiber, "n" + state.nextNodeId++);
    }

    return state.fiberIds.get(fiber);
  }

  function getRootState(root) {
    let entry = state.roots.get(root);
    if (!entry) {
      entry = {
        rootId: "root-" + state.nextRootId++,
        rendererId: null,
        root,
      };
      state.roots.set(root, entry);
    }

    return entry;
  }

  function safeSerialize(value, depth = 0, seen) {
    if (depth > 3) {
      return "[MaxDepth]";
    }

    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    if (typeof value === "bigint") {
      return String(value);
    }

    if (typeof value === "function") {
      return "[Function]";
    }

    if (typeof value === "symbol") {
      return value.toString();
    }

    const refs = seen || new WeakSet();
    if (typeof value === "object") {
      if (refs.has(value)) {
        return "[Circular]";
      }
      refs.add(value);
    }

    if (Array.isArray(value)) {
      return value.slice(0, 20).map((item) => safeSerialize(item, depth + 1, refs));
    }

    const output = {};
    for (const key of Object.keys(value).slice(0, 30)) {
      try {
        output[key] = safeSerialize(value[key], depth + 1, refs);
      } catch (error) {
        output[key] = "[Unreadable]";
      }
    }
    return output;
  }

  function getDisplayName(fiber) {
    if (!fiber) {
      return null;
    }

    const type = fiber.elementType || fiber.type;
    if (typeof type === "string") {
      return type;
    }

    return type?.displayName || type?.name || fiber._debugInfo?.name || tagNames[fiber.tag] || "Anonymous";
  }

  function getFiberSource(fiber) {
    const source = fiber?._debugSource;
    if (!source) {
      return null;
    }

    return {
      fileName: source.fileName || null,
      lineNumber: source.lineNumber || null,
      columnNumber: source.columnNumber || null,
    };
  }

  function getOwnerStack(fiber) {
    const stack = [];
    let current = fiber?._debugOwner || fiber?.return || null;

    while (current && stack.length < 25) {
      stack.push({
        id: getFiberId(current),
        displayName: getDisplayName(current),
      });
      current = current._debugOwner || current.return || null;
    }

    return stack;
  }

  function getHooks(fiber) {
    const hooks = [];
    let cursor = fiber?.memoizedState || null;
    let index = 0;

    while (cursor && index < 50) {
      hooks.push({
        index,
        memoizedState: safeSerialize(cursor.memoizedState),
        baseState: safeSerialize(cursor.baseState),
        hasQueue: Boolean(cursor.queue),
      });
      cursor = cursor.next;
      index += 1;
    }

    return hooks;
  }

  function getContextDependencies(fiber) {
    const contexts = [];
    let cursor = fiber?.dependencies?.firstContext || null;

    while (cursor && contexts.length < 20) {
      contexts.push({
        displayName: cursor.context?.displayName || cursor.context?._context?.displayName || "Context",
        value: safeSerialize(cursor.memoizedValue),
      });
      cursor = cursor.next;
    }

    return contexts;
  }

  function findHostDescendant(fiber) {
    let current = fiber?.child || null;

    while (current) {
      if (current.tag === 5 && current.stateNode instanceof Element) {
        return current;
      }

      const child = findHostDescendant(current);
      if (child) {
        return child;
      }

      current = current.sibling || null;
    }

    return null;
  }

  function getDomInfo(fiber) {
    const hostFiber = fiber?.tag === 5 ? fiber : findHostDescendant(fiber);
    const node = hostFiber?.stateNode;

    if (!(node instanceof Element)) {
      return null;
    }

    const rect = node.getBoundingClientRect();
    return {
      tagName: node.tagName.toLowerCase(),
      id: node.id || null,
      className: node.className || null,
      textPreview: node.textContent ? node.textContent.slice(0, 120) : null,
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
    };
  }

  function buildNodeRecord(fiber, parentId, depth, rootId) {
    const id = getFiberId(fiber);
    return {
      id,
      parentId,
      rootId,
      depth,
      tag: fiber.tag,
      tagName: tagNames[fiber.tag] || "Unknown",
      key: fiber.key == null ? null : String(fiber.key),
      displayName: getDisplayName(fiber),
      source: getFiberSource(fiber),
      dom: getDomInfo(fiber),
    };
  }

  function traverseFiberTree(fiber, parentId, depth, rootId, output) {
    let current = fiber;
    while (current) {
      const node = buildNodeRecord(current, parentId, depth, rootId);
      output.push(node);

      if (current.child) {
        traverseFiberTree(current.child, node.id, depth + 1, rootId, output);
      }

      current = current.sibling;
    }
  }

  function collectTree() {
    const roots = [];
    const nodes = [];

    for (const entry of state.roots.values()) {
      const root = entry.root;
      const current = root?.current;
      if (!current || !current.child) {
        continue;
      }

      roots.push({
        id: entry.rootId,
        rendererId: entry.rendererId,
        nodeId: getFiberId(current.child),
      });

      traverseFiberTree(current.child, null, 0, entry.rootId, nodes);
    }

    return {
      generatedAt: new Date().toISOString(),
      reactDetected: roots.length > 0,
      roots,
      nodes,
      selectedNodeId: null,
    };
  }

  function walk(fiber, nodeId) {
    let current = fiber;
    while (current) {
      if (getFiberId(current) === nodeId) {
        return current;
      }

      if (current.child) {
        const childMatch = walk(current.child, nodeId);
        if (childMatch) {
          return childMatch;
        }
      }

      current = current.sibling;
    }

    return null;
  }

  function findFiberById(nodeId) {
    for (const entry of state.roots.values()) {
      const match = walk(entry.root?.current?.child, nodeId);
      if (match) {
        return match;
      }
    }

    return null;
  }

  function inspectNode(nodeId) {
    const fiber = findFiberById(nodeId);
    if (!fiber) {
      return null;
    }

    return {
      id: nodeId,
      displayName: getDisplayName(fiber),
      tag: fiber.tag,
      tagName: tagNames[fiber.tag] || "Unknown",
      key: fiber.key == null ? null : String(fiber.key),
      props: safeSerialize(fiber.memoizedProps),
      state: safeSerialize(fiber.memoizedState),
      hooks: getHooks(fiber),
      context: getContextDependencies(fiber),
      ownerStack: getOwnerStack(fiber),
      source: getFiberSource(fiber),
      dom: getDomInfo(fiber),
    };
  }

  function searchNodes(query) {
    const lower = String(query || "").toLowerCase();
    const snapshot = collectTree();
    return snapshot.nodes.filter((node) => {
      return String(node.displayName || "").toLowerCase().includes(lower);
    });
  }

  function ensureOverlay() {
    if (state.overlay && document.body.contains(state.overlay)) {
      return state.overlay;
    }

    const overlay = document.createElement("div");
    overlay.setAttribute("data-rdt-cli-overlay", "true");
    overlay.style.position = "fixed";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "2147483647";
    overlay.style.border = "2px solid #ff5d00";
    overlay.style.background = "rgba(255, 93, 0, 0.12)";
    overlay.style.boxSizing = "border-box";
    overlay.style.display = "none";
    document.documentElement.appendChild(overlay);
    state.overlay = overlay;
    return overlay;
  }

  function highlightNode(nodeId) {
    const details = inspectNode(nodeId);
    if (!details?.dom?.rect) {
      return null;
    }

    const overlay = ensureOverlay();
    overlay.style.display = "block";
    overlay.style.left = details.dom.rect.x + "px";
    overlay.style.top = details.dom.rect.y + "px";
    overlay.style.width = details.dom.rect.width + "px";
    overlay.style.height = details.dom.rect.height + "px";
    return details.dom;
  }

  function resolveFiberFromElement(element) {
    let current = element;
    while (current) {
      for (const key of Object.keys(current)) {
        if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
          return current[key];
        }
      }
      current = current.parentElement;
    }

    return null;
  }

  function pickNode(timeoutMs) {
    return new Promise((resolve) => {
      function cleanup(result) {
        document.removeEventListener("mouseover", handleHover, true);
        document.removeEventListener("click", handleClick, true);
        if (state.overlay) {
          state.overlay.style.display = "none";
        }
        resolve(result);
      }

      function handleHover(event) {
        const fiber = resolveFiberFromElement(event.target);
        if (!fiber) {
          return;
        }

        highlightNode(getFiberId(fiber));
      }

      function handleClick(event) {
        event.preventDefault();
        event.stopPropagation();
        const fiber = resolveFiberFromElement(event.target);
        if (!fiber) {
          cleanup(null);
          return;
        }

        cleanup(inspectNode(getFiberId(fiber)));
      }

      document.addEventListener("mouseover", handleHover, true);
      document.addEventListener("click", handleClick, true);
      window.setTimeout(() => cleanup(null), timeoutMs);
    });
  }

  function summarizeProfiler() {
    const commitEvents = state.profiler.events.filter((event) => event.eventType === "commit");
    const nodeCounts = commitEvents.map((event) => event.nodeCount);
    const totalNodeCount = nodeCounts.reduce((sum, count) => sum + count, 0);

    return {
      profileId: state.profiler.profileId,
      active: state.profiler.active,
      startedAt: state.profiler.startedAt,
      stoppedAt: state.profiler.stoppedAt,
      commitCount: commitEvents.length,
      maxNodeCount: nodeCounts.length ? Math.max(...nodeCounts) : 0,
      minNodeCount: nodeCounts.length ? Math.min(...nodeCounts) : 0,
      averageNodeCount: nodeCounts.length ? totalNodeCount / nodeCounts.length : 0,
      roots: [...new Set(commitEvents.map((event) => event.rootId))],
    };
  }

  function recordCommit(rendererId, root, priorityLevel) {
    const rootState = getRootState(root);
    rootState.rendererId = rendererId;
    rootState.root = root;

    if (!state.profiler.active) {
      return;
    }

    const snapshot = collectTree();
    state.profiler.events.push({
      eventType: "commit",
      timestamp: new Date().toISOString(),
      rootId: rootState.rootId,
      rendererId,
      priorityLevel: priorityLevel == null ? null : priorityLevel,
      nodeCount: snapshot.nodes.length,
    });
  }

  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || {};
  hook.__RDT_CLI_COMPAT__ = true;
  hook.supportsFiber = true;
  hook.renderers = hook.renderers || new Map();
  hook.inject = function inject(renderer) {
    const rendererId = hook.renderers.size + 1;
    hook.renderers.set(rendererId, renderer);
    state.renderers.set(rendererId, renderer);
    return rendererId;
  };
  hook.onCommitFiberRoot = function onCommitFiberRoot(rendererId, root, priorityLevel) {
    recordCommit(rendererId, root, priorityLevel);
  };
  hook.onCommitFiberUnmount = hook.onCommitFiberUnmount || function onCommitFiberUnmount() {};
  hook.sub = hook.sub || function sub() {
    return function unsubscribe() {};
  };
  hook.on = hook.on || function on() {};
  hook.off = hook.off || function off() {};
  hook.emit = hook.emit || function emit() {};
  hook.getFiberRoots = function getFiberRoots(rendererId) {
    const roots = new Set();
    for (const entry of state.roots.values()) {
      if (rendererId == null || entry.rendererId === rendererId) {
        roots.add(entry.root);
      }
    }
    return roots;
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;

  window.__RDT_CLI_RUNTIME__ = {
    collectTree,
    inspectNode,
    searchNodes,
    highlightNode,
    pickNode,
    startProfiler(profileId) {
      state.profiler.active = true;
      state.profiler.profileId = profileId;
      state.profiler.startedAt = new Date().toISOString();
      state.profiler.stoppedAt = null;
      state.profiler.events = [];
      return summarizeProfiler();
    },
    stopProfiler() {
      state.profiler.active = false;
      state.profiler.stoppedAt = new Date().toISOString();
      return summarizeProfiler();
    },
    exportProfiler() {
      return {
        profileId: state.profiler.profileId,
        summary: summarizeProfiler(),
        events: state.profiler.events.slice(),
      };
    },
    profilerSummary: summarizeProfiler,
  };
})();`;
}
