// ShowTrak Flow UI.
//
// Layout: Scenes are the body of the show and ALWAYS occupy the main
// application area (#APPLICATION_CONTENT). The Queue, Flows and Show Settings
// managers live in the left slide-out sidebar panels (#APP_SIDE_MENU); opening a
// panel only changes the sidebar — the Scenes view never changes.
//
// Classic script sharing global scope — wrapped in an IIFE. Reuses the global
// AppMode, Notify and ConfirmationDialog helpers, plus the existing sidebar
// open/close behaviour driven by .app-side-icon-btn in 14-selection-init.js.
(function ShowFlowUI() {
  'use strict';

  const State = {
    flowID: null, // when set, the Flows panel drills into a flow's groups
  };
  let FlowsCache = [];
  let FlagsCache = [];
  let RemoteUsersCache = [];
  let ShowColoursCache = [];
  let ChatRoomsCache = [];
  let ActiveChatRoomKey = null;
  let ChatViewMode = 'list';
  let ChatMessagesByRoom = {};
  let ScenesCache = [];
  let QueueCache = [];
  let FlowGroupsCache = [];
  const AcknowledgedNotes = new Set();
  let OpenSceneNotesGroupID = null;

  // ---- Helpers ----
  function Esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function IsEditMode() {
    return String(typeof AppMode !== 'undefined' ? AppMode : 'SHOW').toUpperCase() === 'EDIT';
  }

  function ToastError(Err) {
    const Message = Err && Err.message ? Err.message : String(Err || 'Something went wrong');
    if (typeof Notify === 'function') Notify(Message, 'error');
  }

  function FormatDuration(Seconds) {
    if (Seconds == null || Seconds === '') return '';
    const total = Math.max(0, Math.round(Number(Seconds)));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // Parse "MM:SS" or a plain seconds value. Returns null for empty, NaN if bad.
  function ParseTimeInput(value) {
    const str = String(value == null ? '' : value).trim();
    if (!str) return null;
    if (/^\d+$/.test(str)) return parseInt(str, 10);
    const m = /^(\d+):([0-5]?\d)$/.exec(str);
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    return NaN;
  }

  function FormatNoteTime(ts) {
    try {
      return new Date(Number(ts)).toLocaleString([], {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: 'short',
      });
    } catch {
      return '';
    }
  }

  function DefaultShowColour() {
    if (Array.isArray(ShowColoursCache) && ShowColoursCache.length) {
      return ShowColoursCache[0].Colour;
    }
    return '#5B8DEF';
  }

  function BuildShowColourOptionsHTML(selectedColour) {
    const selected = String(selectedColour || '').trim().toUpperCase();
    const options = Array.isArray(ShowColoursCache) ? ShowColoursCache.slice() : [];
    const hasSelected = selected && options.some((c) => String(c.Colour || '').toUpperCase() === selected);
    const merged = hasSelected
      ? options
      : selected
        ? [{ ShowColourID: 'legacy', Label: `Current (${selected})`, Colour: selected }, ...options]
        : options;
    return merged
      .map((c) => {
        const value = String(c.Colour || '').toUpperCase();
        const selectedAttr = selected === value || (!selected && value === DefaultShowColour()) ? 'selected' : '';
        return `<option value="${Esc(value)}" ${selectedAttr}>${Esc(c.Label || value)} · ${Esc(value)}</option>`;
      })
      .join('');
  }

  // Generic HTML5 drag-and-drop reorder. Items carry draggable + data-id.
  //
  // Uses a CONTAINER-level dragover that computes the insertion point from the
  // cursor's Y position relative to each sibling's midpoint. This avoids the
  // "feels like swapping" problem of item-level dragover handlers, where the
  // dragged element jumps under the cursor and swallows subsequent events, and
  // it also lets you drop in the gaps between rows or below the last row.
  function EnableDragReorder($container, itemSelector, onReorder, options) {
    const container = $container.get(0);
    if (!container) return;
    const opts = options || {};
    let dragEl = null;
    let dragStartOrigin = null;

    $container.off('.dragreorder');

    // Track where the drag gesture began so handle checks can use the
    // original click target instead of dragstart's retargeted element.
    $container.on('mousedown.dragreorder', itemSelector, function (e) {
      dragStartOrigin = e.target;
    });

    // Find the element the dragged row should be inserted BEFORE, based on the
    // cursor Y. Returns null when the cursor is past the last item (append).
    function getInsertBeforeEl(clientY) {
      const items = Array.from(container.querySelectorAll(itemSelector)).filter(
        (el) => el !== dragEl
      );
      for (const el of items) {
        const rect = el.getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) return el;
      }
      return null;
    }

    $container.on('dragstart.dragreorder', itemSelector, function (e) {
      const origin = dragStartOrigin || e.target;
      if (opts.ignoreFromSelector && $(origin).closest(opts.ignoreFromSelector).length) {
        e.preventDefault();
        return;
      }
      if (opts.handleSelector && !$(origin).closest(opts.handleSelector).length) {
        e.preventDefault();
        return;
      }
      dragEl = this;
      this.classList.add('dragging');
      try {
        e.originalEvent.dataTransfer.effectAllowed = 'move';
        e.originalEvent.dataTransfer.setData('text/plain', String($(this).data('id')));
      } catch {
        /* setData required on some platforms; ignore failures */
      }
    });

    $container.on('dragend.dragreorder', itemSelector, function () {
      this.classList.remove('dragging');
      dragEl = null;
      dragStartOrigin = null;
    });

    // Container-level dragover so movement is tracked even when the cursor is
    // over the dragged element, between rows, or in the container's padding.
    $container.on('dragover.dragreorder', function (e) {
      e.preventDefault();
      if (!dragEl) return;
      try {
        e.originalEvent.dataTransfer.dropEffect = 'move';
      } catch {
        /* not all platforms expose dropEffect; non-critical */
      }
      const beforeEl = getInsertBeforeEl(e.originalEvent.clientY);
      if (beforeEl === dragEl) return;
      if (beforeEl) container.insertBefore(dragEl, beforeEl);
      else container.appendChild(dragEl);
    });

    $container.on('drop.dragreorder', function (e) {
      e.preventDefault();
      if (!dragEl) return;
      const ids = Array.from(container.querySelectorAll(itemSelector)).map((el) =>
        $(el).data('id')
      );
      dragStartOrigin = null;
      if (typeof onReorder === 'function') onReorder(ids);
    });
  }

  // ---- Render targets ----
  const MainRoot = () => document.getElementById('APPLICATION_CONTENT');
  const QueuePanel = () => document.getElementById('SF_PANEL_QUEUE');
  const FlowsPanel = () => document.getElementById('SF_PANEL_FLOWS');
  const ChatPanel = () => document.getElementById('SF_PANEL_CHAT');
  const SettingsPanel = () => document.getElementById('SF_PANEL_SETTINGS');

  function RenderAll() {
    RenderScenes();
    RenderQueuePanel();
    RenderFlowsPanel();
    RenderChatPanel();
    RenderSettingsPanel();
  }

  function ChatRoomKey(roomType, roomID) {
    return `${String(roomType || '').toUpperCase()}:${Number(roomID)}`;
  }

  // ============================================================
  // SCENES (main application area)
  // ============================================================
  function GroupsForScene(sceneID) {
    return QueueCache.filter((g) => g.Location === 'SCENE' && Number(g.SceneID) === Number(sceneID));
  }

  function MilestoneMarkersHTML(scene) {
    const ms = Array.isArray(scene.Milestones) ? scene.Milestones : [];
    if (!ms.length) return '';
    const duration = Number(scene.Duration);
    if (!Number.isFinite(duration) || duration <= 0) return '';
    return ms
      .map((m) => {
        const pct = Math.max(0, Math.min(100, (Number(m.Offset) / duration) * 100));
        const tip = `${m.Label ? Esc(m.Label) + ' · ' : ''}${Esc(FormatDuration(m.Offset))}`;
        return `<span class="sf-milestone" style="left:${pct}%;background:${Esc(m.Colour)}" title="${tip}"></span>`;
      })
      .join('');
  }

  function MilestoneChipsHTML(scene) {
    const ms = Array.isArray(scene.Milestones) ? scene.Milestones : [];
    if (!ms.length) return '';
    return `<div class="sf-scene-milestone-chips">${ms
      .map(
        (m) =>
          `<span class="sf-milestone-chip"><span class="sf-milestone-dot" style="background:${Esc(m.Colour)}"></span>${Esc(m.Label || 'Milestone')}</span>`
      )
      .join('')}</div>`;
  }

  function SceneGroupChipHTML(group, sceneID) {
    const colour = group.Colour || '#5b8def';
    const timeLabel = group.Time ? Esc(group.Time) : '--:--';
    const flags = Array.isArray(group.Flags) ? group.Flags : [];
    const notes = Array.isArray(group.Notes) ? group.Notes : [];
    const flagIcons = flags
      .map(
        (f) =>
          `<i class="bi bi-${Esc(f.Icon)}" style="color:${Esc(f.Colour || '#F4C453')}" title="${Esc(f.Label)}${f.Comment ? ': ' + Esc(f.Comment) : ''}"></i>`
      )
      .join('');
    const hasUnread = notes.length > 0 && !AcknowledgedNotes.has(Number(group.InstanceID));
    const chat = notes.length
      ? `<button type="button" class="sf-sg-chat${hasUnread ? ' has-unread' : ''}" title="${notes.length} note(s)">
          <i class="bi bi-chat-left-text-fill"></i> ${notes.length}
          <span class="sf-sg-notes">${notes
            .map(
              (n) =>
                `<div class="sf-sg-note">${Esc(n.Message)}<div class="sf-sg-note-meta">${Esc(FormatNoteTime(n.Timestamp))}</div></div>`
            )
            .join('')}</span>
        </button>`
      : '';
    return `
      <div class="sf-scene-group" data-id="${group.InstanceID}" data-scene-id="${sceneID}" draggable="${IsEditMode() ? 'true' : 'false'}" style="--g-colour:${Esc(colour)}">
        <span class="sf-sg-main">
          <span class="sf-sg-time">${timeLabel}</span>
          <span class="sf-sg-label">${Esc(group.Label)}</span>
        </span>
        ${flagIcons ? `<span class="sf-sg-flags">${flagIcons}</span>` : ''}
        ${chat}
        <span class="sf-sg-actions">
          <button type="button" class="sf-icon-btn sf-sg-edit" title="Group settings"><i class="bi bi-pencil-fill"></i></button>
        </span>
      </div>`;
  }

  function SceneCardHTML(scene) {
    const groups = GroupsForScene(scene.SceneID);
    const groupsHTML = groups.length
      ? groups.map((g) => SceneGroupChipHTML(g, scene.SceneID)).join('')
      : '<div class="sf-scene-empty-slot">No Group</div>';
    const draggable = IsEditMode() ? 'true' : 'false';
    const activeClass = groups.length ? ' sf-scene-active' : '';
    const hasSceneChat = !!scene.HasChatRoom;
    const sceneDuration = Number(scene.Duration);
    const hasDuration = Number.isFinite(sceneDuration) && sceneDuration > 0;
    return `
      <div class="sf-scene-card${activeClass}" data-id="${scene.SceneID}" draggable="${draggable}">
        <div class="sf-scene-left">
          <span class="sf-drag-handle sf-edit-only" title="Drag to reorder"><i class="bi bi-grip-vertical"></i></span>
          <div class="sf-scene-headings">
            <div class="sf-scene-label">
              <span class="sf-scene-icon-badge" style="--scene-colour:${Esc(scene.Colour || '#1E88E5')}">
                <i class="bi bi-${Esc(scene.Icon || 'chat-left-text-fill')}"></i>
              </span>
              ${Esc(scene.Label)}
            </div>
          </div>
          ${
            hasDuration
              ? `<div class="sf-scene-track-wrap" style="flex:1;min-width:0;">
            <div class="sf-scene-track">
              <div class="sf-scene-fill" data-scene-fill="${scene.SceneID}" style="width:0%"></div>
              ${MilestoneMarkersHTML(scene)}
            </div>
            <div class="sf-scene-duration">${Esc(FormatDuration(sceneDuration))}</div>
            ${MilestoneChipsHTML(scene)}
          </div>`
              : ''
          }
        </div>
        <div class="sf-scene-groups" data-scene-id="${scene.SceneID}">${groupsHTML}</div>
        <div class="sf-scene-actions">
          ${
            hasSceneChat
              ? `<button type="button" class="sf-icon-btn sf-show-only sf-show-in-edit sf-scene-chat" data-scene-id="${scene.SceneID}" title="Open scene chat"><i class="bi bi-chat-left-text"></i></button>`
              : ''
          }
          <button type="button" class="sf-icon-btn sf-show-only sf-show-in-edit sf-scene-start" data-id="${scene.SceneID}" title="Start scene"><i class="bi bi-play-fill"></i></button>
          <button type="button" class="sf-icon-btn sf-edit-only sf-scene-duplicate" data-id="${scene.SceneID}" title="Duplicate scene"><i class="bi bi-copy"></i></button>
          <button type="button" class="sf-icon-btn sf-edit-only sf-scene-edit" data-id="${scene.SceneID}" title="Edit scene"><i class="bi bi-pencil"></i></button>
          <button type="button" class="sf-icon-btn text-danger sf-edit-only sf-scene-delete" data-id="${scene.SceneID}" title="Delete scene"><i class="bi bi-trash"></i></button>
        </div>
      </div>`;
  }

  function RenderScenes() {
    const root = MainRoot();
    if (!root) return;
    const cards = ScenesCache.map(SceneCardHTML).join('');
    const done = QueueCache.filter((g) => g.Location === 'DONE');
    const doneStrip = done.length
      ? `<div class="sf-done-strip">
          <span class="sf-muted sf-sm">Completed:</span>
          ${done.map((g) => SceneGroupChipHTML(g, g.SceneID || '')).join('')}
        </div>`
      : '';
    root.innerHTML = `
      <div class="sf-view sf-view-main">
        <div class="sf-scene-list" id="SF_SCENE_LIST">
          ${cards || '<div class="sf-empty">No scenes yet. Switch to EDIT mode to add scenes.</div>'}
        </div>
        ${doneStrip}
      </div>`;

    if (OpenSceneNotesGroupID != null) {
      const $openGroup = $(`#SF_SCENE_LIST .sf-scene-group[data-id="${OpenSceneNotesGroupID}"]`);
      if ($openGroup.length) {
        $openGroup.addClass('notes-open');
      } else {
        OpenSceneNotesGroupID = null;
      }
    }

    ApplySceneTimerVisuals();

    EnableDragReorder(
      $('#SF_SCENE_LIST'),
      '.sf-scene-card',
      async (ids) => {
      const [Err] = (await window.API.SetSceneOrder(ids)) || [];
      if (Err) ToastError(Err);
      },
      { handleSelector: '.sf-drag-handle', ignoreFromSelector: '.sf-scene-group' }
    );

    EnableSceneGroupDrag();
  }

  function StartSceneTimer(sceneID) {
    const id = Number(sceneID);
    if (!Number.isInteger(id) || id <= 0) return;
    window.API
      .StartSceneTimer(id)
      .then((res) => {
        const [Err, Scene] = res || [];
        if (Err) {
          ToastError(Err);
          return;
        }
        if (Scene && Number(Scene.SceneID) === id) {
          const idx = (ScenesCache || []).findIndex((s) => Number(s.SceneID) === id);
          if (idx >= 0) ScenesCache[idx] = { ...ScenesCache[idx], ...Scene };
          ApplySceneTimerVisuals();
        }
      })
      .catch((error) => ToastError(error));
  }

  function ApplySceneTimerVisuals() {
    (ScenesCache || []).forEach((scene) => {
      const sceneID = Number(scene.SceneID);
      if (!Number.isInteger(sceneID) || sceneID <= 0) return;
      const fillEl = document.querySelector(`.sf-scene-fill[data-scene-fill="${sceneID}"]`);
      const cardEl = document.querySelector(`.sf-scene-card[data-id="${sceneID}"]`);
      if (!fillEl || !cardEl) return;
      const durationEl = cardEl.querySelector('.sf-scene-duration');

      const duration = Number(scene.Duration);
      const remaining = Number(scene.TimerRemainingSeconds);
      const progress = Number(scene.TimerProgressPercent);
      if (!Number.isFinite(duration) || duration <= 0) {
        fillEl.style.width = '0%';
        if (durationEl) durationEl.textContent = '';
        return;
      }

      if (Number.isFinite(progress) && Number.isFinite(remaining)) {
        fillEl.style.width = `${Math.max(0, Math.min(100, progress))}%`;
        if (durationEl) durationEl.textContent = FormatDuration(remaining);
      } else {
        const startedAt = scene.TimerStartedAt == null ? null : Number(scene.TimerStartedAt);
        if (!Number.isFinite(startedAt)) {
          fillEl.style.width = '0%';
          if (durationEl) durationEl.textContent = FormatDuration(duration);
          return;
        }
        // Backward-compatible fallback for older payloads that don't include
        // backend timer snapshots yet.
        const elapsed = Math.max(0, (Date.now() - startedAt) / 1000);
        const pct = Math.max(0, Math.min(100, (elapsed / duration) * 100));
        fillEl.style.width = `${pct}%`;
        if (durationEl) durationEl.textContent = FormatDuration(Math.max(0, Math.ceil(duration - elapsed)));
      }
    });
  }

  function BuildSceneOrderedQueueIDs() {
    const desiredSceneIDs = [];
    $('#SF_SCENE_LIST .sf-scene-card .sf-scene-group').each(function () {
      desiredSceneIDs.push(Number($(this).attr('data-id')));
    });
    const desiredQueue = desiredSceneIDs.slice();
    return (QueueCache || []).map((item) => {
      if (item.Location === 'SCENE') return desiredQueue.shift() || item.InstanceID;
      return item.InstanceID;
    });
  }

  function EnableSceneGroupDrag() {
    const $sceneList = $('#SF_SCENE_LIST');
    if (!$sceneList.length) return;

    $sceneList.off('.scenegroupdrag');

    if (!IsEditMode()) return;

    let dragEl = null;

    function insertInZone(zoneEl, clientY) {
      const items = Array.from(zoneEl.querySelectorAll('.sf-scene-group')).filter((el) => el !== dragEl);
      let beforeEl = null;
      for (const el of items) {
        const rect = el.getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) {
          beforeEl = el;
          break;
        }
      }
      if (beforeEl) zoneEl.insertBefore(dragEl, beforeEl);
      else zoneEl.appendChild(dragEl);
    }

    $sceneList.on('dragstart.scenegroupdrag', '.sf-scene-group', function (e) {
      dragEl = this;
      this.classList.add('dragging');
      try {
        e.originalEvent.dataTransfer.effectAllowed = 'move';
        e.originalEvent.dataTransfer.setData('text/plain', String($(this).attr('data-id')));
      } catch {
        /* setData can fail in some environments */
      }
    });

    $sceneList.on('dragend.scenegroupdrag', '.sf-scene-group', function () {
      this.classList.remove('dragging');
      dragEl = null;
    });

    $sceneList.on('dragover.scenegroupdrag', '.sf-scene-groups', function (e) {
      if (!dragEl) return;
      e.preventDefault();
      const hoverSceneID = Number($(this).attr('data-scene-id'));
      const sourceSceneID = Number($(dragEl).attr('data-scene-id'));

      // Avoid live cross-scene insertion while hovering, which causes cards to
      // constantly shift. We only finalize cross-scene placement on drop.
      if (hoverSceneID !== sourceSceneID) return;

      insertInZone(this, e.originalEvent.clientY);
    });

    $sceneList.on('drop.scenegroupdrag', '.sf-scene-groups', async function (e) {
      if (!dragEl) return;
      e.preventDefault();

      const movedID = Number($(dragEl).attr('data-id'));
      const sourceSceneID = Number($(dragEl).attr('data-scene-id'));
      const targetSceneID = Number($(this).attr('data-scene-id'));
      if (!Number.isInteger(movedID) || movedID <= 0) return;
      if (!Number.isInteger(targetSceneID) || targetSceneID <= 0) return;

      // Finalize insertion point at drop-time. This keeps hover behavior stable
      // while still preserving intended order across and within scenes.
      insertInZone(this, e.originalEvent.clientY);

      const orderedIDs = BuildSceneOrderedQueueIDs();

      if (sourceSceneID !== targetSceneID) {
        const [MoveErr] = (await window.API.SetQueueLocation(movedID, 'SCENE', targetSceneID)) || [];
        if (MoveErr) {
          ToastError(MoveErr);
          RenderScenes();
          return;
        }
      }

      const [OrderErr] = (await window.API.SetQueueOrder(orderedIDs)) || [];
      if (OrderErr) {
        ToastError(OrderErr);
        RenderScenes();
      }
    });
  }

  // ============================================================
  // QUEUE panel
  // ============================================================
  function PanelGroupRowHTML(group, id, opts) {
    const colour = group.Colour || '#444b55';
    const flags = Array.isArray(group.Flags) ? group.Flags : [];
    const notes = Array.isArray(group.Notes) ? group.Notes : [];
    const flagIcons = flags
      .map(
        (f) =>
          `<i class="bi bi-${Esc(f.Icon)}" style="color:${Esc(f.Colour || '#F4C453')}" title="${Esc(f.Label)}"></i>`
      )
      .join('');
    const startBtn =
      opts && opts.queue
        ? '<button type="button" class="sf-icon-btn sf-show-only sf-queue-start" title="Send to first scene"><i class="bi bi-play-fill"></i></button>'
        : '';
    return `
      <div class="sf-row sf-group-row" draggable="true" data-id="${id}">
        <span class="sf-drag-handle" title="Drag to reorder"><i class="bi bi-grip-vertical"></i></span>
        <span class="sf-group-colour" style="background:${Esc(colour)}"></span>
        <span class="sf-group-time">${group.Time ? Esc(group.Time) : ''}</span>
        <span class="sf-group-label">${Esc(group.Label)}</span>
        <span class="sf-group-flags">${flagIcons}</span>
        ${notes.length ? `<span class="sf-group-notes" title="${notes.length} note(s)"><i class="bi bi-chat-left-text"></i> ${notes.length}</span>` : ''}
        <span class="sf-row-actions">
          ${startBtn}
          <button type="button" class="sf-icon-btn ${opts && opts.queue ? 'sf-queue-edit' : 'sf-group-edit'}" data-id="${id}" title="Edit group"><i class="bi bi-pencil"></i></button>
          <button type="button" class="sf-icon-btn text-danger ${opts && opts.queue ? 'sf-queue-delete' : 'sf-group-delete'}" data-id="${id}" title="Delete group"><i class="bi bi-trash"></i></button>
        </span>
      </div>`;
  }

  function RenderQueuePanel() {
    const root = QueuePanel();
    if (!root) return;
    const upcoming = QueueCache.filter((g) => g.Location === 'QUEUE');
    const canLoadNext = upcoming.length > 0 && Array.isArray(ScenesCache) && ScenesCache.length > 0;
    const loadNextRow = `
      <button type="button" class="btn btn-sm btn-success w-100 sf-queue-loadnext" title="Load next group into first scene" ${canLoadNext ? '' : 'disabled'}>
        Load Next
      </button>`;
    const flowOptions = FlowsCache.map(
      (f) => `<option value="${f.FlowID}">${Esc(f.Label)}</option>`
    ).join('');
    const rows = upcoming.map((g) => PanelGroupRowHTML(g, g.InstanceID, { queue: true })).join('');
    root.innerHTML = `
      <div class="sf-view">
        <div class="sf-view-header">
          <h5 class="sf-view-title">Queue</h5>
          <div class="d-flex align-items-center gap-2">
            <button type="button" class="btn btn-sm btn-light sf-edit-only sf-queue-add" title="Add a group">
              <i class="bi bi-plus-lg"></i>
            </button>
          </div>
        </div>
        <div class="sf-add-row" style="margin-bottom:8px;">
          <select class="form-select form-select-sm" id="SF_QUEUE_FLOW_SELECT" ${FlowsCache.length ? '' : 'disabled'}>
            ${flowOptions || '<option>No flows</option>'}
          </select>
          <button type="button" class="btn btn-sm btn-success sf-queue-loadflow" title="Load flow into queue" ${FlowsCache.length ? '' : 'disabled'}>
            <i class="bi bi-box-arrow-in-down"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline-danger sf-queue-reset" title="Reset the Active Show">
            <i class="bi bi-arrow-counterclockwise"></i>
          </button>
        </div>
        <p class="sf-muted">Upcoming groups. Edits here are temporary and do not change the flow.</p>
        <div style="margin-bottom:8px;">${loadNextRow}</div>
        <div class="sf-list" id="SF_QUEUE_LIST">
          ${rows || '<div class="sf-empty">Queue is empty. Load a flow.</div>'}
        </div>
      </div>`;

    EnableDragReorder($('#SF_QUEUE_LIST'), '.sf-row', async (ids) => {
      const [Err] = (await window.API.SetQueueOrder(ids)) || [];
      if (Err) ToastError(Err);
    });
  }

  // ============================================================
  // CHAT panel
  // ============================================================
  async function EnsureActiveChatRoom() {
    if (!Array.isArray(ChatRoomsCache) || !ChatRoomsCache.length) {
      ActiveChatRoomKey = null;
      ChatViewMode = 'list';
      return;
    }
    if (!ActiveChatRoomKey) {
      const first = ChatRoomsCache[0];
      ActiveChatRoomKey = ChatRoomKey(first.RoomType, first.RoomID);
    }
    const exists = ChatRoomsCache.some(
      (room) => ChatRoomKey(room.RoomType, room.RoomID) === ActiveChatRoomKey
    );
    if (!exists) {
      const first = ChatRoomsCache[0];
      ActiveChatRoomKey = ChatRoomKey(first.RoomType, first.RoomID);
    }
    await LoadActiveChatMessages();
  }

  async function LoadActiveChatMessages() {
    if (!ActiveChatRoomKey) return;
    const [roomType, roomIDRaw] = ActiveChatRoomKey.split(':');
    const roomID = Number(roomIDRaw);
    if (!roomType || !Number.isInteger(roomID) || roomID <= 0) return;
    const [Err, Messages] = (await window.API.GetChatMessages(roomType, roomID)) || [];
    if (Err) return ToastError(Err);
    ChatMessagesByRoom[ActiveChatRoomKey] = Array.isArray(Messages) ? Messages : [];
    RenderChatPanel();
  }

  function RenderChatPanel() {
    const root = ChatPanel();
    if (!root) return;
    const roomRows = (ChatRoomsCache || [])
      .map((room) => {
        const key = ChatRoomKey(room.RoomType, room.RoomID);
        const activeClass = key === ActiveChatRoomKey ? ' is-active' : '';
        const sourceBadge = room.RoomType === 'CUSTOM' ? 'Custom' : 'Scene';
        return `
          <button type="button" class="sf-chat-room-card${activeClass}" data-room-type="${Esc(room.RoomType)}" data-room-id="${room.RoomID}">
            <i class="bi bi-${Esc(room.Icon || 'chat-square-text')}" style="color:${Esc(room.Colour || '#1E88E5')}"></i>
            <span class="sf-chat-room-meta">
              <span class="sf-chat-room-label">${Esc(room.Label)}</span>
              <span class="sf-chat-room-source">${sourceBadge}</span>
            </span>
            <i class="bi bi-chevron-right sf-chat-room-chevron" aria-hidden="true"></i>
          </button>`;
      })
      .join('');

    const activeRoom = (ChatRoomsCache || []).find(
      (room) => ChatRoomKey(room.RoomType, room.RoomID) === ActiveChatRoomKey
    );
    const messages = ActiveChatRoomKey ? ChatMessagesByRoom[ActiveChatRoomKey] || [] : [];
    const messagesHTML = messages.length
      ? messages
          .map((m, idx) => {
            const prev = idx > 0 ? messages[idx - 1] : null;
            const currentAuthorID = Number(m.AuthorID);
            const previousAuthorID = prev ? Number(prev.AuthorID) : NaN;
            const currentAuthorKey = Number.isFinite(currentAuthorID)
              ? `id:${currentAuthorID}`
              : `label:${String(m.AuthorLabel || '').trim().toLowerCase()}`;
            const previousAuthorKey = prev
              ? Number.isFinite(previousAuthorID)
                ? `id:${previousAuthorID}`
                : `label:${String(prev.AuthorLabel || '').trim().toLowerCase()}`
              : null;
            const showHeader = !prev || previousAuthorKey !== currentAuthorKey;
            return `
            <div class="sf-chat-msg${showHeader ? ' has-header' : ' is-continuation'}">
              ${
                showHeader
                  ? `<div class="sf-chat-msg-head">
                <span class="sf-chat-author"><i class="bi bi-${Esc(m.AuthorIcon || 'person-fill')}" style="color:${Esc(m.AuthorColour || '#fff')}"></i> ${Esc(m.AuthorLabel || 'Unknown')}</span>
              </div>`
                  : ''
              }
              <div class="sf-chat-msg-body">${Esc(m.Message || '')}</div>
              <span class="sf-chat-time">${Esc(FormatNoteTime(m.Timestamp))}</span>
            </div>`;
          })
          .join('')
      : '<div class="sf-empty">No messages yet.</div>';

    if (ChatViewMode === 'room' && activeRoom) {
      root.innerHTML = `
        <div class="sf-view sf-chat-view sf-chat-view-room">
          <div class="sf-view-header">
            <button type="button" class="btn btn-sm btn-light" id="SF_CHAT_BACK"><i class="bi bi-chevron-left"></i> Channels</button>
            <h5 class="sf-view-title sf-chat-room-title">${Esc(activeRoom.Label)}</h5>
          </div>
          <div class="sf-chat-main">
            <div class="sf-chat-messages" id="SF_CHAT_MESSAGES">${messagesHTML}</div>
            <div class="sf-add-row sf-chat-compose">
              <input type="text" class="form-control" id="SF_CHAT_INPUT" placeholder="Send as Control" ${activeRoom ? '' : 'disabled'} />
              <button type="button" class="btn btn-sm btn-success" id="SF_CHAT_SEND" ${activeRoom ? '' : 'disabled'}><i class="bi bi-send"></i></button>
            </div>
          </div>
        </div>`;
      return;
    }

    root.innerHTML = `
      <div class="sf-view sf-chat-view">
        <div class="sf-view-header">
          <h5 class="sf-view-title">Chat</h5>
        </div>
        <p class="sf-muted">Rooms: custom first, then scene chat rooms.</p>
        <div class="sf-chat-room-list" id="SF_CHAT_ROOM_LIST">
          ${roomRows || '<div class="sf-empty">No chat rooms available.</div>'}
        </div>
      </div>`;
  }

  // ============================================================
  // FLOWS panel (list + drill-in to a flow's groups)
  // ============================================================
  function RenderFlowsPanel() {
    const root = FlowsPanel();
    if (!root) return;
    if (State.flowID != null) {
      RenderFlowGroups(root);
      return;
    }
    const rows = FlowsCache.map(
      (flow) => `
      <div class="sf-row" draggable="true" data-id="${flow.FlowID}">
        <span class="sf-drag-handle" title="Drag to reorder"><i class="bi bi-grip-vertical"></i></span>
        <span class="sf-row-label sf-flow-open" data-id="${flow.FlowID}" role="button" tabindex="0">${Esc(flow.Label)}</span>
        <span class="sf-row-actions">
          <button type="button" class="sf-icon-btn sf-flow-load" data-id="${flow.FlowID}" title="Load into queue"><i class="bi bi-box-arrow-in-down"></i></button>
          <button type="button" class="sf-icon-btn sf-flow-edit sf-edit-only" data-id="${flow.FlowID}" title="Rename"><i class="bi bi-pencil"></i></button>
          <button type="button" class="sf-icon-btn text-danger sf-flow-delete sf-edit-only" data-id="${flow.FlowID}" title="Delete"><i class="bi bi-trash"></i></button>
        </span>
      </div>`
    ).join('');
    root.innerHTML = `
      <div class="sf-view">
        <div class="sf-view-header">
          <h5 class="sf-view-title">Flows</h5>
          <button type="button" class="btn btn-sm btn-light sf-edit-only sf-flow-create"><i class="bi bi-plus-lg"></i></button>
        </div>
        <p class="sf-muted">Reusable, ordered group collections. Click a flow to manage its groups.</p>
        <div class="sf-list" id="SF_FLOW_LIST">
          ${rows || '<div class="sf-empty">No flows yet.</div>'}
        </div>
      </div>`;

    EnableDragReorder($('#SF_FLOW_LIST'), '.sf-row', async (ids) => {
      const [Err] = (await window.API.SetFlowOrder(ids)) || [];
      if (Err) ToastError(Err);
    });
  }

  async function RenderFlowGroups(root) {
    const flow = FlowsCache.find((f) => f.FlowID === State.flowID);
    // GetFlowGroups returns the groups array directly (not an [Err,Result] tuple).
    // Treating it as a tuple caused initial opens to appear empty until another
    // action refreshed FlowGroupsCache.
    const Groups = await window.API.GetFlowGroups(State.flowID);
    FlowGroupsCache = Array.isArray(Groups) ? Groups : [];
    const rows = FlowGroupsCache.map((g) => PanelGroupRowHTML(g, g.RowID, { queue: false })).join('');
    root.innerHTML = `
      <div class="sf-view">
        <div class="sf-view-header">
          <button type="button" class="btn btn-sm sf-back" id="SF_FLOW_BACK"><i class="bi bi-chevron-left"></i></button>
          <h5 class="sf-view-title">${Esc(flow ? flow.Label : 'Flow')}</h5>
          <button type="button" class="btn btn-sm btn-light sf-edit-only sf-group-create"><i class="bi bi-plus-lg"></i></button>
        </div>
        <p class="sf-muted">Groups in this flow. Drag to reorder.</p>
        <div class="sf-list" id="SF_GROUP_LIST">
          ${rows || '<div class="sf-empty">No groups yet.</div>'}
        </div>
      </div>`;

    EnableDragReorder($('#SF_GROUP_LIST'), '.sf-row', async (ids) => {
      const [OrderErr] = (await window.API.SetFlowGroupOrder(State.flowID, ids)) || [];
      if (OrderErr) ToastError(OrderErr);
    });
  }

  // ============================================================
  // SHOW SETTINGS panel (flag catalogue)
  // ============================================================
  function RenderSettingsPanel() {
    const root = SettingsPanel();
    if (!root) return;
    const flagRows = FlagsCache.map(
      (flag) => `
      <div class="sf-row" draggable="true" data-id="${flag.FlagID}">
        <span class="sf-drag-handle" title="Drag to reorder"><i class="bi bi-grip-vertical"></i></span>
        <span class="sf-flag-icon"><i class="bi bi-${Esc(flag.Icon)}" style="color:${Esc(flag.Colour || '#F4C453')}"></i></span>
        <span class="sf-row-label">${Esc(flag.Label)}</span>
        <span class="sf-row-actions">
          <button type="button" class="sf-icon-btn sf-flag-edit sf-edit-only" data-id="${flag.FlagID}" title="Edit"><i class="bi bi-pencil"></i></button>
          <button type="button" class="sf-icon-btn text-danger sf-flag-delete sf-edit-only" data-id="${flag.FlagID}" title="Delete"><i class="bi bi-trash"></i></button>
        </span>
      </div>`
    ).join('');

    const remoteRows = RemoteUsersCache.map(
      (user) => `
      <div class="sf-row" data-id="${user.RemoteUserID}">
        <span class="sf-flag-icon"><i class="bi bi-${Esc(user.Icon || 'person-fill')}" style="color:${Esc(user.Colour || '#5B8DEF')}"></i></span>
        <span class="sf-row-label">${Esc(user.Username)}</span>
        ${user.IsAdmin ? '<span class="sf-ru-admin">Admin</span>' : '<span class="sf-ru-admin sf-ru-admin--off">User</span>'}
        <span class="sf-row-actions">
          <button type="button" class="sf-icon-btn sf-ru-edit sf-edit-only" data-id="${user.RemoteUserID}" title="Edit"><i class="bi bi-pencil"></i></button>
          <button type="button" class="sf-icon-btn text-danger sf-ru-delete sf-edit-only" data-id="${user.RemoteUserID}" title="Delete"><i class="bi bi-trash"></i></button>
        </span>
      </div>`
    ).join('');

    const showColourRows = ShowColoursCache.map(
      (entry) => `
      <div class="sf-row" data-id="${entry.ShowColourID}">
        <span class="sf-group-colour" style="background:${Esc(entry.Colour)}"></span>
        <span class="sf-row-label">${Esc(entry.Label)}</span>
        <span class="sf-ru-pin">${Esc(entry.Colour)}</span>
        <span class="sf-row-actions">
          <button type="button" class="sf-icon-btn sf-sc-edit sf-edit-only" data-id="${entry.ShowColourID}" title="Edit"><i class="bi bi-pencil"></i></button>
          <button type="button" class="sf-icon-btn text-danger sf-sc-delete sf-edit-only" data-id="${entry.ShowColourID}" title="Delete"><i class="bi bi-trash"></i></button>
        </span>
      </div>`
    ).join('');

    const customChatRows = (ChatRoomsCache || [])
      .filter((r) => r.RoomType === 'CUSTOM')
      .map(
        (room) => `
      <div class="sf-row" data-id="${room.RoomID}">
        <span class="sf-flag-icon"><i class="bi bi-${Esc(room.Icon || 'chat-square-text')}" style="color:${Esc(room.Colour || '#1E88E5')}"></i></span>
        <span class="sf-row-label">${Esc(room.Label)}</span>
        <span class="sf-row-actions">
          <button type="button" class="sf-icon-btn sf-ccr-edit sf-edit-only" data-id="${room.RoomID}" title="Edit"><i class="bi bi-pencil"></i></button>
          <button type="button" class="sf-icon-btn text-danger sf-ccr-delete sf-edit-only" data-id="${room.RoomID}" title="Delete"><i class="bi bi-trash"></i></button>
        </span>
      </div>`
      )
      .join('');

    root.innerHTML = `
      <div class="sf-view">
        <div class="sf-view-header">
          <h5 class="sf-view-title">Show Settings</h5>
        </div>
        <div class="sf-settings-section">
          <div class="sf-view-header">
            <h6 class="sf-view-title">Flags</h6>
            <button type="button" class="btn btn-sm btn-light sf-edit-only sf-flag-create"><i class="bi bi-plus-lg"></i></button>
          </div>
          <p class="sf-muted">Flags applicable to groups. Icons use Bootstrap Icon names (no <code>bi-</code> prefix).</p>
          <div class="sf-list" id="SF_FLAG_LIST">
            ${flagRows || '<div class="sf-empty">No flags defined.</div>'}
          </div>
        </div>

        <div class="sf-settings-section" style="margin-top:14px;">
          <div class="sf-view-header">
            <h6 class="sf-view-title">Remote Users</h6>
            <button type="button" class="btn btn-sm btn-light sf-edit-only sf-ru-create"><i class="bi bi-plus-lg"></i></button>
          </div>
          <p class="sf-muted">Manage remote users with username, 4-digit PIN, admin role, colour, and icon.</p>
          <div class="sf-list" id="SF_REMOTE_USER_LIST">
            ${remoteRows || '<div class="sf-empty">No remote users defined.</div>'}
          </div>
        </div>

        <div class="sf-settings-section" style="margin-top:14px;">
          <div class="sf-view-header">
            <h6 class="sf-view-title">Show Colours</h6>
            <div class="d-flex align-items-center gap-2">
              <button type="button" class="btn btn-sm btn-outline-warning sf-edit-only sf-sc-reset">Reset Defaults</button>
              <button type="button" class="btn btn-sm btn-light sf-edit-only sf-sc-create"><i class="bi bi-plus-lg"></i></button>
            </div>
          </div>
          <p class="sf-muted">Define named show colours used across group, milestone, flag, and remote user editors.</p>
          <div class="sf-list" id="SF_SHOW_COLOUR_LIST">
            ${showColourRows || '<div class="sf-empty">No show colours defined.</div>'}
          </div>
        </div>

        <div class="sf-settings-section" style="margin-top:14px;">
          <div class="sf-view-header">
            <h6 class="sf-view-title">Custom Chat Rooms</h6>
            <button type="button" class="btn btn-sm btn-light sf-edit-only sf-ccr-create"><i class="bi bi-plus-lg"></i></button>
          </div>
          <p class="sf-muted">Additional chat rooms shown before scene chat rooms.</p>
          <div class="sf-list" id="SF_CUSTOM_CHAT_ROOM_LIST">
            ${customChatRows || '<div class="sf-empty">No custom chat rooms defined.</div>'}
          </div>
        </div>
      </div>`;

    EnableDragReorder($('#SF_FLAG_LIST'), '.sf-row', async (ids) => {
      const [Err] = (await window.API.SetFlagOrder(ids)) || [];
      if (Err) ToastError(Err);
    });
  }

  function OpenCustomChatRoomEditor(room) {
    const isEdit = !!room;
    const InitialIcon = room && room.Icon ? room.Icon : 'chat-square-text';
    const InitialColour = room && room.Colour ? room.Colour : DefaultShowColour();
    const ColourOptions = BuildShowColourOptionsHTML(InitialColour);
    const IconPickerMarkup =
      window.ShowTrakIconPicker && typeof window.ShowTrakIconPicker.createMarkup === 'function'
        ? window.ShowTrakIconPicker.createMarkup({
            inputId: 'SF_CCR_ICON',
            previewId: 'SF_CCR_ICON_PREVIEW',
            panelId: 'SF_CCR_ICON_PANEL',
            searchId: 'SF_CCR_ICON_SEARCH',
            listId: 'SF_CCR_ICON_LIST',
            value: InitialIcon,
          })
        : `
          <div class="sf-colour-input">
            <span class="sf-flag-preview"><i class="bi bi-${Esc(InitialIcon)}" id="SF_CCR_ICON_PREVIEW"></i></span>
            <input type="text" class="form-control" id="SF_CCR_ICON" value="${Esc(InitialIcon)}" />
          </div>`;

    EnsureEditorElement();
    const editorPanel = document.getElementById('SF_EDITOR_PANEL');
    editorPanel.className = 'sf-editor-panel sf-editor-panel--flag';
    editorPanel.innerHTML = `
      <div class="sf-editor-header">
        <h5 class="mb-0">${isEdit ? 'Edit Custom Chat Room' : 'New Custom Chat Room'}</h5>
        <button type="button" class="btn btn-sm sf-icon-btn sf-editor-close"><i class="bi bi-x-lg"></i></button>
      </div>
      <div class="sf-editor-body">
        <div class="sf-field">
          <label>Label <span class="sf-required">*</span></label>
          <input type="text" class="form-control" id="SF_CCR_LABEL" value="${Esc(room ? room.Label : '')}" placeholder="Chat room label" />
        </div>
        <div class="sf-field">
          <label>Bootstrap icon <span class="sf-required">*</span></label>
          ${IconPickerMarkup}
        </div>
        <div class="sf-field">
          <label>Colour <span class="sf-required">*</span></label>
          <select class="form-select" id="SF_CCR_COLOUR_SELECT">${ColourOptions}</select>
        </div>
      </div>
      <div class="sf-editor-footer">
        <button type="button" class="btn btn-light sf-editor-close">Cancel</button>
        <button type="button" class="btn btn-success" id="SF_CCR_SAVE">Save</button>
      </div>`;
    OpenOverlay();

    if (window.ShowTrakIconPicker && typeof window.ShowTrakIconPicker.mount === 'function') {
      window.ShowTrakIconPicker.mount({
        inputId: 'SF_CCR_ICON',
        previewId: 'SF_CCR_ICON_PREVIEW',
        panelId: 'SF_CCR_ICON_PANEL',
        searchId: 'SF_CCR_ICON_SEARCH',
        listId: 'SF_CCR_ICON_LIST',
      });
    }

    $('#SF_CCR_ICON_PREVIEW').css('color', $('#SF_CCR_COLOUR_SELECT').val() || InitialColour);
    $('#SF_CCR_COLOUR_SELECT')
      .off('change.ccrcolour')
      .on('change.ccrcolour', function () {
        $('#SF_CCR_ICON_PREVIEW').css('color', $(this).val());
      });

    $('#SF_CCR_SAVE')
      .off('click.ccrsave')
      .on('click.ccrsave', async () => {
        const Label = $('#SF_CCR_LABEL').val().trim();
        const Icon = $('#SF_CCR_ICON').val().trim();
        const Colour = String($('#SF_CCR_COLOUR_SELECT').val() || '').trim();
        if (!Label || !Icon || !Colour) {
          ToastError('Label, icon, and colour are required');
          return;
        }
        const payload = { Label, Icon, Colour };
        const fn = isEdit
          ? window.API.UpdateCustomChatRoom(room.RoomID, payload)
          : window.API.CreateCustomChatRoom(payload);
        const [Err] = (await fn) || [];
        if (Err) return ToastError(Err);
        CloseOverlay();
      });
  }

  function OpenShowColourEditor(entry) {
    const isEdit = !!entry;
    const InitialColour = entry && entry.Colour ? entry.Colour : DefaultShowColour();
    EnsureEditorElement();
    const editorPanel = document.getElementById('SF_EDITOR_PANEL');
    editorPanel.className = 'sf-editor-panel';
    editorPanel.innerHTML = `
      <div class="sf-editor-header">
        <h5 class="mb-0">${isEdit ? 'Edit Show Colour' : 'New Show Colour'}</h5>
        <button type="button" class="btn btn-sm sf-icon-btn sf-editor-close"><i class="bi bi-x-lg"></i></button>
      </div>
      <div class="sf-editor-body">
        <div class="sf-field">
          <label>Label <span class="sf-required">*</span></label>
          <input type="text" class="form-control" id="SF_SC_LABEL" value="${Esc(entry ? entry.Label : '')}" placeholder="e.g. Accent Blue" />
        </div>
        <div class="sf-field">
          <label>Hex code <span class="sf-required">*</span></label>
          <div class="sf-colour-input">
            <input type="color" id="SF_SC_COLOUR_PICK" value="${Esc(InitialColour)}" />
            <input type="text" class="form-control" id="SF_SC_COLOUR" value="${Esc(InitialColour)}" placeholder="#RRGGBB" maxlength="7" />
          </div>
        </div>
      </div>
      <div class="sf-editor-footer">
        <button type="button" class="btn btn-light sf-editor-close">Cancel</button>
        <button type="button" class="btn btn-success" id="SF_SC_SAVE">Save</button>
      </div>`;
    OpenOverlay();

    $('#SF_SC_COLOUR_PICK')
      .off('input.sccolourpick')
      .on('input.sccolourpick', function () {
        $('#SF_SC_COLOUR').val($(this).val());
      });
    $('#SF_SC_COLOUR')
      .off('input.sccolourtext')
      .on('input.sccolourtext', function () {
        const value = $(this).val().trim();
        if (/^#[0-9A-Fa-f]{6}$/.test(value)) $('#SF_SC_COLOUR_PICK').val(value);
      });

    $('#SF_SC_SAVE')
      .off('click.scsave')
      .on('click.scsave', async () => {
        const Label = $('#SF_SC_LABEL').val().trim();
        const Colour = $('#SF_SC_COLOUR').val().trim();
        if (!Label || !Colour) {
          ToastError('Label and hex code are required');
          return;
        }
        if (!/^#[0-9A-Fa-f]{6}$/.test(Colour)) {
          ToastError('Hex code must be a value like #5B8DEF');
          return;
        }
        const payload = { Label, Colour };
        const fn = isEdit
          ? window.API.UpdateShowColour(entry.ShowColourID, payload)
          : window.API.CreateShowColour(payload);
        const [Err] = (await fn) || [];
        if (Err) return ToastError(Err);
        CloseOverlay();
      });
  }

  function OpenRemoteUserEditor(user) {
    const isEdit = !!user;
    const InitialIcon = user && user.Icon ? user.Icon : 'person-fill';
    const InitialColour = user && user.Colour ? user.Colour : DefaultShowColour();
    const ColourOptions = BuildShowColourOptionsHTML(InitialColour);
    const IconPickerMarkup =
      window.ShowTrakIconPicker && typeof window.ShowTrakIconPicker.createMarkup === 'function'
        ? window.ShowTrakIconPicker.createMarkup({
            inputId: 'SF_RU_ICON',
            previewId: 'SF_RU_ICON_PREVIEW',
            panelId: 'SF_RU_ICON_PANEL',
            searchId: 'SF_RU_ICON_SEARCH',
            listId: 'SF_RU_ICON_LIST',
            value: InitialIcon,
          })
        : `
          <div class="sf-colour-input">
            <span class="sf-flag-preview"><i class="bi bi-${Esc(InitialIcon)}" id="SF_RU_ICON_PREVIEW"></i></span>
            <input type="text" class="form-control" id="SF_RU_ICON" value="${Esc(InitialIcon)}" placeholder="e.g. person-fill" />
          </div>`;

    EnsureEditorElement();
    const editorPanel = document.getElementById('SF_EDITOR_PANEL');
    editorPanel.className = 'sf-editor-panel sf-editor-panel--flag';
    editorPanel.innerHTML = `
      <div class="sf-editor-header">
        <h5 class="mb-0">${isEdit ? 'Edit Remote User' : 'New Remote User'}</h5>
        <button type="button" class="btn btn-sm sf-icon-btn sf-editor-close"><i class="bi bi-x-lg"></i></button>
      </div>
      <div class="sf-editor-body">
        <div class="sf-field">
          <label>Username <span class="sf-required">*</span></label>
          <input type="text" class="form-control" id="SF_RU_USERNAME" value="${Esc(user ? user.Username : '')}" placeholder="Username" />
        </div>
        <div class="sf-field-row">
          <div class="sf-field">
            <label>PIN <span class="sf-required">*</span></label>
            <input type="text" class="form-control" id="SF_RU_PIN" value="${Esc(user ? user.Pin : '')}" maxlength="4" inputmode="numeric" pattern="\\d{4}" placeholder="4 digits" />
          </div>
          <div class="sf-field" style="justify-content:flex-end;">
            <label>Admin</label>
            <div class="form-check form-switch" style="padding-top:6px;">
              <input class="form-check-input" type="checkbox" id="SF_RU_ISADMIN" ${user && user.IsAdmin ? 'checked' : ''} />
              <label class="form-check-label" for="SF_RU_ISADMIN">Has admin access</label>
            </div>
          </div>
        </div>
        <div class="sf-field">
          <label>Bootstrap Icon <span class="sf-required">*</span></label>
          ${IconPickerMarkup}
        </div>
        <div class="sf-field">
          <label>User colour <span class="sf-required">*</span></label>
          <select class="form-select" id="SF_RU_COLOUR_SELECT">${ColourOptions}</select>
        </div>
      </div>
      <div class="sf-editor-footer">
        <button type="button" class="btn btn-light sf-editor-close">Cancel</button>
        <button type="button" class="btn btn-success" id="SF_RU_SAVE">Save</button>
      </div>`;
    OpenOverlay();

    if (window.ShowTrakIconPicker && typeof window.ShowTrakIconPicker.mount === 'function') {
      window.ShowTrakIconPicker.mount({
        inputId: 'SF_RU_ICON',
        previewId: 'SF_RU_ICON_PREVIEW',
        panelId: 'SF_RU_ICON_PANEL',
        searchId: 'SF_RU_ICON_SEARCH',
        listId: 'SF_RU_ICON_LIST',
      });
    }

    $('#SF_RU_ICON_PREVIEW').css('color', $('#SF_RU_COLOUR_SELECT').val() || InitialColour);
    $('#SF_RU_COLOUR_SELECT')
      .off('change.rucolour')
      .on('change.rucolour', function () {
        $('#SF_RU_ICON_PREVIEW').css('color', $(this).val());
      });
    $('#SF_RU_PIN')
      .off('input.rupin')
      .on('input.rupin', function () {
        const digits = String($(this).val() || '').replace(/\D/g, '').slice(0, 4);
        $(this).val(digits);
      });

    $('#SF_RU_SAVE')
      .off('click.rusave')
      .on('click.rusave', async () => {
        const Username = $('#SF_RU_USERNAME').val().trim();
        const Pin = $('#SF_RU_PIN').val().trim();
        const Icon = $('#SF_RU_ICON').val().trim();
        const Colour = String($('#SF_RU_COLOUR_SELECT').val() || '').trim();
        const IsAdmin = !!$('#SF_RU_ISADMIN').prop('checked');
        if (!Username || !Pin || !Icon || !Colour) {
          ToastError('Username, PIN, icon, and colour are required');
          return;
        }
        if (!/^\d{4}$/.test(Pin)) {
          ToastError('PIN must be exactly 4 digits');
          return;
        }
        const payload = { Username, Pin, IsAdmin, Icon, Colour };
        const fn = isEdit
          ? window.API.UpdateRemoteUser(user.RemoteUserID, payload)
          : window.API.CreateRemoteUser(payload);
        const [Err] = (await fn) || [];
        if (Err) return ToastError(Err);
        CloseOverlay();
      });
  }

  // ============================================================
  // Shared overlay (group editor, scene editor, flag editor, prompt)
  // ============================================================
  let EditorDraft = null;
  let EditorOnSave = null;

  function EnsureEditorElement() {
    if (document.getElementById('SF_EDITOR_OVERLAY')) return;
    const overlay = document.createElement('div');
    overlay.id = 'SF_EDITOR_OVERLAY';
    overlay.className = 'sf-editor-overlay no-drag';
    overlay.innerHTML = '<div class="sf-editor-panel" id="SF_EDITOR_PANEL"></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) CloseOverlay();
    });
  }

  function OpenOverlay() {
    EnsureEditorElement();
    $('#SF_EDITOR_OVERLAY').addClass('open');
  }

  function CloseOverlay() {
    $('#SF_EDITOR_OVERLAY').removeClass('open');
    EditorDraft = null;
    EditorOnSave = null;
    SceneDraft = null;
  }

  // ---- Group editor ----
  function OpenGroupEditor(group, options) {
    const opts = options || {};
    EditorDraft = {
      GroupID: group && group.GroupID ? group.GroupID : '',
      Label: group && group.Label ? group.Label : '',
      Time: group && group.Time ? group.Time : '',
      Colour: group && group.Colour ? group.Colour : DefaultShowColour(),
      Notes: group && Array.isArray(group.Notes) ? group.Notes.map((n) => ({ ...n })) : [],
      Flags: group && Array.isArray(group.Flags) ? group.Flags.map((f) => ({ ...f })) : [],
    };
    EditorOnSave = opts.onSave || null;
    RenderGroupEditor(opts.title || 'Edit Group', opts.groupIDEditable !== false);
    OpenOverlay();
  }

  function RenderGroupEditor(title, groupIDEditable) {
    EnsureEditorElement();
    const editorPanel = document.getElementById('SF_EDITOR_PANEL');
    editorPanel.className = 'sf-editor-panel';
    const draft = EditorDraft;
    const colourOptions = BuildShowColourOptionsHTML(draft.Colour);
    const flagOptions = FlagsCache.map(
      (f) => `<option value="${f.FlagID}">${Esc(f.Label)}</option>`
    ).join('');
    const notesHTML = draft.Notes.map(
      (n, i) => `
      <div class="sf-note" data-index="${i}">
        <span class="sf-note-msg">${Esc(n.Message)}</span>
        <button type="button" class="btn btn-sm sf-icon-btn text-danger sf-note-remove" data-index="${i}"><i class="bi bi-x-lg"></i></button>
      </div>`
    ).join('');
    const flagsHTML = draft.Flags.map(
      (f, i) => `
      <div class="sf-flag-chip" data-index="${i}">
        <i class="bi bi-${Esc(f.Icon)}" style="color:${Esc(f.Colour || '#F4C453')}"></i>
        <span>${Esc(f.Label)}</span>
        ${f.Comment ? `<span class="sf-flag-comment">${Esc(f.Comment)}</span>` : ''}
        <button type="button" class="btn btn-sm sf-icon-btn text-danger sf-flag-remove" data-index="${i}"><i class="bi bi-x-lg"></i></button>
      </div>`
    ).join('');

    editorPanel.innerHTML = `
      <div class="sf-editor-header">
        <h5 class="mb-0">${Esc(title)}</h5>
        <button type="button" class="btn btn-sm sf-icon-btn sf-editor-close"><i class="bi bi-x-lg"></i></button>
      </div>
      <div class="sf-editor-body">
        <div class="sf-field">
          <label>Label <span class="sf-required">*</span></label>
          <input type="text" class="form-control" id="SF_ED_LABEL" value="${Esc(draft.Label)}" placeholder="Group label" />
        </div>
        <div class="sf-field-row">
          <div class="sf-field">
            <label>Group ID</label>
            <input type="text" class="form-control" id="SF_ED_GROUPID" value="${Esc(draft.GroupID)}" placeholder="Auto" ${groupIDEditable ? '' : 'readonly'} />
          </div>
          <div class="sf-field">
            <label>Time</label>
            <input type="text" class="form-control" id="SF_ED_TIME" value="${Esc(draft.Time)}" placeholder="HH:MM" maxlength="5" />
          </div>
          <div class="sf-field sf-field-colour">
            <label>Colour</label>
            <select class="form-select" id="SF_ED_COLOUR_SELECT">${colourOptions}</select>
          </div>
        </div>
        <div class="sf-field">
          <label>Notes</label>
          <div class="sf-notes-list" id="SF_ED_NOTES">${notesHTML || '<div class="sf-muted sf-sm">No notes.</div>'}</div>
          <div class="sf-add-row">
            <input type="text" class="form-control" id="SF_ED_NOTE_INPUT" placeholder="Add a note for teams" />
            <button type="button" class="btn btn-sm btn-light" id="SF_ED_NOTE_ADD"><i class="bi bi-plus-lg"></i></button>
          </div>
        </div>
        <div class="sf-field">
          <label>Flags</label>
          <div class="sf-flags-list" id="SF_ED_FLAGS">${flagsHTML || '<div class="sf-muted sf-sm">No flags.</div>'}</div>
          <div class="sf-add-row">
            <select class="form-select" id="SF_ED_FLAG_SELECT" ${FlagsCache.length ? '' : 'disabled'}>
              ${flagOptions || '<option>No flags defined</option>'}
            </select>
            <input type="text" class="form-control" id="SF_ED_FLAG_COMMENT" placeholder="Comment (optional)" />
            <button type="button" class="btn btn-sm btn-light" id="SF_ED_FLAG_ADD" ${FlagsCache.length ? '' : 'disabled'}><i class="bi bi-plus-lg"></i></button>
          </div>
        </div>
      </div>
      <div class="sf-editor-footer">
        <button type="button" class="btn btn-light sf-editor-close">Cancel</button>
        <button type="button" class="btn btn-success" id="SF_ED_SAVE">Save</button>
      </div>`;
  }

  function CollectGroupDraft() {
    if (!EditorDraft) return;
    EditorDraft.Label = $('#SF_ED_LABEL').val().trim();
    EditorDraft.GroupID = $('#SF_ED_GROUPID').val().trim();
    EditorDraft.Time = $('#SF_ED_TIME').val().trim();
    EditorDraft.Colour = String($('#SF_ED_COLOUR_SELECT').val() || '').trim();
  }

  function ReRenderGroupEditor() {
    RenderGroupEditor($('.sf-editor-header h5').text(), !$('#SF_ED_GROUPID').prop('readonly'));
  }

  async function SaveGroupEditor() {
    CollectGroupDraft();
    if (!EditorDraft.Label) {
      ToastError('Label is required');
      return;
    }
    const payload = {
      Label: EditorDraft.Label,
      Time: EditorDraft.Time || null,
      Colour: EditorDraft.Colour || null,
      Notes: EditorDraft.Notes,
      Flags: EditorDraft.Flags,
    };
    if (EditorDraft.GroupID) payload.GroupID = EditorDraft.GroupID;
    if (typeof EditorOnSave !== 'function') {
      ToastError('Group save handler is not available');
      return;
    }
    try {
      const ok = await EditorOnSave(payload);
      if (ok) CloseOverlay();
    } catch (err) {
      ToastError(err);
    }
  }

  // ---- Scene editor ----
  let SceneDraft = null;

  function OpenSceneEditor(scene) {
    SceneDraft = {
      SceneID: scene ? scene.SceneID : null,
      Label: scene ? scene.Label : '',
      Duration: scene && scene.Duration != null ? scene.Duration : null,
      HasChatRoom: scene ? !!scene.HasChatRoom : false,
      MaxGroups: scene && scene.MaxGroups != null ? scene.MaxGroups : null,
      Colour: scene && scene.Colour ? scene.Colour : DefaultShowColour(),
      Icon: scene && scene.Icon ? scene.Icon : 'chat-left-text-fill',
      Milestones:
        scene && Array.isArray(scene.Milestones) ? scene.Milestones.map((m) => ({ ...m })) : [],
    };
    RenderSceneEditor();
    OpenOverlay();
  }

  function RenderSceneEditor() {
    EnsureEditorElement();
    const editorPanel = document.getElementById('SF_EDITOR_PANEL');
    editorPanel.className = 'sf-editor-panel';
    const draft = SceneDraft;
    const defaultMilestoneColour = DefaultShowColour();
    const sceneColourOptions = BuildShowColourOptionsHTML(draft.Colour || defaultMilestoneColour);
    const SceneIconMarkup =
      window.ShowTrakIconPicker && typeof window.ShowTrakIconPicker.createMarkup === 'function'
        ? window.ShowTrakIconPicker.createMarkup({
            inputId: 'SF_SCENE_ICON',
            previewId: 'SF_SCENE_ICON_PREVIEW',
            panelId: 'SF_SCENE_ICON_PANEL',
            searchId: 'SF_SCENE_ICON_SEARCH',
            listId: 'SF_SCENE_ICON_LIST',
            value: draft.Icon || 'chat-left-text-fill',
          })
        : '<input type="text" class="form-control" id="SF_SCENE_ICON" />';
    const milestonesHTML = draft.Milestones.map(
      (m, i) => `
      <div class="sf-milestone-row" data-index="${i}">
        <select class="form-select sf-ms-colour-select">${BuildShowColourOptionsHTML(m.Colour || defaultMilestoneColour)}</select>
        <input type="text" class="form-control sf-ms-offset" value="${Esc(FormatDuration(m.Offset))}" placeholder="MM:SS" />
        <input type="text" class="form-control sf-ms-label" value="${Esc(m.Label || '')}" placeholder="Milestone label" />
        <button type="button" class="sf-icon-btn text-danger sf-ms-remove" data-index="${i}"><i class="bi bi-x-lg"></i></button>
      </div>`
    ).join('');

    editorPanel.innerHTML = `
      <div class="sf-editor-header">
        <h5 class="mb-0">${draft.SceneID ? 'Edit Scene' : 'New Scene'}</h5>
        <button type="button" class="btn btn-sm sf-icon-btn sf-editor-close"><i class="bi bi-x-lg"></i></button>
      </div>
      <div class="sf-editor-body">
        <div class="sf-field">
          <label>Label <span class="sf-required">*</span></label>
          <input type="text" class="form-control" id="SF_SCENE_LABEL" value="${Esc(draft.Label)}" placeholder="Scene name" />
        </div>
        <div class="sf-field">
          <label>Duration (optional)</label>
          <input type="text" class="form-control" id="SF_SCENE_DURATION" value="${draft.Duration != null ? Esc(FormatDuration(draft.Duration)) : ''}" placeholder="MM:SS or seconds" />
        </div>
        <div class="sf-field">
          <label>Milestones</label>
          <div class="sf-muted sf-sm" style="margin-bottom:6px;">Timestamps within the scene, shown as coloured markers on the progress bar.</div>
          <div id="SF_SCENE_MILESTONES">${milestonesHTML || '<div class="sf-muted sf-sm">No milestones.</div>'}</div>
          <div class="sf-add-row">
            <button type="button" class="btn btn-sm btn-light" id="SF_SCENE_MS_ADD"><i class="bi bi-plus-lg"></i> Add milestone</button>
          </div>
        </div>
        <div class="sf-field-row">
          <div class="sf-field">
            <label>Scene icon <span class="sf-required">*</span></label>
            ${SceneIconMarkup}
          </div>
        </div>
        <div class="sf-field">
          <label>Scene colour <span class="sf-required">*</span></label>
          <select class="form-select" id="SF_SCENE_COLOUR_SELECT">${sceneColourOptions}</select>
        </div>
        <div class="sf-field-row">
          <div class="sf-field">
            <label>Chat room</label>
            <div class="form-check form-switch" style="padding-top:6px;">
              <input class="form-check-input" type="checkbox" id="SF_SCENE_CHATROOM" ${draft.HasChatRoom ? 'checked' : ''} />
              <label class="form-check-label" for="SF_SCENE_CHATROOM">Enable chat room for this scene</label>
            </div>
          </div>
          <div class="sf-field">
            <label>Max groups (optional)</label>
            <input type="number" min="1" step="1" class="form-control" id="SF_SCENE_MAX_GROUPS" value="${draft.MaxGroups != null ? Esc(String(draft.MaxGroups)) : ''}" placeholder="Unlimited" />
          </div>
        </div>
      </div>
      <div class="sf-editor-footer">
        <button type="button" class="btn btn-light sf-editor-close">Cancel</button>
        <button type="button" class="btn btn-success" id="SF_SCENE_SAVE">Save</button>
      </div>`;

    if (window.ShowTrakIconPicker && typeof window.ShowTrakIconPicker.mount === 'function') {
      window.ShowTrakIconPicker.mount({
        inputId: 'SF_SCENE_ICON',
        previewId: 'SF_SCENE_ICON_PREVIEW',
        panelId: 'SF_SCENE_ICON_PANEL',
        searchId: 'SF_SCENE_ICON_SEARCH',
        listId: 'SF_SCENE_ICON_LIST',
      });
    }
    $('#SF_SCENE_ICON_PREVIEW').css('color', $('#SF_SCENE_COLOUR_SELECT').val() || draft.Colour);
    $('#SF_SCENE_COLOUR_SELECT')
      .off('change.scenecolourpreview')
      .on('change.scenecolourpreview', function () {
        $('#SF_SCENE_ICON_PREVIEW').css('color', $(this).val());
      });
  }

  // Read current milestone inputs back into the draft (before a re-render).
  function CollectSceneDraft() {
    if (!SceneDraft) return;
    SceneDraft.Label = $('#SF_SCENE_LABEL').val().trim();
    SceneDraft._durationRaw = $('#SF_SCENE_DURATION').val();
    SceneDraft.Icon = $('#SF_SCENE_ICON').val().trim();
    SceneDraft.Colour = String($('#SF_SCENE_COLOUR_SELECT').val() || '').trim();
    SceneDraft.HasChatRoom = !!$('#SF_SCENE_CHATROOM').prop('checked');
    SceneDraft._maxGroupsRaw = $('#SF_SCENE_MAX_GROUPS').val();
    const rows = [];
    $('#SF_SCENE_MILESTONES .sf-milestone-row').each(function () {
      rows.push({
        Label: $(this).find('.sf-ms-label').val().trim(),
        _offsetRaw: $(this).find('.sf-ms-offset').val(),
        Colour: $(this).find('.sf-ms-colour-select').val(),
      });
    });
    SceneDraft.Milestones = rows.map((r) => ({
      Label: r.Label,
      Offset: ParseTimeInput(r._offsetRaw),
      Colour: r.Colour,
    }));
  }

  async function SaveSceneEditor() {
    CollectSceneDraft();
    if (!SceneDraft.Label) {
      ToastError('Scene label is required');
      return;
    }
    let Duration = null;
    if (SceneDraft._durationRaw && SceneDraft._durationRaw.trim()) {
      Duration = ParseTimeInput(SceneDraft._durationRaw);
      if (Number.isNaN(Duration)) {
        ToastError('Duration must be MM:SS or a number of seconds');
        return;
      }
    }
    if (!SceneDraft.Icon || !SceneDraft.Colour) {
      ToastError('Scene icon and colour are required');
      return;
    }
    let MaxGroups = null;
    if (SceneDraft._maxGroupsRaw != null && String(SceneDraft._maxGroupsRaw).trim()) {
      const parsed = Number(SceneDraft._maxGroupsRaw);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        ToastError('Max groups must be a positive whole number');
        return;
      }
      MaxGroups = parsed;
    }
    const Milestones = [];
    for (const m of SceneDraft.Milestones) {
      if (m.Offset == null || Number.isNaN(m.Offset)) {
        ToastError('Each milestone needs a valid MM:SS offset');
        return;
      }
      Milestones.push({ Label: m.Label, Offset: m.Offset, Colour: m.Colour });
    }
    const payload = {
      Label: SceneDraft.Label,
      Duration,
      Icon: SceneDraft.Icon,
      Colour: SceneDraft.Colour,
      HasChatRoom: !!SceneDraft.HasChatRoom,
      MaxGroups,
      Milestones,
    };
    const fn = SceneDraft.SceneID
      ? window.API.UpdateScene(SceneDraft.SceneID, payload)
      : window.API.CreateScene(payload);
    const [Err] = (await fn) || [];
    if (Err) return ToastError(Err);
    CloseOverlay();
  }

  function BuildDuplicatedScenePayload(scene) {
    const milestones = Array.isArray(scene && scene.Milestones)
      ? scene.Milestones.map((m) => ({
          Label: m && m.Label != null ? String(m.Label) : '',
          Offset: Number(m && m.Offset),
          Colour: m && m.Colour ? String(m.Colour) : DefaultShowColour(),
        }))
      : [];

    return {
      Label: scene && scene.Label ? String(scene.Label) : 'Scene',
      Duration: scene && scene.Duration != null ? Number(scene.Duration) : null,
      Icon: scene && scene.Icon ? String(scene.Icon) : 'chat-left-text-fill',
      Colour: scene && scene.Colour ? String(scene.Colour) : DefaultShowColour(),
      HasChatRoom: !!(scene && scene.HasChatRoom),
      MaxGroups:
        scene && scene.MaxGroups != null && Number.isInteger(Number(scene.MaxGroups))
          ? Number(scene.MaxGroups)
          : null,
      Milestones: milestones.filter((m) => Number.isFinite(m.Offset) && m.Offset >= 0),
    };
  }

  // ---- Flag definition editor ----
  function OpenFlagEditor(flag) {
    const isEdit = !!flag;
    const InitialIcon = flag ? flag.Icon : 'flag';
    const InitialColour = flag && flag.Colour ? flag.Colour : DefaultShowColour();
    const ColourOptions = BuildShowColourOptionsHTML(InitialColour);
    const IconPickerMarkup =
      window.ShowTrakIconPicker && typeof window.ShowTrakIconPicker.createMarkup === 'function'
        ? window.ShowTrakIconPicker.createMarkup({
            inputId: 'SF_FLAG_ICON',
            previewId: 'SF_FLAG_PREVIEW',
            panelId: 'SF_FLAG_ICON_PANEL',
            searchId: 'SF_FLAG_ICON_SEARCH',
            listId: 'SF_FLAG_ICON_LIST',
            value: InitialIcon,
          })
        : `
          <div class="sf-colour-input">
            <span class="sf-flag-preview"><i class="bi bi-${Esc(InitialIcon)}" id="SF_FLAG_PREVIEW"></i></span>
            <input type="text" class="form-control" id="SF_FLAG_ICON" value="${Esc(InitialIcon)}" placeholder="e.g. flag, star, exclamation-triangle" />
          </div>`;
    EnsureEditorElement();
    const editorPanel = document.getElementById('SF_EDITOR_PANEL');
    editorPanel.className = 'sf-editor-panel sf-editor-panel--flag';
    editorPanel.innerHTML = `
      <div class="sf-editor-header">
        <h5 class="mb-0">${isEdit ? 'Edit Flag' : 'New Flag'}</h5>
        <button type="button" class="btn btn-sm sf-icon-btn sf-editor-close"><i class="bi bi-x-lg"></i></button>
      </div>
      <div class="sf-editor-body">
        <div class="sf-field">
          <label>Label <span class="sf-required">*</span></label>
          <input type="text" class="form-control" id="SF_FLAG_LABEL" value="${Esc(flag ? flag.Label : '')}" placeholder="Flag label" />
        </div>
        <div class="sf-field">
          <label>Bootstrap Icon name <span class="sf-required">*</span></label>
          ${IconPickerMarkup}
          <div class="sf-muted sf-sm">Find names at icons.getbootstrap.com (omit the <code>bi-</code> prefix).</div>
        </div>
        <div class="sf-field">
          <label>Flag colour <span class="sf-required">*</span></label>
          <select class="form-select" id="SF_FLAG_COLOUR_SELECT">${ColourOptions}</select>
        </div>
      </div>
      <div class="sf-editor-footer">
        <button type="button" class="btn btn-light sf-editor-close">Cancel</button>
        <button type="button" class="btn btn-success" id="SF_FLAG_SAVE">Save</button>
      </div>`;
    OpenOverlay();

    if (window.ShowTrakIconPicker && typeof window.ShowTrakIconPicker.mount === 'function') {
      window.ShowTrakIconPicker.mount({
        inputId: 'SF_FLAG_ICON',
        previewId: 'SF_FLAG_PREVIEW',
        panelId: 'SF_FLAG_ICON_PANEL',
        searchId: 'SF_FLAG_ICON_SEARCH',
        listId: 'SF_FLAG_ICON_LIST',
      });
    } else {
      // Fallback preview update when the shared picker module is unavailable.
      $('#SF_FLAG_ICON')
        .off('input.flagpreview')
        .on('input.flagpreview', function () {
          const name = $(this).val().trim() || 'flag';
          $('#SF_FLAG_PREVIEW').attr('class', `bi bi-${name}`);
        });
    }

    $('#SF_FLAG_PREVIEW').css('color', $('#SF_FLAG_COLOUR_SELECT').val() || InitialColour);
    $('#SF_FLAG_COLOUR_SELECT')
      .off('change.flagcolour')
      .on('change.flagcolour', function () {
        $('#SF_FLAG_PREVIEW').css('color', $(this).val());
      });

    $('#SF_FLAG_SAVE')
      .off('click.flagsave')
      .on('click.flagsave', async () => {
        const Label = $('#SF_FLAG_LABEL').val().trim();
        const Icon = $('#SF_FLAG_ICON').val().trim();
        const Colour = String($('#SF_FLAG_COLOUR_SELECT').val() || '').trim();
        if (!Label || !Icon || !Colour) {
          ToastError('Label, icon, and colour are required');
          return;
        }
        const fn = isEdit
          ? window.API.UpdateFlag(flag.FlagID, { Label, Icon, Colour })
          : window.API.CreateFlag({ Label, Icon, Colour });
        const [Err] = (await fn) || [];
        if (Err) return ToastError(Err);
        CloseOverlay();
      });
  }

  // ---- Lightweight text prompt ----
  function PromptText(title, placeholder, initial) {
    return new Promise((resolve) => {
      EnsureEditorElement();
      const editorPanel = document.getElementById('SF_EDITOR_PANEL');
      editorPanel.className = 'sf-editor-panel';
      editorPanel.innerHTML = `
        <div class="sf-editor-header">
          <h5 class="mb-0">${Esc(title)}</h5>
          <button type="button" class="btn btn-sm sf-icon-btn" id="SF_PROMPT_CANCEL"><i class="bi bi-x-lg"></i></button>
        </div>
        <div class="sf-editor-body">
          <div class="sf-field">
            <input type="text" class="form-control" id="SF_PROMPT_INPUT" value="${Esc(initial || '')}" placeholder="${Esc(placeholder || '')}" />
          </div>
        </div>
        <div class="sf-editor-footer">
          <button type="button" class="btn btn-light" id="SF_PROMPT_CANCEL2">Cancel</button>
          <button type="button" class="btn btn-success" id="SF_PROMPT_OK">Save</button>
        </div>`;
      OpenOverlay();
      const input = document.getElementById('SF_PROMPT_INPUT');
      input.focus();
      input.select();
      const done = (value) => {
        $('#SF_EDITOR_OVERLAY').removeClass('open');
        resolve(value);
      };
      $('#SF_PROMPT_OK').on('click', () => done(input.value.trim() || null));
      $('#SF_PROMPT_CANCEL, #SF_PROMPT_CANCEL2').on('click', () => done(null));
      $(input).on('keydown', (e) => {
        if (e.key === 'Enter') done(input.value.trim() || null);
        if (e.key === 'Escape') done(null);
      });
    });
  }

  // ============================================================
  // Group advancement (queue -> scene -> done)
  // ============================================================
  function BuildQueueOrderForFirstSceneInsert(instanceID, firstSceneID) {
    const movedID = Number(instanceID);
    const firstID = Number(firstSceneID);
    if (!Number.isInteger(movedID) || movedID <= 0) return [];
    if (!Number.isInteger(firstID) || firstID <= 0) return [];

    const items = Array.isArray(QueueCache) ? QueueCache : [];
    const currentIDs = items
      .map((item) => Number(item.InstanceID))
      .filter((id) => Number.isInteger(id) && id > 0);

    const firstSceneExisting = items
      .filter(
        (item) =>
          item.Location === 'SCENE' &&
          Number(item.SceneID) === firstID &&
          Number(item.InstanceID) !== movedID
      )
      .map((item) => Number(item.InstanceID));

    const otherSceneIDs = items
      .filter(
        (item) =>
          item.Location === 'SCENE' &&
          Number(item.SceneID) !== firstID &&
          Number(item.InstanceID) !== movedID
      )
      .map((item) => Number(item.InstanceID));

    const desiredSceneIDs = [movedID, ...firstSceneExisting, ...otherSceneIDs];

    return currentIDs.map((id) => {
      const item = items.find((q) => Number(q.InstanceID) === id);
      const isSceneAfterMove = id === movedID || (item && item.Location === 'SCENE');
      if (!isSceneAfterMove) return id;
      return desiredSceneIDs.shift() || id;
    });
  }

  async function SendToFirstScene(instanceID, options) {
    const opts = options || {};
    const first = ScenesCache[0];
    if (!first) {
      ToastError('Add a scene first');
      return;
    }
    const [Err] = (await window.API.SetQueueLocation(instanceID, 'SCENE', first.SceneID)) || [];
    if (Err) {
      ToastError(Err);
      return;
    }

    if (opts.insertAtStart) {
      const orderedIDs = BuildQueueOrderForFirstSceneInsert(instanceID, first.SceneID);
      if (orderedIDs.length) {
        const [OrderErr] = (await window.API.SetQueueOrder(orderedIDs)) || [];
        if (OrderErr) ToastError(OrderErr);
      }
    }
  }

  // ============================================================
  // Event wiring (delegated)
  // ============================================================
  function WireEvents() {
    // ---- Scenes ----
    // "Create Scene" entry in the bottom-bar plus (+) menu.
    $(document).on('click', '#SF_CREATE_SCENE_BTN', () => OpenSceneEditor(null));
    $(document).on('click', '.sf-scene-edit', function () {
      const id = Number($(this).attr('data-id'));
      OpenSceneEditor(ScenesCache.find((s) => s.SceneID === id) || null);
    });
    $(document).on('click', '.sf-scene-duplicate', async function () {
      const id = Number($(this).attr('data-id'));
      const source = ScenesCache.find((s) => Number(s.SceneID) === id);
      if (!source) {
        ToastError('Scene not found');
        return;
      }
      const [Err] = (await window.API.CreateScene(BuildDuplicatedScenePayload(source))) || [];
      if (Err) ToastError(Err);
    });
    $(document).on('click', '.sf-scene-delete', async function () {
      const id = Number($(this).attr('data-id'));
      const ok = await ConfirmationDialog('Delete this scene?');
      if (!ok) return;
      const [Err] = (await window.API.DeleteScene(id)) || [];
      if (Err) ToastError(Err);
    });
    $(document).on('click', '.sf-scene-start', function () {
      const sceneID = Number($(this).attr('data-id'));
      if (!Number.isInteger(sceneID) || sceneID <= 0) return;
      StartSceneTimer(sceneID);
    });
    $(document).on('click', '.sf-scene-chat', async function (e) {
      e.stopPropagation();
      const sceneID = Number($(this).attr('data-scene-id'));
      if (!Number.isInteger(sceneID) || sceneID <= 0) return;
      const room = (ChatRoomsCache || []).find(
        (r) => String(r.RoomType || '').toUpperCase() === 'SCENE' && Number(r.RoomID) === sceneID
      );
      if (!room) {
        ToastError('Scene chat room is not available yet');
        return;
      }
      ActiveChatRoomKey = ChatRoomKey('SCENE', sceneID);
      ChatViewMode = 'room';
      await LoadActiveChatMessages();
      RenderChatPanel();
      const chatButton = document.querySelector('.app-side-icon-btn[data-side-menu="chat"]');
      if (chatButton && !chatButton.classList.contains('active')) {
        chatButton.click();
      }
    });

    // Scene group chip controls
    $(document).on('click', '.sf-sg-chat', function (e) {
      e.stopPropagation();
      const $chip = $(this).closest('.sf-scene-group');
      const groupID = Number($chip.data('id'));
      AcknowledgedNotes.add(groupID);
      $(this).removeClass('has-unread');
      $('.sf-scene-group').not($chip).removeClass('notes-open');
      $chip.toggleClass('notes-open');
      OpenSceneNotesGroupID = $chip.hasClass('notes-open') ? groupID : null;
    });
    $(document).on('click', () => {
      OpenSceneNotesGroupID = null;
      $('.sf-scene-group').removeClass('notes-open');
    });
    $(document).on('click', '.sf-scene-group', (e) => e.stopPropagation());

    $(document).on('click', '.sf-sg-edit', function (e) {
      e.stopPropagation();
      const id = Number($(this).closest('.sf-scene-group').data('id'));
      const item = QueueCache.find((g) => g.InstanceID === id);
      if (!item) return;
      OpenGroupEditor(item, {
        title: 'Edit Group',
        onSave: async (payload) => {
          const [Err] = (await window.API.UpdateQueueGroup(id, payload)) || [];
          if (Err) {
            ToastError(Err);
            return false;
          }
          return true;
        },
      });
    });

    // ---- Scene editor ----
    $(document).on('click', '#SF_SCENE_SAVE', SaveSceneEditor);
    $(document).on('click', '#SF_SCENE_MS_ADD', () => {
      if (!SceneDraft) return;
      CollectSceneDraft();
      SceneDraft.Milestones.push({ Label: '', Offset: 0, Colour: DefaultShowColour() });
      RenderSceneEditor();
    });
    $(document).on('click', '.sf-ms-remove', function () {
      if (!SceneDraft) return;
      const idx = Number($(this).attr('data-index'));
      CollectSceneDraft();
      SceneDraft.Milestones.splice(idx, 1);
      RenderSceneEditor();
    });

    // ---- Queue ----
    $(document).on('click', '.sf-queue-add', () => {
      OpenGroupEditor(null, {
        title: 'Add Queue Group',
        onSave: async (payload) => {
          if (!payload.GroupID) payload.GroupID = `Q${Date.now().toString(36)}`;
          const [Err] = (await window.API.AddQueueGroup(payload)) || [];
          if (Err) {
            ToastError(Err);
            return false;
          }
          return true;
        },
      });
    });
    $(document).on('click', '.sf-queue-loadflow', async () => {
      const id = Number($('#SF_QUEUE_FLOW_SELECT').val());
      if (!id) return;
      const ok = await ConfirmationDialog(
        'Load this flow into the queue? This replaces the current queue.'
      );
      if (!ok) return;
      const [Err] = (await window.API.LoadFlowIntoQueue(id)) || [];
      if (Err) ToastError(Err);
    });
    $(document).on('click', '.sf-queue-reset', async () => {
      const ok = await ConfirmationDialog('Reset the Active Show? This clears the entire queue.');
      if (!ok) return;
      const [Err] = (await window.API.ResetQueue()) || [];
      if (Err) ToastError(Err);
    });
    $(document).on('click', '.sf-queue-start', function () {
      const id = Number($(this).closest('.sf-row').data('id'));
      SendToFirstScene(id);
    });
    $(document).on('click', '.sf-queue-loadnext', function () {
      const upcoming = (QueueCache || []).filter((g) => g.Location === 'QUEUE');
      if (!upcoming.length) return;
      SendToFirstScene(Number(upcoming[0].InstanceID), { insertAtStart: true });
    });
    $(document).on('click', '.sf-queue-edit', function () {
      const id = Number($(this).attr('data-id'));
      const item = QueueCache.find((g) => g.InstanceID === id);
      if (!item) return;
      OpenGroupEditor(item, {
        title: 'Edit Queue Group',
        onSave: async (payload) => {
          const [Err] = (await window.API.UpdateQueueGroup(id, payload)) || [];
          if (Err) {
            ToastError(Err);
            return false;
          }
          return true;
        },
      });
    });
    $(document).on('click', '.sf-queue-delete', async function () {
      const id = Number($(this).attr('data-id'));
      const ok = await ConfirmationDialog('Remove this group from the queue?');
      if (!ok) return;
      const [Err] = (await window.API.DeleteQueueGroup(id)) || [];
      if (Err) ToastError(Err);
    });

    // ---- Flows ----
    $(document).on('click', '.sf-flow-create', async () => {
      const label = await PromptText('New Flow', 'Flow name');
      if (!label) return;
      const [Err] = (await window.API.CreateFlow({ Label: label })) || [];
      if (Err) ToastError(Err);
    });
    $(document).on('click', '.sf-flow-open', function () {
      State.flowID = Number($(this).attr('data-id'));
      RenderFlowsPanel();
    });
    $(document).on('click', '.sf-flow-edit', async function (e) {
      e.stopPropagation();
      const id = Number($(this).attr('data-id'));
      const flow = FlowsCache.find((f) => f.FlowID === id);
      const label = await PromptText('Rename Flow', 'Flow name', flow ? flow.Label : '');
      if (!label) return;
      const [Err] = (await window.API.UpdateFlow(id, { Label: label })) || [];
      if (Err) ToastError(Err);
    });
    $(document).on('click', '.sf-flow-delete', async function (e) {
      e.stopPropagation();
      const id = Number($(this).attr('data-id'));
      const ok = await ConfirmationDialog('Delete this flow and all its groups?');
      if (!ok) return;
      const [Err] = (await window.API.DeleteFlow(id)) || [];
      if (Err) ToastError(Err);
    });
    $(document).on('click', '.sf-flow-load', async function (e) {
      e.stopPropagation();
      const id = Number($(this).attr('data-id'));
      const ok = await ConfirmationDialog(
        'Load this flow into the queue? This replaces the current queue.'
      );
      if (!ok) return;
      const [Err] = (await window.API.LoadFlowIntoQueue(id)) || [];
      if (Err) return ToastError(Err);
      if (typeof Notify === 'function') Notify('Flow loaded into queue.', 'success');
    });
    $(document).on('click', '#SF_FLOW_BACK', () => {
      State.flowID = null;
      RenderFlowsPanel();
    });

    // ---- Flow groups ----
    $(document).on('click', '.sf-group-create', () => {
      OpenGroupEditor(null, {
        title: 'New Group',
        onSave: async (payload) => {
          const FlowID = Number(State.flowID);
          if (!Number.isInteger(FlowID) || FlowID <= 0) {
            ToastError('Open a flow before adding a group');
            return false;
          }
          try {
            const [Err] = (await window.API.CreateFlowGroup(FlowID, payload)) || [];
            if (Err) {
              ToastError(Err);
              return false;
            }
            // Force an immediate sidebar refresh instead of waiting for the
            // async broadcast roundtrip so the new row appears right away.
            const FreshGroups = await window.API.GetFlowGroups(FlowID);
            FlowGroupsCache = Array.isArray(FreshGroups) ? FreshGroups : [];
            RenderFlowsPanel();
            return true;
          } catch (err) {
            ToastError(err);
            return false;
          }
        },
      });
    });
    $(document).on('click', '.sf-group-edit', function () {
      const id = Number($(this).attr('data-id'));
      const item = FlowGroupsCache.find((g) => g.RowID === id);
      if (!item) return;
      OpenGroupEditor(item, {
        title: 'Edit Group',
        onSave: async (payload) => {
          const [Err] = (await window.API.UpdateFlowGroup(id, payload)) || [];
          if (Err) {
            ToastError(Err);
            return false;
          }
          RenderFlowsPanel();
          return true;
        },
      });
    });
    $(document).on('click', '.sf-group-delete', async function () {
      const id = Number($(this).attr('data-id'));
      const ok = await ConfirmationDialog('Delete this group?');
      if (!ok) return;
      const [Err] = (await window.API.DeleteFlowGroup(id)) || [];
      if (Err) ToastError(Err);
      else RenderFlowsPanel();
    });

    // ---- Show Settings flags ----
    $(document).on('click', '.sf-flag-create', () => OpenFlagEditor(null));
    $(document).on('click', '.sf-flag-edit', function () {
      const id = Number($(this).attr('data-id'));
      OpenFlagEditor(FlagsCache.find((f) => f.FlagID === id) || null);
    });
    $(document).on('click', '.sf-flag-delete', async function () {
      const id = Number($(this).attr('data-id'));
      const ok = await ConfirmationDialog('Delete this flag definition?');
      if (!ok) return;
      const [Err] = (await window.API.DeleteFlag(id)) || [];
      if (Err) ToastError(Err);
    });

    // ---- Show Settings remote users ----
    $(document).on('click', '.sf-ru-create', () => OpenRemoteUserEditor(null));
    $(document).on('click', '.sf-ru-edit', function () {
      const id = Number($(this).attr('data-id'));
      OpenRemoteUserEditor(RemoteUsersCache.find((u) => u.RemoteUserID === id) || null);
    });
    $(document).on('click', '.sf-ru-delete', async function () {
      const id = Number($(this).attr('data-id'));
      const ok = await ConfirmationDialog('Delete this remote user?');
      if (!ok) return;
      const [Err] = (await window.API.DeleteRemoteUser(id)) || [];
      if (Err) ToastError(Err);
    });

    // ---- Show Settings custom chat rooms ----
    $(document).on('click', '.sf-ccr-create', () => OpenCustomChatRoomEditor(null));
    $(document).on('click', '.sf-ccr-edit', function () {
      const id = Number($(this).attr('data-id'));
      const room = (ChatRoomsCache || []).find((r) => r.RoomType === 'CUSTOM' && Number(r.RoomID) === id);
      OpenCustomChatRoomEditor(room || null);
    });
    $(document).on('click', '.sf-ccr-delete', async function () {
      const id = Number($(this).attr('data-id'));
      const ok = await ConfirmationDialog('Delete this custom chat room?');
      if (!ok) return;
      const [Err] = (await window.API.DeleteCustomChatRoom(id)) || [];
      if (Err) ToastError(Err);
    });

    // ---- Chat panel ----
    $(document).on('click', '.sf-chat-room-card', async function () {
      const roomType = String($(this).attr('data-room-type') || '').toUpperCase();
      const roomID = Number($(this).attr('data-room-id'));
      if (!roomType || !Number.isInteger(roomID) || roomID <= 0) return;
      ActiveChatRoomKey = ChatRoomKey(roomType, roomID);
      ChatViewMode = 'room';
      await LoadActiveChatMessages();
      RenderChatPanel();
    });
    $(document).on('click', '#SF_CHAT_BACK', function () {
      ChatViewMode = 'list';
      RenderChatPanel();
    });
    $(document).on('click', '#SF_CHAT_SEND', async () => {
      if (!ActiveChatRoomKey) return;
      const input = $('#SF_CHAT_INPUT');
      const message = input.val().trim();
      if (!message) return;
      const [roomType, roomIDRaw] = ActiveChatRoomKey.split(':');
      const roomID = Number(roomIDRaw);
      const [Err] = (await window.API.SendChatMessage(roomType, roomID, message)) || [];
      if (Err) return ToastError(Err);
      input.val('');
      await LoadActiveChatMessages();
    });
    $(document).on('keydown', '#SF_CHAT_INPUT', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        $('#SF_CHAT_SEND').trigger('click');
      }
    });

    // ---- Show Settings show colours ----
    $(document).on('click', '.sf-sc-create', () => OpenShowColourEditor(null));
    $(document).on('click', '.sf-sc-edit', function () {
      const id = Number($(this).attr('data-id'));
      OpenShowColourEditor(ShowColoursCache.find((c) => c.ShowColourID === id) || null);
    });
    $(document).on('click', '.sf-sc-delete', async function () {
      const id = Number($(this).attr('data-id'));
      if ((ShowColoursCache || []).length <= 1) {
        ToastError('At least one show colour is required');
        return;
      }
      const ok = await ConfirmationDialog('Delete this show colour?');
      if (!ok) return;
      const [Err] = (await window.API.DeleteShowColour(id)) || [];
      if (Err) ToastError(Err);
    });
    $(document).on('click', '.sf-sc-reset', async function () {
      const ok = await ConfirmationDialog('Reset show colours to defaults? This removes custom colours.');
      if (!ok) return;
      const [Err] = (await window.API.ResetShowColoursToDefaults()) || [];
      if (Err) ToastError(Err);
    });

    // ---- Group editor overlay (shared) ----
    $(document).on('click', '.sf-editor-close', CloseOverlay);
    $(document).on('click', '#SF_ED_SAVE', SaveGroupEditor);
    $(document).on('click', '#SF_ED_NOTE_ADD', () => {
      const input = $('#SF_ED_NOTE_INPUT');
      const msg = input.val().trim();
      if (!msg || !EditorDraft) return;
      CollectGroupDraft();
      EditorDraft.Notes.push({ Message: msg, Timestamp: Date.now(), AuthorID: 0 });
      ReRenderGroupEditor();
    });
    $(document).on('keydown', '#SF_ED_NOTE_INPUT', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        $('#SF_ED_NOTE_ADD').trigger('click');
      }
    });
    $(document).on('click', '.sf-note-remove', function () {
      const idx = Number($(this).attr('data-index'));
      if (!EditorDraft) return;
      CollectGroupDraft();
      EditorDraft.Notes.splice(idx, 1);
      ReRenderGroupEditor();
    });
    $(document).on('click', '#SF_ED_FLAG_ADD', () => {
      if (!EditorDraft) return;
      const flagID = Number($('#SF_ED_FLAG_SELECT').val());
      const flag = FlagsCache.find((f) => f.FlagID === flagID);
      if (!flag) return;
      const comment = $('#SF_ED_FLAG_COMMENT').val().trim();
      CollectGroupDraft();
      EditorDraft.Flags.push({
        DefinitionID: flag.FlagID,
        Label: flag.Label,
        Icon: flag.Icon,
        Colour: flag.Colour || '#F4C453',
        Comment: comment || null,
        Timestamp: Date.now(),
        AuthorID: 0,
      });
      ReRenderGroupEditor();
    });
    $(document).on('click', '.sf-flag-remove', function () {
      const idx = Number($(this).attr('data-index'));
      if (!EditorDraft) return;
      CollectGroupDraft();
      EditorDraft.Flags.splice(idx, 1);
      ReRenderGroupEditor();
    });
  }

  // ============================================================
  // Subscriptions + init
  // ============================================================
  function WireSubscriptions() {
    window.API.OnSceneList((scenes) => {
      ScenesCache = Array.isArray(scenes) ? scenes : [];
      RenderScenes();
    });
    window.API.OnQueue((queue) => {
      QueueCache = Array.isArray(queue) ? queue : [];
      RenderScenes();
      RenderQueuePanel();
    });
    window.API.OnFlowList((flows) => {
      FlowsCache = Array.isArray(flows) ? flows : [];
      RenderFlowsPanel();
      RenderQueuePanel();
    });
    window.API.OnFlowGroupsChanged((flowID) => {
      if (State.flowID === Number(flowID)) RenderFlowsPanel();
    });
    window.API.OnFlagList((flags) => {
      FlagsCache = Array.isArray(flags) ? flags : [];
      RenderSettingsPanel();
    });
    window.API.OnRemoteUserList((users) => {
      RemoteUsersCache = Array.isArray(users) ? users : [];
      RenderSettingsPanel();
    });
    window.API.OnShowColourList((showColours) => {
      ShowColoursCache = Array.isArray(showColours) ? showColours : [];
      RenderSettingsPanel();
    });
    window.API.OnChatRoomList(async (rooms) => {
      ChatRoomsCache = Array.isArray(rooms) ? rooms : [];
      await EnsureActiveChatRoom();
      RenderChatPanel();
      RenderSettingsPanel();
    });
    window.API.OnChatMessagesChanged(async (payload) => {
      if (!payload || !ActiveChatRoomKey) return;
      const key = ChatRoomKey(payload.RoomType, payload.RoomID);
      if (key === ActiveChatRoomKey) await LoadActiveChatMessages();
    });
    window.API.OnModeUpdated(() => {
      // Re-render scenes so draggable + edit controls reflect the new mode.
      RenderScenes();
    });
  }

  async function LoadInitialData() {
    try {
      const [flows, queue, scenes, flags, remoteUsers, showColours, chatRooms] = await Promise.all([
        window.API.GetFlows(),
        window.API.GetQueue(),
        window.API.GetScenes(),
        window.API.GetFlags(),
        window.API.GetRemoteUsers(),
        window.API.GetShowColours(),
        window.API.GetChatRooms(),
      ]);
      FlowsCache = Array.isArray(flows) ? flows : [];
      QueueCache = Array.isArray(queue) ? queue : [];
      ScenesCache = Array.isArray(scenes) ? scenes : [];
      FlagsCache = Array.isArray(flags) ? flags : [];
      RemoteUsersCache = Array.isArray(remoteUsers) ? remoteUsers : [];
      ShowColoursCache = Array.isArray(showColours) ? showColours : [];
      ChatRoomsCache = Array.isArray(chatRooms) ? chatRooms : [];
      await EnsureActiveChatRoom();
    } catch (err) {
      ToastError(err);
    }
    RenderAll();
  }

  async function InitShowFlow() {
    if (!window.API || typeof window.API.GetScenes !== 'function') return;
    WireEvents();
    WireSubscriptions();
    await LoadInitialData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', InitShowFlow);
  } else {
    InitShowFlow();
  }
})();
