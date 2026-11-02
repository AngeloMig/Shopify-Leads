# Scout task workspace

Automation Jobs shows real discovery and audit execution using the hierarchy Scout → stage → individual task → available result. The horizontal run chooser leaves the workspace available for the network and inspector. Audit branches are Verify storefront, Measure performance, Review pages and Build report; discovery uses its corresponding configuration, search, verification and queue stages.

## Recording and history

The worker records stable task IDs, stage parents, task names, lifecycle states, timestamps, public resource URLs and bounded facts in `payload.work.events`. IDs include the job, execution attempt, stage and operation key. PageSpeed keys include strategy/sample; page keys include the requested URL. Retried job attempts remain inspectable separately. Concurrent emissions are serialized before the ownership-fenced write, so one callback cannot overwrite another's event.

Configuration, storefront connection/response/identification and optional country-page reads, search responses, each PageSpeed request/result/reused checkpoint, representative/contact page reads, browser diagnostics, recommendations, PDF rendering and storage publication are recorded around existing operations. Failure recording runs before the worker releases its lease. No additional provider requests are added for visualization.

The previous 80-event trimming has been removed for new activity. The full retained history is returned by the workspace-owned activity endpoint; the feed initially displays 100 matching updates and can load earlier updates. Previously discarded events cannot be recovered. Old runs use the available stage/sample/page events; missing completions are shown as Recorded or Interrupted, never invented. Optional task skips do not mark the entire stage skipped.

`finalize_audit` atomically finishes the job and creates its report link, releasing the worker lease. Publication activity therefore records the successful storage upload **before** this transaction. Nothing attempts a fenced activity write after finalization. A specific finalization task starts before the transaction; the owned activity endpoint derives its stable completion event only when the durable completed-job state and the matching owned report record both exist. This makes finalization failure inspectable without writing after lease release, and the completion remains reproducible across reconnects.

## Reading and interacting

The current-work banner shows the latest active task, its resource, attempt and elapsed time when available. All working branches expand automatically. Stage positions and task insertion order remain stable during updates. Completed tasks stay in their branch's scrollable history, which can expand for more room. A luminous Three.js core connects to stages with curved SVG pathways; stage spines connect task nodes to result controls.

Selecting a node with pointer or keyboard opens its task inspector and related activity. The inspector includes timing, resource, sample/attempt, latest update, measurements, available page findings and completion/error details. Selecting an activity entry highlights the corresponding task. All, Running, Completed and Issues filter the recorded activity; Show all activity restores the full history. Follow live activity returns selection to current work; manual inspection remains pinned as newer updates arrive. Following scrolls within the task branch, without moving the whole page.

States include Waiting, Starting, Running, Waiting for response, Completed, Retrying, Failed, Skipped, Recorded and Interrupted. Mint indicates completion/activity, amber retry and coral failure, with explicit text and icons. A dispatch signal is emitted only for a newly observed task start, and a return signal for a newly observed result. Task spines show their corresponding event signal. A compact result notice appears briefly after a return, with results retained on the task. Previously loaded history does not replay signals. The task map has no ambient worker activity. The Neural model separately offers opt-in Animate model and Send visual pulse controls, labeled Model exploration · no job is started. Cyan exploratory signals remain distinct from mint/white task dispatch and returned-result signals.

Pause animation freezes motion without pausing the worker, detail refresh or activity feed. Small screens use the accessible 2D stage/task list. Reduced motion uses the same 2D core treatment without motion; 2D remains available on desktop. The default desktop Neural model restores the dense 196-neuron Three.js mesh with glowing synapses, direct neuron/region picking, hover highlights, drag-to-orbit, rotate/zoom/reset controls and labeled stage regions. Clicking a 3D region selects an actual task in its stage and synchronizes the inspector/feed; pending stages show their own empty state. Actual task events produce bounded traveling signals through their region. Optional exploration continues after a run finishes, with explicit visual-only labeling and no provider calls. The Task map tab retains the complete stage/task/result hierarchy, with a smaller 3D core and restrained perspective; it is the default on small screens or with reduced motion. Hidden/offscreen views stop motion; the core targets 30 frames per second with DPR capped at 1.5. Rendering is schematic execution state, not model reasoning. The lazy 3D core is approximately 249 kB compressed; target-device frame rates have not been exhaustively profiled.

## Connection and completion

The owned `/api/jobs/:id/activity` route returns `Cache-Control: no-store`. Running jobs poll every three seconds, queued jobs every twelve seconds, and terminal jobs stop polling. Last successful receipt time appears in Philippine time, alongside worker/connection status. Errors retain the last snapshot and offer Retry updates. Worker offline and disconnected updates are distinct from a task waiting for its provider. The view uses recorded counts rather than estimated progress percentages.

