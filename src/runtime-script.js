export function runtimeBootstrap() {
  if (window.__RDT_CLI_RUNTIME__) {
    return;
  }

  const OBSERVED = "observed";
  const INFERRED = "inferred";
  const STRUCTURAL_ONLY = "structural-only";
  const ACTUAL_DURATION = "actual-duration";
  const MIXED = "mixed";
  const COMMIT = "commit";
  const NO_REACT_WARNING = "No React fiber roots were detected on the current page";
  const NO_SOURCE_WARNING = "_debugSource unavailable for this node in the current build";
  const DOCTOR_SOURCE_WARNING = "_debugSource is unavailable for the inspected node in the current build";
  const SNAPSHOT_DIFF_LIMITATION = "changed nodes and rerender reasons are inferred from commit snapshot diffs";
  const RANKING_FALLBACK_LIMITATION = "duration metrics were unavailable; ranking falls back to changed subtree breadth";
  const FLAMEGRAPH_FALLBACK_LIMITATION = "duration metrics were unavailable; flamegraph timings fall back to null values";
  const COMMIT_RANKING_WARNING = "Duration metrics were unavailable for this commit; ranking uses changed subtree breadth";
  const COMMIT_DETAIL_WARNING = "Duration metrics were unavailable for this commit; subtree ranking uses structural fallbacks";
  const COMMIT_FLAMEGRAPH_WARNING = "Duration metrics were unavailable for this commit; flamegraph emphasizes changed subtree structure";
  const COMMIT_LIST_WARNING = "Duration metrics were unavailable for this commit; ranked views use structural fallbacks";
  const PROFILER_FOLLOWUP_WARNING = "Profiler data is commit-oriented only; use inspect/tree snapshots for follow-up analysis";
  const PROFILER_SOURCE_WARNING = "Profiler records component duration metrics when the current React runtime exposes them, but changed-fiber attribution is still inferred from commit snapshots";
  const PROFILER_STRUCTURAL_WARNING = "Profiler is commit-oriented only; it does not track changed fibers or component durations";

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
      nextCommitId: 1,
      profiles: new Map(),
      maxProfiles: 10,
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
      "commit data does not prove which components rerendered",
    ],
  };

  function hasDurationMetrics(measurementMode) {
    return measurementMode === ACTUAL_DURATION || measurementMode === MIXED;
  }

  function getProfilerLimitations(measurementMode) {
    const limitations = commonLimitations.profiler.slice();
    if (!hasDurationMetrics(measurementMode)) {
      limitations.splice(1, 0, "component durations are not measured");
    }
    return limitations;
  }

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

  function pruneProfiles() {
    while (state.profiler.profiles.size > state.profiler.maxProfiles) {
      const oldestProfileId = state.profiler.profiles.keys().next().value;
      if (!oldestProfileId) {
        break;
      }
      state.profiler.profiles.delete(oldestProfileId);
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

  function stableStringify(value) {
    if (value == null || typeof value !== "object") {
      return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
      return "[" + value.map((item) => stableStringify(item)).join(",") + "]";
    }

    const keys = Object.keys(value).sort();
    return "{" + keys.map((key) => JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
  }

  function getTopLevelDiffKeys(previous, next) {
    const prev = previous && typeof previous === "object" && !Array.isArray(previous) ? previous : {};
    const curr = next && typeof next === "object" && !Array.isArray(next) ? next : {};
    const keys = new Set(Object.keys(prev).concat(Object.keys(curr)));
    const changed = [];

    for (const key of keys) {
      if (stableStringify(prev[key]) !== stableStringify(curr[key])) {
        changed.push(key);
      }
    }

    return changed;
  }

  function getChangedHookIndexes(previous, next) {
    const prev = Array.isArray(previous) ? previous : [];
    const curr = Array.isArray(next) ? next : [];
    const length = Math.max(prev.length, curr.length);
    const changed = [];

    for (let index = 0; index < length; index += 1) {
      if (stableStringify(prev[index] || null) !== stableStringify(curr[index] || null)) {
        changed.push(index);
      }
    }

    return changed;
  }

  function getChangedContextNames(previous, next) {
    const prev = Array.isArray(previous) ? previous : [];
    const curr = Array.isArray(next) ? next : [];
    const changed = [];
    const length = Math.max(prev.length, curr.length);

    for (let index = 0; index < length; index += 1) {
      const prevEntry = prev[index] || null;
      const currEntry = curr[index] || null;
      if (stableStringify(prevEntry) !== stableStringify(currEntry)) {
        changed.push(
          currEntry?.displayName ||
          prevEntry?.displayName ||
          "Context",
        );
      }
    }

    return changed;
  }

  function getCommitEvents() {
    return state.profiler.events.filter((event) => event.eventType === COMMIT);
  }

  function getSnapshotLimitations() {
    return commonLimitations.snapshot.slice();
  }

  function getObservedTree(runtimeWarnings, tree) {
    return {
      snapshotId: null,
      snapshotScoped: true,
      identityStableAcrossCommits: false,
      observationLevel: OBSERVED,
      limitations: getSnapshotLimitations(),
      runtimeWarnings,
      generatedAt: tree.generatedAt,
      reactDetected: tree.reactDetected,
      roots: tree.roots,
      nodes: tree.nodes,
      selectedNodeId: tree.selectedNodeId,
    };
  }

  function getCommitNotFoundError(commitId) {
    return createRuntimeError(
      "commit-not-found",
      "Commit \"" + commitId + "\" is not available in the current profiler buffer.",
      { commitId },
    );
  }

  function getProfileNotFoundError(profileId) {
    return createRuntimeError(
      "profile-not-found",
      "Profile \"" + profileId + "\" is not available in the current profiler history.",
      { profileId },
    );
  }

  function getCommitObservation(measurementMode, warning, extraLimitations) {
    return {
      observationLevel: measurementMode === ACTUAL_DURATION ? OBSERVED : INFERRED,
      limitations: getProfilerLimitations(measurementMode).concat(
        measurementMode === ACTUAL_DURATION
          ? [SNAPSHOT_DIFF_LIMITATION]
          : extraLimitations,
      ),
      runtimeWarnings: measurementMode === ACTUAL_DURATION ? [] : [warning],
    };
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

  function getDurationMetrics(fiber) {
    const actualDuration = typeof fiber?.actualDuration === "number" ? fiber.actualDuration : null;
    const actualStartTime = typeof fiber?.actualStartTime === "number" ? fiber.actualStartTime : null;
    const treeBaseDuration = typeof fiber?.treeBaseDuration === "number" ? fiber.treeBaseDuration : null;

    return {
      actualDuration,
      actualStartTime,
      treeBaseDuration,
      totalTime: actualDuration,
      selfTime: actualDuration,
    };
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
      observationLevel: OBSERVED,
      limitations: commonLimitations.snapshot.concat(commonLimitations.inspect),
      runtimeWarnings: node.source ? [] : [NO_SOURCE_WARNING],
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

  function traverseFiberTree(fiber, parentId, depth, rootId, output, nodeDetails, nodeMetrics, nodeMeta, parentAnalyzerKey) {
    let current = fiber;
    let siblingIndex = 0;

    while (current) {
      const node = buildNodeRecord(current, parentId, depth, rootId);
      const analyzerKey = [
        rootId,
        parentAnalyzerKey || "root",
        node.displayName || "Anonymous",
        node.key || "",
        node.tagName,
        siblingIndex,
      ].join("|");
      output.push(node);
      nodeDetails.set(node.id, buildNodeDetails(current, node));
      nodeMetrics.set(node.id, getDurationMetrics(current));
      nodeMeta.set(node.id, {
        analyzerKey,
        parentAnalyzerKey: parentAnalyzerKey || null,
      });

      if (current.child) {
        traverseFiberTree(current.child, node.id, depth + 1, rootId, output, nodeDetails, nodeMetrics, nodeMeta, analyzerKey);
      }

      current = current.sibling;
      siblingIndex += 1;
    }
  }

  function finalizeNodeMetrics(nodes, nodeMetrics) {
    const childrenById = new Map();
    for (const node of nodes) {
      if (!childrenById.has(node.id)) {
        childrenById.set(node.id, []);
      }
      if (node.parentId) {
        const siblings = childrenById.get(node.parentId) || [];
        siblings.push(node.id);
        childrenById.set(node.parentId, siblings);
      }
    }

    const nodesByDepth = nodes.slice().sort((left, right) => right.depth - left.depth);
    for (const node of nodesByDepth) {
      const metrics = nodeMetrics.get(node.id);
      if (!metrics || typeof metrics.totalTime !== "number") {
        continue;
      }

      const childIds = childrenById.get(node.id) || [];
      const childTotal = childIds.reduce((sum, childId) => {
        const childMetrics = nodeMetrics.get(childId);
        return sum + (typeof childMetrics?.totalTime === "number" ? childMetrics.totalTime : 0);
      }, 0);

      metrics.selfTime = Math.max(0, metrics.totalTime - childTotal);
    }
  }

  function collectLiveTree() {
    const roots = [];
    const nodes = [];
    const nodeDetails = new Map();
    const nodeMetrics = new Map();
    const nodeMeta = new Map();

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

      traverseFiberTree(current.child, null, 0, entry.rootId, nodes, nodeDetails, nodeMetrics, nodeMeta, null);
    }

    finalizeNodeMetrics(nodes, nodeMetrics);

    return {
      generatedAt: new Date().toISOString(),
      reactDetected: roots.length > 0,
      roots,
      nodes,
      selectedNodeId: null,
      nodeDetails,
      nodeMetrics,
      nodeMeta,
    };
  }

  function serializeSnapshot(snapshot) {
    return {
      snapshotId: snapshot.snapshotId,
      snapshotScoped: true,
      identityStableAcrossCommits: false,
      observationLevel: OBSERVED,
      limitations: getSnapshotLimitations(),
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
      nodeMetrics: new Map(Array.from(tree.nodeMetrics.entries(), ([nodeId, metrics]) => [
        nodeId,
        {
          ...metrics,
        },
      ])),
      nodeMeta: new Map(Array.from(tree.nodeMeta.entries(), ([nodeId, meta]) => [
        nodeId,
        {
          ...meta,
        },
      ])),
    };

    state.snapshots.set(snapshot.snapshotId, snapshot);
    state.latestSnapshotId = snapshot.snapshotId;
    pruneSnapshots();
    return snapshot;
  }

  function collectTree() {
    const liveTree = collectLiveTree();
    if (!liveTree.reactDetected) {
      return getObservedTree([NO_REACT_WARNING], liveTree);
    }

    const snapshot = cacheSnapshot(liveTree);
    return serializeSnapshot(snapshot);
  }

  function peekTree() {
    const liveTree = collectLiveTree();
    return getObservedTree(liveTree.reactDetected ? [] : [NO_REACT_WARNING], liveTree);
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

  function getProfilerCommit(commitId) {
    return state.profiler.events.find((event) => event.eventType === COMMIT && event.commitId === commitId) || null;
  }

  function inspectNode(nodeId, snapshotId, commitId) {
    if (commitId) {
      const commit = getProfilerCommit(commitId);
      if (!commit) {
        return createRuntimeError(
          "commit-not-found",
          "Commit \"" + commitId + "\" is not available in the current profiler buffer.",
          { commitId },
        );
      }

      const details = commit.nodeDetailsById[nodeId];
      if (!details) {
        return null;
      }

      return {
        ...details,
        commitId,
        profiler: commit.nodeAnalysisById[nodeId] || null,
        metrics: commit.nodeMetricsById[nodeId] || null,
      };
    }

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
    const commitEvents = getCommitEvents();
    const nodeCounts = commitEvents.map((event) => event.nodeCount);
    const totalNodeCount = nodeCounts.reduce((sum, count) => sum + count, 0);
    const measurementModes = [...new Set(commitEvents.map((event) => event.measurementMode || STRUCTURAL_ONLY))];

    const measurementMode = measurementModes.length === 1 ? measurementModes[0] : MIXED;
    const measuresComponentDuration = hasDurationMetrics(measurementMode);
    return {
      observationLevel: OBSERVED,
      limitations: getProfilerLimitations(measurementMode),
      runtimeWarnings: state.profiler.active ? [] : [PROFILER_FOLLOWUP_WARNING],
      profileId: state.profiler.profileId,
      active: state.profiler.active,
      startedAt: state.profiler.startedAt,
      stoppedAt: state.profiler.stoppedAt,
      commitCount: commitEvents.length,
      commitIds: commitEvents.map((event) => event.commitId),
      maxNodeCount: nodeCounts.length ? Math.max(...nodeCounts) : 0,
      minNodeCount: nodeCounts.length ? Math.min(...nodeCounts) : 0,
      averageNodeCount: nodeCounts.length ? totalNodeCount / nodeCounts.length : 0,
      roots: [...new Set(commitEvents.map((event) => event.rootId))],
      measurementMode,
      measuresComponentDuration,
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

  function getCurrentProfilerRecord() {
    return {
      profileId: state.profiler.profileId,
      summary: summarizeProfiler(),
      events: state.profiler.events.slice(),
    };
  }

  function storeProfilerRecord(record) {
    if (!record?.profileId) {
      return;
    }

    state.profiler.profiles.set(record.profileId, record);
    pruneProfiles();
  }

  function getStoredProfilerRecord(profileId) {
    if (profileId && profileId === state.profiler.profileId) {
      return getCurrentProfilerRecord();
    }

    return state.profiler.profiles.get(profileId) || null;
  }

  function doctor() {
    const tree = peekTree();
    const liveTree = tree.reactDetected ? collectLiveTree() : null;
    const liveMeasurementMode = liveTree && Array.from(liveTree.nodeMetrics.values()).some((metrics) => typeof metrics.actualDuration === "number")
      ? ACTUAL_DURATION
      : STRUCTURAL_ONLY;
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
        measuresComponentDuration: hasDurationMetrics(liveMeasurementMode),
        tracksChangedFibers: false,
      },
      interact: {
        status: document.body ? "ok" : "failed",
        hasDocumentBody: Boolean(document.body),
      },
      sourceReveal: {
        status: "failed",
        available: false,
      },
    };
    const runtimeWarnings = [];

    if (!tree.reactDetected) {
      runtimeWarnings.push(NO_REACT_WARNING);
      return {
        status: "failed",
        observationLevel: OBSERVED,
        limitations: commonLimitations.snapshot.concat(commonLimitations.inspect, getProfilerLimitations(liveMeasurementMode)),
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
        runtimeWarnings.push(DOCTOR_SOURCE_WARNING);
      }
    }

    runtimeWarnings.push(
      hasDurationMetrics(liveMeasurementMode)
        ? PROFILER_SOURCE_WARNING
        : PROFILER_STRUCTURAL_WARNING,
    );

    return {
      status: runtimeWarnings.length ? "partial" : "ok",
      observationLevel: OBSERVED,
      limitations: commonLimitations.snapshot.concat(commonLimitations.inspect, getProfilerLimitations(liveMeasurementMode)),
      runtimeWarnings,
      checks,
      recommendedWorkflow: [
        "run tree get to capture a snapshotId",
        "reuse snapshotId for node search, inspect, highlight, and source reveal",
        "start profiler before reproducing an interaction",
        "use profiler commits, commit, ranked, and flamegraph for hotspot analysis",
      ],
      unsafeConclusions: [
        "all matching nodes rerendered solely because they appear in the tree",
        "component-level timing is available when measurementMode is structural-only",
        "source reveal is unsupported just because _debugSource is unavailable",
      ],
    };
  }

  function buildCommitDiff(previousCommit, currentCommit) {
    const previousNodesByAnalyzer = new Map();
    if (previousCommit) {
      for (const [nodeId, meta] of Object.entries(previousCommit.nodeMetaById)) {
        previousNodesByAnalyzer.set(meta.analyzerKey, {
          nodeId,
          meta,
          details: previousCommit.nodeDetailsById[nodeId],
          metrics: previousCommit.nodeMetricsById[nodeId],
        });
      }
    }

    const currentNodesByAnalyzer = new Map();
    for (const [nodeId, meta] of Object.entries(currentCommit.nodeMetaById)) {
      currentNodesByAnalyzer.set(meta.analyzerKey, {
        nodeId,
        meta,
        details: currentCommit.nodeDetailsById[nodeId],
        metrics: currentCommit.nodeMetricsById[nodeId],
      });
    }

    const analysisById = {};
    const mountedNodeIds = [];
    const unmountedNodeIds = [];
    const changedNodeIds = [];
    const reasonCounts = {
      mount: 0,
      unmount: 0,
      "props-changed": 0,
      "state-changed": 0,
      "hooks-changed": 0,
      "context-changed": 0,
      "parent-render": 0,
    };
    const propCounts = {};
    const hookCounts = {};
    const contextCounts = {};

    for (const [nodeId, currentEntry] of Object.entries(currentCommit.nodeMetaById)) {
      const previousEntry = previousNodesByAnalyzer.get(currentEntry.analyzerKey) || null;
      const currentDetails = currentCommit.nodeDetailsById[nodeId];
      const reasons = [];
      const changedPropKeys = [];
      const changedHookIndexes = [];
      const changedContextNames = [];

      if (!previousEntry) {
        reasons.push("mount");
        mountedNodeIds.push(nodeId);
        reasonCounts.mount += 1;
      } else {
        const previousDetails = previousEntry.details;
        const propDiffs = getTopLevelDiffKeys(previousDetails?.props, currentDetails?.props);
        if (propDiffs.length) {
          reasons.push("props-changed");
          changedPropKeys.push(...propDiffs);
          reasonCounts["props-changed"] += 1;
          for (const key of propDiffs) {
            propCounts[key] = (propCounts[key] || 0) + 1;
          }
        }

        if (stableStringify(previousDetails?.state) !== stableStringify(currentDetails?.state)) {
          reasons.push("state-changed");
          reasonCounts["state-changed"] += 1;
        }

        const hookDiffs = getChangedHookIndexes(previousDetails?.hooks, currentDetails?.hooks);
        if (hookDiffs.length) {
          reasons.push("hooks-changed");
          changedHookIndexes.push(...hookDiffs);
          reasonCounts["hooks-changed"] += 1;
          for (const index of hookDiffs) {
            hookCounts[index] = (hookCounts[index] || 0) + 1;
          }
        }

        const contextDiffs = getChangedContextNames(previousDetails?.context, currentDetails?.context);
        if (contextDiffs.length) {
          reasons.push("context-changed");
          changedContextNames.push(...contextDiffs);
          reasonCounts["context-changed"] += 1;
          for (const name of contextDiffs) {
            contextCounts[name] = (contextCounts[name] || 0) + 1;
          }
        }
      }

      const changed = reasons.length > 0;
      if (changed) {
        changedNodeIds.push(nodeId);
      }

      analysisById[nodeId] = {
        commitId: currentCommit.commitId,
        nodeId,
        changed,
        rerenderReasons: reasons,
        changedPropKeys,
        changedHookIndexes,
        changedContextNames,
        matchingConfidence: previousEntry ? "high" : "medium",
      };
    }

    if (previousCommit) {
      for (const [nodeId, previousMeta] of Object.entries(previousCommit.nodeMetaById)) {
        if (!currentNodesByAnalyzer.has(previousMeta.analyzerKey)) {
          unmountedNodeIds.push(nodeId);
          reasonCounts.unmount += 1;
        }
      }
    }

    const changedNodeSet = new Set(changedNodeIds);
    const changedDescendantCounts = {};
    const changedSubtreeRootIds = [];
    const childrenById = {};
    const nodesById = {};

    for (const node of currentCommit.treeSnapshot.nodes) {
      nodesById[node.id] = node;
      if (!childrenById[node.id]) {
        childrenById[node.id] = [];
      }
      if (node.parentId) {
        childrenById[node.parentId] = childrenById[node.parentId] || [];
        childrenById[node.parentId].push(node.id);
      }
    }

    const nodesByDepth = currentCommit.treeSnapshot.nodes.slice().sort((left, right) => right.depth - left.depth);
    for (const node of nodesByDepth) {
      const childIds = childrenById[node.id] || [];
      const childChangedCount = childIds.reduce((sum, childId) => sum + (changedDescendantCounts[childId] || 0), 0);
      const selfChangedCount = changedNodeSet.has(node.id) ? 1 : 0;
      changedDescendantCounts[node.id] = selfChangedCount + childChangedCount;
    }

    for (const node of currentCommit.treeSnapshot.nodes) {
      const analysis = analysisById[node.id];
      if (!analysis || analysis.rerenderReasons.length > 0 || !node.parentId) {
        continue;
      }

      let ancestorId = node.parentId;
      while (ancestorId) {
        if (changedNodeSet.has(ancestorId)) {
          analysis.rerenderReasons.push("parent-render");
          analysis.changed = true;
          changedNodeSet.add(node.id);
          changedNodeIds.push(node.id);
          reasonCounts["parent-render"] += 1;
          break;
        }

        ancestorId = nodesById[ancestorId]?.parentId || null;
      }
    }

    for (const node of currentCommit.treeSnapshot.nodes) {
      const childIds = childrenById[node.id] || [];
      const childChangedCount = childIds.reduce((sum, childId) => sum + (changedDescendantCounts[childId] || 0), 0);
      const selfChangedCount = changedNodeSet.has(node.id) ? 1 : 0;
      changedDescendantCounts[node.id] = selfChangedCount + childChangedCount;
    }

    for (const node of currentCommit.treeSnapshot.nodes) {
      if (!changedNodeSet.has(node.id)) {
        continue;
      }

      if (!node.parentId || !changedNodeSet.has(node.parentId)) {
        changedSubtreeRootIds.push(node.id);
      }
    }

    return {
      nodeAnalysisById: analysisById,
      changedNodeIds,
      mountedNodeIds,
      unmountedNodeIds,
      changedSubtreeRootIds,
      changedDescendantCounts,
      reasonCounts,
      topChangedProps: Object.entries(propCounts)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 10)
        .map(([key, count]) => ({ key, count })),
      topChangedHooks: Object.entries(hookCounts)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 10)
        .map(([index, count]) => ({ index: Number(index), count })),
      topChangedContexts: Object.entries(contextCounts)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 10)
        .map(([name, count]) => ({ name, count })),
    };
  }

  function serializeMap(map) {
    return Object.fromEntries(Array.from(map.entries()));
  }

  function buildCommitEvent(rendererId, rootState, priorityLevel, liveTree) {
    const commitId = "commit-" + state.profiler.nextCommitId++;
    const measurementMode = Array.from(liveTree.nodeMetrics.values()).some((metrics) => typeof metrics.actualDuration === "number")
      ? ACTUAL_DURATION
      : STRUCTURAL_ONLY;

    return {
      eventType: COMMIT,
      commitId,
      timestamp: new Date().toISOString(),
      rootId: rootState.rootId,
      rendererId,
      priorityLevel: priorityLevel == null ? null : priorityLevel,
      nodeCount: liveTree.nodes.length,
      measurementMode,
      treeSnapshot: {
        roots: liveTree.roots,
        nodes: liveTree.nodes,
        generatedAt: liveTree.generatedAt,
      },
      nodeDetailsById: serializeMap(liveTree.nodeDetails),
      nodeMetricsById: serializeMap(liveTree.nodeMetrics),
      nodeMetaById: serializeMap(liveTree.nodeMeta),
      nodeAnalysisById: {},
      changedNodeIds: [],
      mountedNodeIds: [],
      unmountedNodeIds: [],
      changedSubtreeRootIds: [],
      changedDescendantCounts: {},
      reasonCounts: {},
      topChangedProps: [],
      topChangedHooks: [],
      topChangedContexts: [],
    };
  }

  function getCommitMeasurementMode(commit) {
    return commit?.measurementMode || STRUCTURAL_ONLY;
  }

  function getCommitSummary(commit) {
    const changedNodeCount = commit.changedNodeIds.length;
    return {
      commitId: commit.commitId,
      timestamp: commit.timestamp,
      rootId: commit.rootId,
      rendererId: commit.rendererId,
      priorityLevel: commit.priorityLevel,
      nodeCount: commit.nodeCount,
      measurementMode: getCommitMeasurementMode(commit),
      changedNodeCount,
      mountedNodeCount: commit.mountedNodeIds.length,
      unmountedNodeCount: commit.unmountedNodeIds.length,
      changedSubtreeRootCount: commit.changedSubtreeRootIds.length,
      reasonCounts: commit.reasonCounts,
      topChangedProps: commit.topChangedProps || [],
      topChangedHooks: commit.topChangedHooks || [],
      topChangedContexts: commit.topChangedContexts || [],
    };
  }

  function listProfilerCommits() {
    return getCommitEvents()
      .map((commit) => ({
        ...getCommitObservation(getCommitMeasurementMode(commit), COMMIT_LIST_WARNING, [
          SNAPSHOT_DIFF_LIMITATION,
        ]),
        ...getCommitSummary(commit),
      }));
  }

  function summarizeReasonCounts(analysisById, changedNodeIds) {
    const counts = {};
    for (const nodeId of changedNodeIds) {
      const reasons = analysisById[nodeId]?.rerenderReasons || [];
      for (const reason of reasons) {
        counts[reason] = (counts[reason] || 0) + 1;
      }
    }
    return counts;
  }

  function getProfilerCommitDetail(commitId) {
    const commit = getProfilerCommit(commitId);
    if (!commit) {
      return getCommitNotFoundError(commitId);
    }

    const changedNodes = commit.changedNodeIds.map((nodeId) => {
      const node = commit.treeSnapshot.nodes.find((entry) => entry.id === nodeId);
      return {
        id: nodeId,
        displayName: node?.displayName || null,
        depth: node?.depth ?? null,
        reasons: commit.nodeAnalysisById[nodeId]?.rerenderReasons || [],
        changedPropKeys: commit.nodeAnalysisById[nodeId]?.changedPropKeys || [],
        changedHookIndexes: commit.nodeAnalysisById[nodeId]?.changedHookIndexes || [],
        changedContextNames: commit.nodeAnalysisById[nodeId]?.changedContextNames || [],
        metrics: commit.nodeMetricsById[nodeId] || null,
        changedDescendantCount: commit.changedDescendantCounts[nodeId] || 0,
      };
    });

    return {
      ...getCommitObservation(getCommitMeasurementMode(commit), COMMIT_DETAIL_WARNING, [
        COMMIT_DETAIL_WARNING,
        SNAPSHOT_DIFF_LIMITATION,
      ]),
      ...getCommitSummary(commit),
      changedNodeIds: commit.changedNodeIds,
      mountedNodeIds: commit.mountedNodeIds,
      unmountedNodeIds: commit.unmountedNodeIds,
      changedSubtreeRootIds: commit.changedSubtreeRootIds,
      changedNodes,
      topChangedProps: commit.topChangedProps || [],
      topChangedHooks: commit.topChangedHooks || [],
      topChangedContexts: commit.topChangedContexts || [],
      safeConclusions: [
        "these nodes changed across adjacent commit snapshots",
        "props/state/hooks/context diffs indicate likely rerender reasons",
      ],
      unsafeConclusions: [
        "all descendants rerendered unless directly indicated by changed node data",
        "duration-based ordering is precise when measurementMode is structural-only",
      ],
    };
  }

  function getReasonSummary(reasons) {
    return (reasons || []).length ? reasons.join(", ") : "unchanged";
  }

  function getHotspotLabel(item) {
    if ((item.rerenderReasons || []).includes("mount")) {
      return "mount-heavy";
    }

    if ((item.changedDescendantCount || 0) >= 25) {
      return "broad-update";
    }

    if ((item.changed || false) && (item.changedDescendantCount || 0) <= 2) {
      return "leaf-hotspot";
    }

    return "mixed-update";
  }

  function getCommitHotspotSummaries(commit) {
    const nodes = commit.treeSnapshot.nodes.map((node) => {
      const metrics = commit.nodeMetricsById[node.id] || {};
      const analysis = commit.nodeAnalysisById[node.id] || { rerenderReasons: [], changed: false };
      return {
        id: node.id,
        displayName: node.displayName,
        changed: Boolean(analysis.changed),
        rerenderReasons: analysis.rerenderReasons || [],
        totalTime: typeof metrics.totalTime === "number" ? metrics.totalTime : null,
        changedDescendantCount: commit.changedDescendantCounts[node.id] || 0,
      };
    });

    const hottestSubtrees = nodes
      .filter((node) => node.totalTime != null || node.changedDescendantCount > 0)
      .sort((left, right) => {
        const rightValue = right.totalTime == null ? right.changedDescendantCount : right.totalTime;
        const leftValue = left.totalTime == null ? left.changedDescendantCount : left.totalTime;
        return rightValue - leftValue;
      })
      .slice(0, 10)
      .map((node) => ({
        id: node.id,
        displayName: node.displayName,
        totalTime: node.totalTime,
        changedDescendantCount: node.changedDescendantCount,
      }));

    const widestChangedSubtrees = nodes
      .filter((node) => node.changedDescendantCount > 0)
      .sort((left, right) => right.changedDescendantCount - left.changedDescendantCount)
      .slice(0, 10)
      .map((node) => ({
        id: node.id,
        displayName: node.displayName,
        changedDescendantCount: node.changedDescendantCount,
      }));

    const mostCommonReasons = Object.entries(commit.reasonCounts || {})
      .sort((left, right) => right[1] - left[1])
      .slice(0, 10)
      .map(([reason, count]) => ({ reason, count }));

    return {
      hottestSubtrees,
      widestChangedSubtrees,
      mostCommonReasons,
    };
  }

  function rankProfilerCommit(commitId, limit) {
    const commit = getProfilerCommit(commitId);
    if (!commit) {
      return getCommitNotFoundError(commitId);
    }

    const ranked = commit.treeSnapshot.nodes.map((node) => {
      const metrics = commit.nodeMetricsById[node.id] || {};
      const analysis = commit.nodeAnalysisById[node.id] || {
        rerenderReasons: [],
        matchingConfidence: "low",
      };
      return {
        commitId,
        id: node.id,
        displayName: node.displayName,
        depth: node.depth,
        tagName: node.tagName,
        selfTime: metrics.selfTime == null ? null : metrics.selfTime,
        totalTime: metrics.totalTime == null ? null : metrics.totalTime,
        changed: Boolean(analysis.changed),
        rerenderReasons: analysis.rerenderReasons || [],
        reasonSummary: getReasonSummary(analysis.rerenderReasons || []),
        changedDescendantCount: commit.changedDescendantCounts[node.id] || 0,
        matchingConfidence: analysis.matchingConfidence || "low",
      };
    });

    const measurementMode = getCommitMeasurementMode(commit);
    ranked.sort((left, right) => {
      if (measurementMode === ACTUAL_DURATION) {
        const rightDuration = typeof right.totalTime === "number" ? right.totalTime : -1;
        const leftDuration = typeof left.totalTime === "number" ? left.totalTime : -1;
        if (rightDuration !== leftDuration) {
          return rightDuration - leftDuration;
        }
      }

      if (right.changedDescendantCount !== left.changedDescendantCount) {
        return right.changedDescendantCount - left.changedDescendantCount;
      }

      return left.depth - right.depth;
    });

    const items = ranked.slice(0, Math.max(1, limit || 20));
    for (const item of items) {
      item.hotspotLabel = getHotspotLabel(item);
    }
    return {
      ...getCommitObservation(measurementMode, COMMIT_RANKING_WARNING, [
        RANKING_FALLBACK_LIMITATION,
        SNAPSHOT_DIFF_LIMITATION,
      ]),
      commitId,
      measurementMode,
      hotspotSummaries: getCommitHotspotSummaries(commit),
      items,
    };
  }

  function buildFlamegraphNode(nodeId, nodesById, childrenById, commit) {
    const node = nodesById[nodeId];
    const metrics = commit.nodeMetricsById[nodeId] || {};
    const analysis = commit.nodeAnalysisById[nodeId] || {
      rerenderReasons: [],
      changed: false,
      matchingConfidence: "low",
    };

    return {
      id: node.id,
      displayName: node.displayName,
      depth: node.depth,
      tagName: node.tagName,
      selfTime: metrics.selfTime == null ? null : metrics.selfTime,
      totalTime: metrics.totalTime == null ? null : metrics.totalTime,
      changed: Boolean(analysis.changed),
      changedDescendantCount: commit.changedDescendantCounts[nodeId] || 0,
      rerenderReasons: analysis.rerenderReasons || [],
      reasonSummary: getReasonSummary(analysis.rerenderReasons || []),
      hotspotLabel: getHotspotLabel({
        changed: Boolean(analysis.changed),
        rerenderReasons: analysis.rerenderReasons || [],
        changedDescendantCount: commit.changedDescendantCounts[nodeId] || 0,
      }),
      matchingConfidence: analysis.matchingConfidence || "low",
      children: (childrenById[nodeId] || []).map((childId) => buildFlamegraphNode(childId, nodesById, childrenById, commit)),
    };
  }

  function flamegraphProfilerCommit(commitId) {
    const commit = getProfilerCommit(commitId);
    if (!commit) {
      return getCommitNotFoundError(commitId);
    }

    const nodesById = {};
    const childrenById = {};
    const rootNodeIds = [];

    for (const node of commit.treeSnapshot.nodes) {
      nodesById[node.id] = node;
      childrenById[node.id] = childrenById[node.id] || [];
      if (node.parentId) {
        childrenById[node.parentId] = childrenById[node.parentId] || [];
        childrenById[node.parentId].push(node.id);
      } else {
        rootNodeIds.push(node.id);
      }
    }

    return {
      ...getCommitObservation(getCommitMeasurementMode(commit), COMMIT_FLAMEGRAPH_WARNING, [
        FLAMEGRAPH_FALLBACK_LIMITATION,
        SNAPSHOT_DIFF_LIMITATION,
      ]),
      commitId,
      measurementMode: getCommitMeasurementMode(commit),
      ...getCommitHotspotSummaries(commit),
      roots: rootNodeIds.map((nodeId) => buildFlamegraphNode(nodeId, nodesById, childrenById, commit)),
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
    const commit = buildCommitEvent(rendererId, rootState, priorityLevel, liveTree);
    const previousCommit = getCommitEvents().slice(-1)[0] || null;
    const diff = buildCommitDiff(previousCommit, commit);
    commit.nodeAnalysisById = diff.nodeAnalysisById;
    commit.changedNodeIds = diff.changedNodeIds;
    commit.mountedNodeIds = diff.mountedNodeIds;
    commit.unmountedNodeIds = diff.unmountedNodeIds;
    commit.changedSubtreeRootIds = diff.changedSubtreeRootIds;
    commit.changedDescendantCounts = diff.changedDescendantCounts;
    commit.reasonCounts = diff.reasonCounts;
    commit.topChangedProps = diff.topChangedProps;
    commit.topChangedHooks = diff.topChangedHooks;
    commit.topChangedContexts = diff.topChangedContexts;
    state.profiler.events.push(commit);
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
      state.profiler.nextCommitId = 1;
      return summarizeProfiler();
    },
    stopProfiler() {
      state.profiler.active = false;
      state.profiler.stoppedAt = new Date().toISOString();
      const record = getCurrentProfilerRecord();
      storeProfilerRecord(record);
      return record.summary;
    },
    exportProfiler(profileId) {
      const record = profileId ? getStoredProfilerRecord(profileId) : getCurrentProfilerRecord();
      if (!record) {
        return getProfileNotFoundError(profileId);
      }
      return record;
    },
    profilerProfile(profileId) {
      const record = getStoredProfilerRecord(profileId);
      return record || getProfileNotFoundError(profileId);
    },
    profilerCommits: listProfilerCommits,
    profilerCommit: getProfilerCommitDetail,
    profilerRanked: rankProfilerCommit,
    profilerFlamegraph: flamegraphProfilerCommit,
    profilerSummary: summarizeProfiler,
    doctor,
  };
}

export function createRuntimeScript() {
  return `(${runtimeBootstrap.toString()})();`;
}
