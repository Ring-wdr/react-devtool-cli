export function createRuntimeScript() {
  return String.raw`(() => {
  if (window.__RDT_CLI_RUNTIME__) {
    return;
  }

  const state = {
    nextNodeId: 1,
    nextRootId: 1,
    nextSnapshotId: 1,
    fiberIds: new WeakMap(),
    roots: new Map(),
    renderers: new Map(),
    snapshots: new Map(),
    latestSnapshotId: null,
    maxSnapshots: 5,
    profiler: {
      active: false,
      profileId: null,
      startedAt: null,
      stoppedAt: null,
      events: [],
    },
    overlay: null,
  };

  const commonLimitations = {
    snapshot: [
      "snapshot ids are snapshot-scoped only",
      "node identity is not stable across React commits",
    ],
    inspect: [
      "hooks are simplified serialized state derived from memoizedState",
      "ownerStack is a lightweight owner chain, not a full component stack",
      "source depends on _debugSource and may legitimately be unavailable",
    ],
    profiler: [
      "nodeCount is live tree size at commit, not changed fiber count",
      "component durations are not measured",
      "commit data does not prove which components rerendered",
    ],
  };

  function createRuntimeError(code, message, details) {
    return {
      __rdtError: true,
      code,
      message,
      details: details || null,
    };
  }

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

  function pruneSnapshots() {
    while (state.snapshots.size > state.maxSnapshots) {
      const oldestSnapshotId = state.snapshots.keys().next().value;
      if (!oldestSnapshotId) {
        break;
      }

      state.snapshots.delete(oldestSnapshotId);
      if (state.latestSnapshotId === oldestSnapshotId) {
        state.latestSnapshotId = state.snapshots.size
          ? Array.from(state.snapshots.keys()).pop()
          : null;
      }
    }
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

  function buildNodeDetails(fiber, node) {
    return {
      snapshotId: null,
      snapshotScoped: true,
      identityStableAcrossCommits: false,
      observationLevel: "observed",
      limitations: commonLimitations.snapshot.concat(commonLimitations.inspect),
      runtimeWarnings: node.source ? [] : ["_debugSource unavailable for this node in the current build"],
      id: node.id,
      displayName: node.displayName,
      tag: node.tag,
      tagName: node.tagName,
      key: node.key,
      props: safeSerialize(fiber.memoizedProps),
      state: safeSerialize(fiber.memoizedState),
      hooks: getHooks(fiber),
      context: getContextDependencies(fiber),
      ownerStack: getOwnerStack(fiber),
      source: node.source,
      dom: node.dom,
    };
  }

  function traverseFiberTree(fiber, parentId, depth, rootId, output, nodeDetails) {
    let current = fiber;
    while (current) {
      const node = buildNodeRecord(current, parentId, depth, rootId);
      output.push(node);
      nodeDetails.set(node.id, buildNodeDetails(current, node));

      if (current.child) {
        traverseFiberTree(current.child, node.id, depth + 1, rootId, output, nodeDetails);
      }

      current = current.sibling;
    }
  }

  function collectLiveTree() {
    const roots = [];
    const nodes = [];
    const nodeDetails = new Map();

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

      traverseFiberTree(current.child, null, 0, entry.rootId, nodes, nodeDetails);
    }

    return {
      generatedAt: new Date().toISOString(),
      reactDetected: roots.length > 0,
      roots,
      nodes,
      selectedNodeId: null,
      nodeDetails,
    };
  }

  function serializeSnapshot(snapshot) {
    return {
      snapshotId: snapshot.snapshotId,
      snapshotScoped: true,
      identityStableAcrossCommits: false,
      observationLevel: "observed",
      limitations: commonLimitations.snapshot.slice(),
      runtimeWarnings: [],
      generatedAt: snapshot.generatedAt,
      reactDetected: snapshot.reactDetected,
      roots: snapshot.roots,
      nodes: snapshot.nodes,
      selectedNodeId: snapshot.selectedNodeId,
    };
  }

  function cacheSnapshot(tree) {
    const snapshotId = "snapshot-" + state.nextSnapshotId++;
    const snapshot = {
      snapshotId,
      generatedAt: tree.generatedAt,
      reactDetected: tree.reactDetected,
      roots: tree.roots,
      nodes: tree.nodes,
      selectedNodeId: tree.selectedNodeId,
      nodeDetails: new Map(
        Array.from(tree.nodeDetails.entries(), ([nodeId, details]) => [
          nodeId,
          {
            ...details,
            snapshotId,
          },
        ]),
      ),
    };

    state.snapshots.set(snapshot.snapshotId, snapshot);
    state.latestSnapshotId = snapshot.snapshotId;
    pruneSnapshots();
    return snapshot;
  }

  function collectTree() {
    const liveTree = collectLiveTree();
    if (!liveTree.reactDetected) {
      return {
        snapshotId: null,
        snapshotScoped: true,
        identityStableAcrossCommits: false,
        observationLevel: "observed",
        limitations: commonLimitations.snapshot.slice(),
        runtimeWarnings: ["No React fiber roots were detected on the current page"],
        generatedAt: liveTree.generatedAt,
        reactDetected: false,
        roots: [],
        nodes: [],
        selectedNodeId: null,
      };
    }

    const snapshot = cacheSnapshot(liveTree);
    return serializeSnapshot(snapshot);
  }

  function peekTree() {
    const liveTree = collectLiveTree();
    return {
      snapshotId: null,
      snapshotScoped: true,
      identityStableAcrossCommits: false,
      observationLevel: "observed",
      limitations: commonLimitations.snapshot.slice(),
      runtimeWarnings: liveTree.reactDetected ? [] : ["No React fiber roots were detected on the current page"],
      generatedAt: liveTree.generatedAt,
      reactDetected: liveTree.reactDetected,
      roots: liveTree.roots,
      nodes: liveTree.nodes,
      selectedNodeId: liveTree.selectedNodeId,
    };
  }

  function resolveSnapshot(snapshotId, createIfMissing = true) {
    if (snapshotId) {
      return state.snapshots.get(snapshotId) || createRuntimeError(
        "snapshot-expired",
        "Snapshot \"" + snapshotId + "\" is no longer available. Run rdt tree get --session <name> again to collect a fresh snapshot.",
        { snapshotId },
      );
    }

    if (state.latestSnapshotId) {
      return state.snapshots.get(state.latestSnapshotId) || null;
    }

    if (!createIfMissing) {
      return null;
    }

    const snapshot = collectTree();
    if (!snapshot.reactDetected || !snapshot.snapshotId) {
      return null;
    }

    return state.snapshots.get(snapshot.snapshotId) || null;
  }

  function inspectNode(nodeId, snapshotId) {
    const snapshot = resolveSnapshot(snapshotId);
    if (snapshot?.__rdtError) {
      return snapshot;
    }

    const details = snapshot?.nodeDetails.get(nodeId);
    if (!snapshot || !details) {
      return null;
    }

    return details;
  }

  function searchNodes(query, snapshotId) {
    const snapshot = resolveSnapshot(snapshotId);
    if (snapshot?.__rdtError) {
      return snapshot;
    }

    if (!snapshot) {
      return [];
    }

    const lower = String(query || "").toLowerCase();
    return snapshot.nodes.filter((node) => {
      return String(node.displayName || "").toLowerCase().includes(lower);
    }).map((node) => ({
      ...node,
      snapshotId: snapshot.snapshotId,
    }));
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

  function highlightNode(nodeId, snapshotId) {
    const details = inspectNode(nodeId, snapshotId);
    if (details?.__rdtError) {
      return details;
    }

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
      const snapshot = collectTree();
      const snapshotId = snapshot.snapshotId;

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

        highlightNode(getFiberId(fiber), snapshotId);
      }

      function handleClick(event) {
        event.preventDefault();
        event.stopPropagation();
        const fiber = resolveFiberFromElement(event.target);
        if (!fiber) {
          cleanup(null);
          return;
        }

        cleanup(inspectNode(getFiberId(fiber), snapshotId));
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
      observationLevel: "observed",
      limitations: commonLimitations.profiler.slice(),
      runtimeWarnings: state.profiler.active ? [] : ["Profiler data is commit-oriented only; use inspect/tree snapshots for follow-up analysis"],
      profileId: state.profiler.profileId,
      active: state.profiler.active,
      startedAt: state.profiler.startedAt,
      stoppedAt: state.profiler.stoppedAt,
      commitCount: commitEvents.length,
      maxNodeCount: nodeCounts.length ? Math.max(...nodeCounts) : 0,
      minNodeCount: nodeCounts.length ? Math.min(...nodeCounts) : 0,
      averageNodeCount: nodeCounts.length ? totalNodeCount / nodeCounts.length : 0,
      roots: [...new Set(commitEvents.map((event) => event.rootId))],
      measuresComponentDuration: false,
      tracksChangedFibers: false,
      nodeCountMeaning: "live-tree-size-at-commit",
      safeConclusions: [
        "a commit occurred",
        "live tree size at commit was captured",
        "commit frequency changed during the profiling window",
      ],
      unsafeConclusions: [
        "all matching nodes rerendered",
        "a specific component took N ms",
        "a prop was unnecessary without source confirmation",
      ],
    };
  }

  function doctor() {
    const tree = peekTree();
    const checks = {
      reactRuntime: {
        status: tree.reactDetected ? "ok" : "failed",
        reactDetected: tree.reactDetected,
        rootCount: tree.roots.length,
        nodeCount: tree.nodes.length,
      },
      snapshotCollection: {
        status: "failed",
        snapshotId: null,
      },
      inspect: {
        status: "failed",
        nodeId: null,
      },
      profiler: {
        status: "partial",
        measuresComponentDuration: false,
        tracksChangedFibers: false,
      },
      sourceReveal: {
        status: "failed",
        available: false,
      },
    };
    const runtimeWarnings = [];

    if (!tree.reactDetected) {
      runtimeWarnings.push("No React fiber roots were detected on the current page");
      return {
        status: "failed",
        observationLevel: "observed",
        limitations: commonLimitations.snapshot.concat(commonLimitations.inspect, commonLimitations.profiler),
        runtimeWarnings,
        checks,
      };
    }

    const snapshot = collectTree();
    checks.snapshotCollection = {
      status: snapshot.snapshotId ? "ok" : "failed",
      snapshotId: snapshot.snapshotId || null,
    };

    const firstNode = snapshot.nodes[0] || null;
    if (firstNode) {
      const details = inspectNode(firstNode.id, snapshot.snapshotId);
      checks.inspect = {
        status: details ? "ok" : "failed",
        nodeId: firstNode.id,
      };
      checks.sourceReveal = {
        status: details?.source ? "ok" : "partial",
        available: Boolean(details?.source),
      };
      if (!details?.source) {
        runtimeWarnings.push("_debugSource is unavailable for the inspected node in the current build");
      }
    }

    runtimeWarnings.push("Profiler is commit-oriented only; it does not track changed fibers or component durations");

    return {
      status: runtimeWarnings.length ? "partial" : "ok",
      observationLevel: "observed",
      limitations: commonLimitations.snapshot.concat(commonLimitations.inspect, commonLimitations.profiler),
      runtimeWarnings,
      checks,
    };
  }

  function recordCommit(rendererId, root, priorityLevel) {
    const rootState = getRootState(root);
    rootState.rendererId = rendererId;
    rootState.root = root;

    if (!state.profiler.active) {
      return;
    }

    const liveTree = collectLiveTree();
    state.profiler.events.push({
      eventType: "commit",
      timestamp: new Date().toISOString(),
      rootId: rootState.rootId,
      rendererId,
      priorityLevel: priorityLevel == null ? null : priorityLevel,
      nodeCount: liveTree.nodes.length,
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
    peekTree,
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
    doctor,
  };
})();`;
}