Completion settles into a recorded overview with task, measurement and returned finding counts. Open finished report uses the selected report's existing authenticated download endpoint and private signed URL. Report errors have their own retry action. Historical evidence remains available in Pages & signals; the endpoint's page/finding lists are bounded, so counts describe records returned rather than guaranteed audit-wide totals.

## Previews and verification

Preview discovery and Preview audit use fictional `.example` resources and clearly labeled sample measurements, entirely in the browser. Pause/Play, Next event and Restart/Replay allow step inspection. The audit preview explicitly returns each of six measurements, representative page results and report steps; it never synthesizes unseen sample results. Preview links/report downloads are disabled. It creates no job, lead or provider request and changes no budgets.

Automated coverage includes task identity/concurrency, lifecycle results, interrupted attempts, retained history, malformed metadata, no fabricated measurements, ownership fencing, and representative-page callbacks. Browser verification covers keyboard node selection, pinned history during incoming updates, synchronized filters/feed selection, visual pause while statuses update, desktop 2D/3D and mobile layout. Real provider execution is not required to exercise the preview.


## Semantic neural paths

The desktop model now has two separate layers: a subdued 196-neuron context mesh and a foreground execution graph. Foreground nodes represent Scout, stage hubs, individual stable worker task IDs, result endpoints, and collapsed history clusters. Background neurons do not pretend to be tasks or accept task clicks. Primary links use approximately 2 px screen-space lines, task branches 1.3 px, and result links 1 px; a selected route brightens while unrelated links recede.

`neural-task-graph.ts` builds stable positions from each task's insertion order within the complete stage history. Overview, Stage focus and Task focus change detail without changing those positions. The first cluster expansion reveals up to 24 task nodes; larger histories can open the full task-map list. The native task selector always exposes all retained tasks, including tasks currently grouped in the 3D view.

Each connection stores source/destination IDs and sampled curved geometry. Both visible Three.js Line2 links and traveling signals use those exact samples. Dispatch stops at the task; a result travels from its result endpoint back through the task and stage to Scout. Legacy events without task metadata can only signal their known stage. No arbitrary background neuron is presented as the destination of a worker result. Signal trails are bounded and targets remain inspectable after animation settles.

Stage labels, selected/running/problem task labels and selected results project from their actual 3D anchors into upright HTML. Leader lines attach labels to nodes. A priority-based collision layout uses measured label heights, keeps labels within the viewport and suppresses low-priority collisions. It runs during demand-rendered camera/motion frames without React state updates per frame. Labels and the native selector supply keyboard equivalents for 3D picking. Direct task or result clicks synchronize the inspector and related feed; dragging preserves pinned selection. Hovering/clicking a visible link identifies its source/destination and opens the appropriate stage/task.

Returned PageSpeed values appear prominently near the top of the task inspector, before timing/history, with Lighthouse score bands and explicit unavailable values. Optional exploration remains labeled separately from worker signals, and both types of signal follow the same visible curves. Mobile and reduced-motion task-map fallbacks are retained. Tests cover graph identity, hierarchy, stable positions, preserved grouped history, signal/visible-path equality and collision layout.

### Neural observatory motion

- **Explore motion** starts a clearly labeled visual exploration over recorded task routes, without provider requests. Stop motion ends continuous signals and tissue sweeps.
- **Trace a pulse** runs a bounded cyan route preview and a wave through the visual tissue. Selecting a task also gives brief route feedback.
- **Auto orbit** is opt-in and independent from signal exploration; dragging temporarily takes over the camera. Selection stays pinned while orbiting.
- **Neural tissue** hides the contextual brain mesh while preserving semantic task nodes, connections, labels and evidence.
- The tissue uses two bounded shader draws, not a post-processing bloom pass. Live mint-white signals and cyan visual previews use separate per-instance colors, even when displayed together. Existing reduced-motion, offscreen, hidden-tab and pause controls remain in force.

### Task flow board

The Task map is a responsive workflow board (`TaskFlowMap.tsx`), independent of the Three.js renderer. It exposes every retained task through search, state filters and progressive stage expansion. Pinned and currently active tasks remain visible beyond a stage's initial two-row preview, while filters are respected. A selected task outside a filter is identified with a clear-filter action. Following live activity scrolls only the board viewport when needed, leaving the page position alone.

Stage connections use measured DOM anchors and recalculate with ResizeObserver. Live signals follow those visible paths and result arrivals briefly highlight their real task row. Preview flow starts no backend work and uses cyan signals. Selecting a task traces its recorded stage and synchronizes the existing inspector/feed. All animation stops while paused, offscreen or hidden; reduced motion keeps the board static. Desktop groups use two columns; compact layouts use one column and an outer connection rail.
