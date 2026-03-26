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
  const ENGINE_AUTO = "auto";
  const ENGINE_CUSTOM = "custom";
  const ENGINE_DEVTOOLS = "devtools";
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
  const INITIAL_MOUNT_WARNING = "Initial mount commits can dominate the first recorded commit after profiler start";

  const state = {
    nextNodeId: 1,
    nextRootId: 1,
    fiberIds: new WeakMap(),
    roots: new Map(),
    renderers: new Map(),
    snapshotIndex: new Map(),
    snapshotStores: {
      [ENGINE_CUSTOM]: {
        nextSnapshotId: 1,
        latestSnapshotId: null,
        maxSnapshots: 5,
        snapshots: new Map(),
      },
      [ENGINE_DEVTOOLS]: {
        nextSnapshotId: 1,
        latestSnapshotId: null,
        maxSnapshots: 5,
        snapshots: new Map(),
      },
    },
    profiler: {
      active: false,
      profileId: null,
      enginePreference: ENGINE_AUTO,
      selectedEngine: ENGINE_CUSTOM,
      startedAt: null,
      stoppedAt: null,
      events: [],
      nextCommitId: 1,
      profileIndex: new Map(),
      profilesByEngine: {
        [ENGINE_CUSTOM]: new Map(),
        [ENGINE_DEVTOOLS]: new Map(),
      },
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

  function getSelectedEngine(preferredEngine) {
    return detectDevtoolsCapabilities(preferredEngine).selectedEngine;
  }

  function getSnapshotStore(engineName) {
    return state.snapshotStores[engineName] || state.snapshotStores[ENGINE_CUSTOM];
  }

  function getProfilerStore(engineName) {
    return state.profiler.profilesByEngine[engineName] || state.profiler.profilesByEngine[ENGINE_CUSTOM];
  }

  function getProfilerLimitations(measurementMode) {
    const limitations = commonLimitations.profiler.slice();
    if (!hasDurationMetrics(measurementMode)) {
      limitations.splice(1, 0, "component durations are not measured");
    }
    return limitations;
  }

  function normalizeEnginePreference(value) {
    if (value === ENGINE_CUSTOM || value === ENGINE_DEVTOOLS) {
      return value;
    }

    return ENGINE_AUTO;
  }

  function detectDurationMetricsFromRoots() {
    const stack = [];
    for (const entry of state.roots.values()) {
      const current = entry.root?.current?.child || null;
      if (current) {
        stack.push(current);
      }
    }

    while (stack.length) {
      const fiber = stack.pop();
      if (!fiber) {
        continue;
      }

      if (typeof fiber.actualDuration === "number") {
        return true;
      }

      if (fiber.sibling) {
        stack.push(fiber.sibling);
      }

      if (fiber.child) {
        stack.push(fiber.child);
      }
    }

    return false;
  }

  function getRendererVersions() {
    const versions = [];
    for (const renderer of state.renderers.values()) {
      const version = renderer?.version || renderer?.reconcilerVersion || null;
      if (version && !versions.includes(String(version))) {
        versions.push(String(version));
      }
    }
    return versions;
  }

  function getHighestRendererMajor(versions) {
    const majors = (versions || [])
      .map((version) => Number.parseInt(String(version).split(".")[0], 10))
      .filter((value) => Number.isInteger(value));

    if (!majors.length) {
      return null;
    }

    return Math.max(...majors);
  }

  function getSourceCapability(details) {
    const rendererVersions = getRendererVersions();
    const highestRendererMajor = getHighestRendererMajor(rendererVersions);
    if (details?.source) {
      return {
        status: "ok",
        mode: "legacy-debug-source",
        available: true,
        rendererVersions,
        reason: "_debugSource is available for the inspected node",
      };
    }

    const react19OrNewer = highestRendererMajor != null && highestRendererMajor >= 19;
    return {
      status: "partial",
      mode: react19OrNewer ? "react19-removed-or-build-stripped" : "build-stripped-or-unavailable",
      available: false,
      rendererVersions,
      reason: react19OrNewer
        ? "React 19+ commonly omits _debugSource; source reveal is treated as an optional capability only"
        : "_debugSource is unavailable in the current build or runtime",
    };
  }

  function isHostLikeTagName(tagName) {
    return typeof tagName === "string" && tagName.startsWith("Host");
  }

  function detectDevtoolsCapabilities(preferredEngine) {
    const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || null;
    const rendererCount = state.renderers.size;
    const rendererVersions = getRendererVersions();
    const rootCount = Array.from(state.roots.values()).filter((entry) => entry.root?.current?.child).length;
    const reactDetected = rootCount > 0;
    const durationMetricsAvailable = detectDurationMetricsFromRoots();
    const canUseDevtoolsEngine = Boolean(hook) && rendererCount > 0 && rootCount > 0;
    const normalizedPreference = normalizeEnginePreference(preferredEngine);
    const recommendedEngine = canUseDevtoolsEngine ? ENGINE_DEVTOOLS : ENGINE_CUSTOM;
    const selectedEngine = normalizedPreference === ENGINE_AUTO
      ? recommendedEngine
      : (normalizedPreference === ENGINE_DEVTOOLS && canUseDevtoolsEngine ? ENGINE_DEVTOOLS : ENGINE_CUSTOM);

    return {
      hookPresent: Boolean(hook),
      rendererCount,
      rendererVersions,
      rootCount,
      reactDetected,
      durationMetricsAvailable,
      canUseDevtoolsEngine,
      inspectionAvailable: reactDetected,
      profilerAvailable: reactDetected,
      selectedEngine,
      recommendedEngine,
      availableEngines: canUseDevtoolsEngine
        ? [ENGINE_CUSTOM, ENGINE_DEVTOOLS]
        : [ENGINE_CUSTOM],
      enginePreference: normalizedPreference,
      engineFallback: normalizedPreference === ENGINE_DEVTOOLS && selectedEngine !== ENGINE_DEVTOOLS,
      engineReasons: canUseDevtoolsEngine
        ? [
            "React renderer roots are available through the DevTools global hook",
            durationMetricsAvailable
              ? "React runtime exposes duration metrics for at least one live fiber"
              : "DevTools-aligned engine is available, but duration metrics are not exposed in the current runtime",
          ]
        : [
            "Falling back to the custom engine because DevTools-aligned renderer data is not yet available on this page",
          ],
    };
  }

  function buildEngineMetadata(preferredEngine) {
    const capabilities = detectDevtoolsCapabilities(preferredEngine);
    return buildResolvedEngineMetadata(capabilities.enginePreference, capabilities.selectedEngine, capabilities);
  }

  function buildResolvedEngineMetadata(enginePreference, selectedEngine, capabilitiesInput) {
    const capabilities = capabilitiesInput || detectDevtoolsCapabilities(enginePreference);
    const resolvedEngine = selectedEngine || capabilities.selectedEngine;
    return {
      enginePreference: normalizeEnginePreference(enginePreference),
      engine: resolvedEngine,
      selectedEngine: resolvedEngine,
      recommendedEngine: capabilities.recommendedEngine,
      availableEngines: capabilities.availableEngines,
      engineFallback: normalizeEnginePreference(enginePreference) === ENGINE_DEVTOOLS && resolvedEngine !== ENGINE_DEVTOOLS,
      engineReasons: capabilities.engineReasons,
      inspectionSource: resolvedEngine === ENGINE_DEVTOOLS ? "devtools-aligned-fiber" : "custom-fiber",
      measurementSource: resolvedEngine === ENGINE_DEVTOOLS ? "devtools-hook-profiler" : "custom-snapshot-profiler",
      snapshotModel: resolvedEngine === ENGINE_DEVTOOLS ? "snapshot-scoped-devtools-aligned" : "snapshot-scoped-custom",
      devtoolsCapabilities: {
        hookPresent: capabilities.hookPresent,
        rendererCount: capabilities.rendererCount,
        rootCount: capabilities.rootCount,
        durationMetricsAvailable: capabilities.durationMetricsAvailable,
        inspectionAvailable: capabilities.inspectionAvailable,
        profilerAvailable: capabilities.profilerAvailable,
      },
    };
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

  function pruneSnapshots(engineName) {
    const store = getSnapshotStore(engineName);
    while (store.snapshots.size > store.maxSnapshots) {
      const oldestSnapshotId = store.snapshots.keys().next().value;
      if (!oldestSnapshotId) {
        break;
      }

      store.snapshots.delete(oldestSnapshotId);
      state.snapshotIndex.delete(oldestSnapshotId);
      if (store.latestSnapshotId === oldestSnapshotId) {
        store.latestSnapshotId = store.snapshots.size
          ? Array.from(store.snapshots.keys()).pop()
          : null;
      }
    }
  }

  function pruneProfiles(engineName) {
    const store = getProfilerStore(engineName);
    while (store.size > state.profiler.maxProfiles) {
      const oldestProfileId = store.keys().next().value;
      if (!oldestProfileId) {
        break;
      }
      store.delete(oldestProfileId);
      state.profiler.profileIndex.delete(oldestProfileId);
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

  function getObservedTree(runtimeWarnings, tree, preferredEngine) {
    const engineMeta = buildEngineMetadata(preferredEngine);
    return {
      ...engineMeta,
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
    const stack = [];
    if (fiber?.child) {
      stack.push(fiber.child);
    }

    while (stack.length) {
      const current = stack.pop();
      if (!current) {
        continue;
      }

      if (current.tag === 5 && current.stateNode instanceof Element) {
        return current;
      }

      if (current.sibling) {
        stack.push(current.sibling);
      }

      if (current.child) {
        stack.push(current.child);
      }
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

  function buildNodeDetails(fiber, node, preferredEngine) {
    const engineMeta = buildEngineMetadata(preferredEngine);
    return {
      ...engineMeta,
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

  function traverseFiberTree(fiber, parentId, depth, rootId, output, nodeDetails, nodeMetrics, nodeMeta, parentAnalyzerKey, preferredEngine, engineLabel) {
    let current = fiber;
    let siblingIndex = 0;

    while (current) {
      const node = buildNodeRecord(current, parentId, depth, rootId);
      const analyzerKey = [
        engineLabel,
        rootId,
        parentAnalyzerKey || "root",
        node.displayName || "Anonymous",
        node.key || "",
        node.tagName,
        siblingIndex,
      ].join("|");
      output.push(node);
      nodeDetails.set(node.id, buildNodeDetails(current, node, preferredEngine));
      nodeMetrics.set(node.id, getDurationMetrics(current));
      nodeMeta.set(node.id, {
        analyzerKey,
        parentAnalyzerKey: parentAnalyzerKey || null,
      });

      if (current.child) {
        traverseFiberTree(current.child, node.id, depth + 1, rootId, output, nodeDetails, nodeMetrics, nodeMeta, analyzerKey, preferredEngine, engineLabel);
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

  function collectFiberTree(preferredEngine, engineLabel) {
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

      traverseFiberTree(current.child, null, 0, entry.rootId, nodes, nodeDetails, nodeMetrics, nodeMeta, null, preferredEngine, engineLabel);
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

  function collectCustomLiveTree(preferredEngine) {
    return collectFiberTree(preferredEngine, ENGINE_CUSTOM);
  }

  function collectDevtoolsLiveTree(preferredEngine) {
    return collectFiberTree(preferredEngine, ENGINE_DEVTOOLS);
  }

  function collectLiveTree(preferredEngine) {
    const selectedEngine = getSelectedEngine(preferredEngine);
    if (selectedEngine === ENGINE_DEVTOOLS) {
      return collectDevtoolsLiveTree(preferredEngine);
    }

    return collectCustomLiveTree(preferredEngine);
  }

  function serializeSnapshot(snapshot, preferredEngine) {
    const engineMeta = snapshot.engineMeta || buildEngineMetadata(preferredEngine);
    return {
      ...engineMeta,
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

  function clampTopLimit(value, fallback = 10) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return fallback;
    }

    return Math.max(1, Math.floor(numeric));
  }

  function summarizeRoot(root, nodesById) {
    const node = nodesById.get(root.nodeId) || null;
    return {
      rootId: root.id,
      rendererId: root.rendererId,
      nodeId: root.nodeId,
      displayName: node?.displayName || null,
      tagName: node?.tagName || null,
    };
  }

  function collectTopLevelComponents(snapshot, limit) {
    const nodes = snapshot.nodes || [];
    const seen = new Set();
    const components = [];

    for (const root of snapshot.roots || []) {
      let candidates = nodes.filter((node) => {
        return node.rootId === root.id && node.depth === 1 && !isHostLikeTagName(node.tagName);
      });

      if (candidates.length === 0) {
        const fallbackDepth = nodes
          .filter((node) => node.rootId === root.id && !isHostLikeTagName(node.tagName))
          .reduce((minimum, node) => Math.min(minimum, node.depth), Number.POSITIVE_INFINITY);

        if (Number.isFinite(fallbackDepth)) {
          candidates = nodes.filter((node) => {
            return node.rootId === root.id && node.depth === fallbackDepth && !isHostLikeTagName(node.tagName);
          });
        }
      }

      for (const candidate of candidates) {
        const dedupeKey = `${candidate.rootId}:${candidate.displayName}:${candidate.tagName}:${candidate.depth}`;
        if (seen.has(dedupeKey)) {
          continue;
        }

        seen.add(dedupeKey);
        components.push({
          rootId: candidate.rootId,
          nodeId: candidate.id,
          displayName: candidate.displayName,
          tagName: candidate.tagName,
          depth: candidate.depth,
        });

        if (components.length >= limit) {
          return components;
        }
      }
    }

    return components;
  }

  function treeStats(top, preferredEngine) {
    const observedTree = collectTree(preferredEngine);
    const nodes = observedTree.nodes || [];
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const topLimit = clampTopLimit(top, 10);
    const topLevelComponents = observedTree.snapshotId
      ? collectTopLevelComponents(observedTree, topLimit)
      : [];

    return {
      enginePreference: observedTree.enginePreference,
      engine: observedTree.engine,
      selectedEngine: observedTree.selectedEngine,
      recommendedEngine: observedTree.recommendedEngine,
      availableEngines: observedTree.availableEngines,
      engineFallback: observedTree.engineFallback,
      engineReasons: observedTree.engineReasons,
      inspectionSource: observedTree.inspectionSource,
      measurementSource: observedTree.measurementSource,
      snapshotModel: observedTree.snapshotModel,
      devtoolsCapabilities: observedTree.devtoolsCapabilities,
      snapshotId: observedTree.snapshotId || null,
      snapshotScoped: true,
      identityStableAcrossCommits: false,
      observationLevel: OBSERVED,
      limitations: getSnapshotLimitations(),
      runtimeWarnings: observedTree.runtimeWarnings || [],
      generatedAt: observedTree.generatedAt || null,
      reactDetected: observedTree.reactDetected,
      rootCount: (observedTree.roots || []).length,
      nodeCount: nodes.length,
      rootSummaries: (observedTree.roots || []).map((root) => summarizeRoot(root, nodesById)),
      topLevelComponents,
      topLevelComponentCount: topLevelComponents.length,
    };
  }

  function cacheSnapshot(tree, preferredEngine) {
    const selectedEngine = getSelectedEngine(preferredEngine);
    const store = getSnapshotStore(selectedEngine);
    const snapshotId = "snapshot-" + store.nextSnapshotId++;
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
      enginePreference: normalizeEnginePreference(preferredEngine),
      selectedEngine,
      engineMeta: buildResolvedEngineMetadata(preferredEngine, selectedEngine),
    };

    store.snapshots.set(snapshot.snapshotId, snapshot);
    store.latestSnapshotId = snapshot.snapshotId;
    state.snapshotIndex.set(snapshot.snapshotId, selectedEngine);
    pruneSnapshots(selectedEngine);
    return snapshot;
  }

  function collectTree(preferredEngine) {
    const liveTree = collectLiveTree(preferredEngine);
    if (!liveTree.reactDetected) {
      return getObservedTree([NO_REACT_WARNING], liveTree, preferredEngine);
    }

    const snapshot = cacheSnapshot(liveTree, preferredEngine);
    return serializeSnapshot(snapshot, preferredEngine);
  }

  function peekTree(preferredEngine) {
    const liveTree = collectLiveTree(preferredEngine);
    return getObservedTree(liveTree.reactDetected ? [] : [NO_REACT_WARNING], liveTree, preferredEngine);
  }

  function resolveSnapshot(snapshotId, createIfMissing = true, preferredEngine) {
    if (snapshotId) {
      const indexedEngine = state.snapshotIndex.get(snapshotId);
      const indexedStore = indexedEngine ? getSnapshotStore(indexedEngine) : null;
      return indexedStore?.snapshots.get(snapshotId) || createRuntimeError(
        "snapshot-expired",
        "Snapshot \"" + snapshotId + "\" is no longer available. Run rdt tree get --session <name> again to collect a fresh snapshot.",
        { snapshotId },
      );
    }

    const selectedEngine = getSelectedEngine(preferredEngine);
    const store = getSnapshotStore(selectedEngine);
    if (store.latestSnapshotId) {
      return store.snapshots.get(store.latestSnapshotId) || null;
    }

    if (!createIfMissing) {
      return null;
    }

    const snapshot = collectTree(preferredEngine);
    if (!snapshot.reactDetected || !snapshot.snapshotId) {
      return null;
    }

    const indexedEngine = state.snapshotIndex.get(snapshot.snapshotId);
    const indexedStore = indexedEngine ? getSnapshotStore(indexedEngine) : null;
    return indexedStore?.snapshots.get(snapshot.snapshotId) || null;
  }

  function getProfilerCommit(commitId) {
    return state.profiler.events.find((event) => event.eventType === COMMIT && event.commitId === commitId) || null;
  }

  function inspectNode(nodeId, snapshotId, commitId, preferredEngine) {
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
        ...(commit.engineMeta || buildResolvedEngineMetadata(
          preferredEngine || commit.enginePreference,
          commit.selectedEngine || commit.engine,
        )),
        ...details,
        commitId,
        profiler: commit.nodeAnalysisById[nodeId] || null,
        metrics: commit.nodeMetricsById[nodeId] || null,
      };
    }

    const snapshot = resolveSnapshot(snapshotId, true, preferredEngine);
    if (snapshot?.__rdtError) {
      return snapshot;
    }

    const details = snapshot?.nodeDetails.get(nodeId);
    if (!snapshot || !details) {
      return null;
    }

    return details;
  }

  function searchNodes(query, snapshotId, preferredEngine, structured) {
    const snapshot = resolveSnapshot(snapshotId, true, preferredEngine);
    if (snapshot?.__rdtError) {
      return snapshot;
    }

    if (!snapshot) {
      return structured
        ? {
            items: [],
            query: String(query || ""),
            snapshotId: null,
            matchCount: 0,
            runtimeWarnings: [],
          }
        : [];
    }

    const lower = String(query || "").toLowerCase();
    const items = snapshot.nodes.filter((node) => {
      return String(node.displayName || "").toLowerCase().includes(lower);
    }).map((node) => ({
      ...node,
      snapshotId: snapshot.snapshotId,
      engine: snapshot.selectedEngine || buildEngineMetadata(preferredEngine).selectedEngine,
    }));

    if (!structured) {
      return items;
    }

    const runtimeWarnings = items.length === 0
      ? [
          `No matches were found in snapshot "${snapshot.snapshotId}". The component may exist in the app but not be rendered in the current UI state.`,
          "Do not treat a zero-match snapshot search as proof that the component is absent from the codebase.",
        ]
      : [];

    return {
      items,
      query: String(query || ""),
      snapshotId: snapshot.snapshotId,
      matchCount: items.length,
      runtimeWarnings,
    };
  }

  function revealSource(nodeId, snapshotId, commitId, preferredEngine, structured) {
    const details = inspectNode(nodeId, snapshotId, commitId, preferredEngine);
    if (details?.__rdtError) {
      return details;
    }

    if (!details) {
      return createRuntimeError(
        "node-not-found",
        `Node "${nodeId}" is not available in the current snapshot or commit context.`,
        {
          nodeId,
          snapshotId: snapshotId || null,
          commitId: commitId || null,
        },
      );
    }

    if (!structured) {
      return details.source;
    }

    const sourceCapability = getSourceCapability(details);
    return {
      status: details.source ? "available" : "unavailable",
      available: Boolean(details.source),
      mode: sourceCapability.mode,
      reason: sourceCapability.reason,
      rendererVersions: sourceCapability.rendererVersions,
      snapshotId: details.snapshotId || snapshotId || null,
      nodeId,
      source: details.source || null,
    };
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

  function highlightNode(nodeId, snapshotId, preferredEngine) {
    const details = inspectNode(nodeId, snapshotId, null, preferredEngine);
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

  function pickNode(timeoutMs, preferredEngine) {
    return new Promise((resolve) => {
      const snapshot = collectTree(preferredEngine);
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

        highlightNode(getFiberId(fiber), snapshotId, preferredEngine);
      }

      function handleClick(event) {
        event.preventDefault();
        event.stopPropagation();
        const fiber = resolveFiberFromElement(event.target);
        if (!fiber) {
          cleanup(null);
          return;
        }

        cleanup(inspectNode(getFiberId(fiber), snapshotId, null, preferredEngine));
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
    const commitRecommendations = getProfileCommitRecommendations(commitEvents);

    const measurementMode = measurementModes.length === 1 ? measurementModes[0] : MIXED;
    const measuresComponentDuration = hasDurationMetrics(measurementMode);
    const engineMeta = buildResolvedEngineMetadata(state.profiler.enginePreference, state.profiler.selectedEngine);
    const runtimeWarnings = state.profiler.active ? [] : [PROFILER_FOLLOWUP_WARNING];
    if (commitRecommendations.commitClassifications.some((entry) => entry.isLikelyInitialMount)) {
      runtimeWarnings.push(INITIAL_MOUNT_WARNING);
    }
    return {
      ...engineMeta,
      observationLevel: OBSERVED,
      limitations: getProfilerLimitations(measurementMode),
      runtimeWarnings,
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
      primaryUpdateCommitId: commitRecommendations.primaryUpdateCommitId,
      recommendedCommitIds: commitRecommendations.recommendedCommitIds,
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
    const summary = summarizeProfiler();
    return {
      profileId: state.profiler.profileId,
      enginePreference: state.profiler.enginePreference,
      selectedEngine: state.profiler.selectedEngine,
      engine: summary.selectedEngine || state.profiler.selectedEngine || ENGINE_CUSTOM,
      measurementSource: summary.measurementSource || null,
      summary,
      events: state.profiler.events.slice(),
    };
  }

  function storeProfilerRecord(record) {
    if (!record?.profileId) {
      return;
    }

    const selectedEngine = record.selectedEngine || record.summary?.selectedEngine || ENGINE_CUSTOM;
    const store = getProfilerStore(selectedEngine);
    store.set(record.profileId, record);
    state.profiler.profileIndex.set(record.profileId, selectedEngine);
    pruneProfiles(selectedEngine);
  }

  function getStoredProfilerRecord(profileId) {
    if (profileId && profileId === state.profiler.profileId) {
      return getCurrentProfilerRecord();
    }

    const indexedEngine = state.profiler.profileIndex.get(profileId);
    if (!indexedEngine) {
      return null;
    }

    return getProfilerStore(indexedEngine).get(profileId) || null;
  }

  function doctor(preferredEngine) {
    const tree = peekTree(preferredEngine);
    const liveTree = tree.reactDetected ? collectLiveTree(preferredEngine) : null;
    const engineMeta = buildEngineMetadata(preferredEngine);
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
        ...engineMeta,
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
    let sourceCapability = {
      status: "failed",
      mode: "unverified",
      available: false,
      rendererVersions: getRendererVersions(),
      reason: "No inspected node was available for source capability checks",
    };
    if (firstNode) {
      const details = inspectNode(firstNode.id, snapshot.snapshotId);
      sourceCapability = getSourceCapability(details);
      checks.inspect = {
        status: details ? "ok" : "failed",
        nodeId: firstNode.id,
      };
      checks.sourceReveal = {
        status: sourceCapability.status,
        available: sourceCapability.available,
      };
      if (!sourceCapability.available) {
        runtimeWarnings.push(sourceCapability.reason);
      }
    }

    runtimeWarnings.push(
      hasDurationMetrics(liveMeasurementMode)
        ? PROFILER_SOURCE_WARNING
        : PROFILER_STRUCTURAL_WARNING,
    );

    return {
      ...engineMeta,
      status: runtimeWarnings.length ? "partial" : "ok",
      observationLevel: OBSERVED,
      limitations: commonLimitations.snapshot.concat(commonLimitations.inspect, getProfilerLimitations(liveMeasurementMode)),
      runtimeWarnings,
      checks,
      sourceCapability,
      recommendedWorkflow: [
        "run tree get to capture a snapshotId",
        "reuse snapshotId for node search, inspect, highlight, and source reveal",
        "start profiler before reproducing an interaction",
        "prefer primaryUpdateCommitId or recommendedCommitIds over blindly trusting commit-1",
        "use profiler commits, commit, ranked, and flamegraph for hotspot analysis",
      ],
      recommendedProfilerWorkflow: [
        "start profiler",
        "reproduce exactly one interaction",
        "stop profiler",
        "inspect primaryUpdateCommitId before drilling into commit-1",
        "use profiler commits only when no update candidate is available",
      ],
      recommendedCommitSelection: [
        "prefer commits where commitKind is update",
        "treat initial-mount commits as setup noise unless no update commit exists",
        "treat mixed commits as secondary follow-up candidates",
      ],
      unsafeConclusions: [
        "all matching nodes rerendered solely because they appear in the tree",
        "component-level timing is available when measurementMode is structural-only",
        "engine selection should change solely because _debugSource is unavailable",
      ],
    };
  }

  function flattenReasons(observedReasons, inferredReasons) {
    return [...(observedReasons || []), ...(inferredReasons || [])];
  }

  function getReasonConfidence(observedReasons, inferredReasons, matchingConfidence) {
    if ((observedReasons || []).length > 0) {
      return matchingConfidence === "high" ? "high" : "medium";
    }

    if ((inferredReasons || []).length > 0) {
      return matchingConfidence === "high" ? "medium" : "low";
    }

    return "low";
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
      const observedReasons = [];
      const inferredReasons = [];
      const changedPropKeys = [];
      const changedHookIndexes = [];
      const changedContextNames = [];
      const matchingConfidence = previousEntry ? "high" : "medium";

      if (!previousEntry) {
        observedReasons.push("mount");
        mountedNodeIds.push(nodeId);
        reasonCounts.mount += 1;
      } else {
        const previousDetails = previousEntry.details;
        const propDiffs = getTopLevelDiffKeys(previousDetails?.props, currentDetails?.props);
        if (propDiffs.length) {
          observedReasons.push("props-changed");
          changedPropKeys.push(...propDiffs);
          reasonCounts["props-changed"] += 1;
          for (const key of propDiffs) {
            propCounts[key] = (propCounts[key] || 0) + 1;
          }
        }

        if (stableStringify(previousDetails?.state) !== stableStringify(currentDetails?.state)) {
          observedReasons.push("state-changed");
          reasonCounts["state-changed"] += 1;
        }

        const hookDiffs = getChangedHookIndexes(previousDetails?.hooks, currentDetails?.hooks);
        if (hookDiffs.length) {
          observedReasons.push("hooks-changed");
          changedHookIndexes.push(...hookDiffs);
          reasonCounts["hooks-changed"] += 1;
          for (const index of hookDiffs) {
            hookCounts[index] = (hookCounts[index] || 0) + 1;
          }
        }

        const contextDiffs = getChangedContextNames(previousDetails?.context, currentDetails?.context);
        if (contextDiffs.length) {
          observedReasons.push("context-changed");
          changedContextNames.push(...contextDiffs);
          reasonCounts["context-changed"] += 1;
          for (const name of contextDiffs) {
            contextCounts[name] = (contextCounts[name] || 0) + 1;
          }
        }
      }

      const rerenderReasons = flattenReasons(observedReasons, inferredReasons);
      const changed = rerenderReasons.length > 0;
      if (changed) {
        changedNodeIds.push(nodeId);
      }

      analysisById[nodeId] = {
        commitId: currentCommit.commitId,
        nodeId,
        changed,
        rerenderReasons,
        observedReasons,
        inferredReasons,
        reasonConfidence: getReasonConfidence(observedReasons, inferredReasons, matchingConfidence),
        changedPropKeys,
        changedHookIndexes,
        changedContextNames,
        matchingConfidence,
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
      if (!analysis || analysis.observedReasons.length > 0 || !node.parentId) {
        continue;
      }

      let ancestorId = node.parentId;
      while (ancestorId) {
        if (changedNodeSet.has(ancestorId)) {
          analysis.inferredReasons.push("parent-render");
          analysis.rerenderReasons = flattenReasons(analysis.observedReasons, analysis.inferredReasons);
          analysis.reasonConfidence = getReasonConfidence(
            analysis.observedReasons,
            analysis.inferredReasons,
            analysis.matchingConfidence,
          );
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
    const engineMeta = buildResolvedEngineMetadata(state.profiler.enginePreference, state.profiler.selectedEngine);

    return {
      engine: engineMeta.selectedEngine,
      engineMeta,
      enginePreference: state.profiler.enginePreference,
      selectedEngine: engineMeta.selectedEngine,
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

  function classifyCommit(commit) {
    const counts = commit?.reasonCounts || {};
    const mounts = counts.mount || 0;
    const unmounts = counts.unmount || 0;
    const updateSignals = (counts["props-changed"] || 0)
      + (counts["state-changed"] || 0)
      + (counts["hooks-changed"] || 0)
      + (counts["context-changed"] || 0)
      + (counts["parent-render"] || 0);
    const isLikelyInitialMount = mounts > 0 && unmounts === 0 && updateSignals === 0;
    let commitKind = "mixed";
    if (isLikelyInitialMount) {
      commitKind = "initial-mount";
    } else if (updateSignals > 0) {
      commitKind = "update";
    }

    return {
      commitKind,
      isLikelyInitialMount,
      isInteractionCandidate: commitKind === "update" || (commitKind === "mixed" && updateSignals > 0),
    };
  }

  function getProfileCommitRecommendations(commitEvents) {
    const commitClassifications = commitEvents.map((commit) => ({
      commitId: commit.commitId,
      changedNodeCount: commit.changedNodeIds.length,
      ...classifyCommit(commit),
    }));
    const recommendedCommitIds = commitClassifications
      .filter((entry) => entry.isInteractionCandidate && entry.changedNodeCount > 0)
      .map((entry) => entry.commitId);

    return {
      primaryUpdateCommitId: recommendedCommitIds.length ? recommendedCommitIds[recommendedCommitIds.length - 1] : null,
      recommendedCommitIds,
      commitClassifications,
    };
  }

  function getCommitSummary(commit) {
    const changedNodeCount = commit.changedNodeIds.length;
    const commitClassification = classifyCommit(commit);
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
      ...commitClassification,
    };
  }

  function listProfilerCommits() {
    return getCommitEvents()
      .map((commit) => ({
        ...(commit.engineMeta || buildResolvedEngineMetadata(commit.enginePreference, commit.selectedEngine || commit.engine)),
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
      const analysis = commit.nodeAnalysisById[nodeId] || {};
      return {
        id: nodeId,
        displayName: node?.displayName || null,
        depth: node?.depth ?? null,
        reasons: analysis.rerenderReasons || [],
        observedReasons: analysis.observedReasons || [],
        inferredReasons: analysis.inferredReasons || [],
        reasonConfidence: analysis.reasonConfidence || "low",
        changedPropKeys: analysis.changedPropKeys || [],
        changedHookIndexes: analysis.changedHookIndexes || [],
        changedContextNames: analysis.changedContextNames || [],
        metrics: commit.nodeMetricsById[nodeId] || null,
        changedDescendantCount: commit.changedDescendantCounts[nodeId] || 0,
      };
    });

    return {
      ...(commit.engineMeta || buildResolvedEngineMetadata(commit.enginePreference, commit.selectedEngine || commit.engine)),
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
        observedReasons: analysis.observedReasons || [],
        inferredReasons: analysis.inferredReasons || [],
        reasonConfidence: analysis.reasonConfidence || "low",
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
      ...(commit.engineMeta || buildResolvedEngineMetadata(commit.enginePreference, commit.selectedEngine || commit.engine)),
      ...getCommitObservation(measurementMode, COMMIT_RANKING_WARNING, [
        RANKING_FALLBACK_LIMITATION,
        SNAPSHOT_DIFF_LIMITATION,
      ]),
      commitId,
      measurementMode,
      ...classifyCommit(commit),
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
      observedReasons: analysis.observedReasons || [],
      inferredReasons: analysis.inferredReasons || [],
      reasonConfidence: analysis.reasonConfidence || "low",
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
      ...(commit.engineMeta || buildResolvedEngineMetadata(commit.enginePreference, commit.selectedEngine || commit.engine)),
      ...getCommitObservation(getCommitMeasurementMode(commit), COMMIT_FLAMEGRAPH_WARNING, [
        FLAMEGRAPH_FALLBACK_LIMITATION,
        SNAPSHOT_DIFF_LIMITATION,
      ]),
      commitId,
      measurementMode: getCommitMeasurementMode(commit),
      ...classifyCommit(commit),
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

    const liveTree = collectLiveTree(state.profiler.enginePreference);
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
    getEngineInfo(preferredEngine) {
      return buildEngineMetadata(preferredEngine);
    },
    collectTree,
    peekTree,
    inspectNode,
    searchNodes,
    highlightNode,
    pickNode,
    startProfiler(profileId, preferredEngine) {
      state.profiler.active = true;
      state.profiler.profileId = profileId;
      state.profiler.enginePreference = normalizeEnginePreference(preferredEngine);
      state.profiler.selectedEngine = getSelectedEngine(preferredEngine);
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
    treeStats,
    revealSource,
    doctor,
  };
}

export function createRuntimeScript() {
  return `(${runtimeBootstrap.toString()})();`;
}
