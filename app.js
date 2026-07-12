(function () {
  "use strict";

  var PROJECTS_KEY = "archive_projects";
  var NOTES_KEY = "archive_notes";
  var SORT_KEY = "archive_sort";
  var FONTSIZE_KEY = "archive_fontsize";
  var SHELF_COLORS = ["#5C7A72", "#A8785A", "#7A6A9C", "#4B5D3A", "#8A6A4A", "#6B7D8C"];
  var UNDO_TIMEOUT_MS = 6000;

  var state = {
    projects: [],
    notes: [],
    activeProjectId: "all",
    query: "",
    activeTag: null,
    view: "list",
    editingNote: null,
    showNewProject: false,
    confirmDeleteProjectId: null,
    sortBy: "recent",
    fontSize: "medium",
  };

  var pendingUndo = null;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function load() {
    try {
      state.projects = JSON.parse(localStorage.getItem(PROJECTS_KEY) || "[]");
    } catch (e) {
      state.projects = [];
    }
    try {
      state.notes = JSON.parse(localStorage.getItem(NOTES_KEY) || "[]");
    } catch (e) {
      state.notes = [];
    }
    state.sortBy = localStorage.getItem(SORT_KEY) || "recent";
    state.fontSize = localStorage.getItem(FONTSIZE_KEY) || "medium";
    applyFontSizeClass();
  }

  function applyFontSizeClass() {
    document.body.classList.remove("fs-small", "fs-medium", "fs-large");
    document.body.classList.add("fs-" + state.fontSize);
  }

  function persist() {
    try {
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(state.projects));
      localStorage.setItem(NOTES_KEY, JSON.stringify(state.notes));
    } catch (e) {
      alert("저장 공간이 부족해요. 이미지 크기가 큰 노트를 정리하거나 백업 후 지워보세요.");
    }
  }

  function projectById(id) {
    for (var i = 0; i < state.projects.length; i++) {
      if (state.projects[i].id === id) return state.projects[i];
    }
    return null;
  }

  function visibleNotes() {
    var list = state.notes.slice();
    if (state.activeProjectId !== "all") {
      list = list.filter(function (n) { return n.projectId === state.activeProjectId; });
    }
    if (state.activeTag) {
      list = list.filter(function (n) { return (n.tags || []).indexOf(state.activeTag) !== -1; });
    }
    if (state.query.trim()) {
      var q = state.query.trim().toLowerCase();
      list = list.filter(function (n) {
        return (
          n.title.toLowerCase().indexOf(q) !== -1 ||
          n.content.toLowerCase().indexOf(q) !== -1 ||
          (n.tags || []).some(function (t) { return t.toLowerCase().indexOf(q) !== -1; })
        );
      });
    }
    list.sort(function (a, b) {
      if (state.sortBy === "title") {
        return a.title.localeCompare(b.title, "ko");
      }
      if (state.sortBy === "oldest") {
        return (a.updatedAt || 0) - (b.updatedAt || 0);
      }
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    return list;
  }

  function allTags() {
    var set = {};
    state.notes.forEach(function (n) { (n.tags || []).forEach(function (t) { set[t] = true; }); });
    return Object.keys(set).sort();
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function renderList() {
    var app = document.getElementById("app");
    app.innerHTML = "";

    var wrap = el("div", "wrap");

    var header = el("div", "header");
    header.appendChild(el("div", "eyebrow", "PERSONAL ARCHIVE"));
    header.appendChild(el("h1", "h1 font-display", "자료 서가"));
    wrap.appendChild(header);

    var searchWrap = el("div", "search-wrap");
    var searchIcon = el("span", "search-icon", "\uD83D\uDD0D");
    var searchInput = el("input", "search-input");
    searchInput.type = "text";
    searchInput.placeholder = "제목, 내용, 태그 검색";
    searchInput.value = state.query;
    searchInput.addEventListener("input", function (e) {
      state.query = e.target.value;
      renderNoteGridOnly();
    });
    searchWrap.appendChild(searchIcon);
    searchWrap.appendChild(searchInput);
    wrap.appendChild(searchWrap);

    var shelfRow = el("div", "shelf-row");
    shelfRow.id = "shelf-row";
    wrap.appendChild(shelfRow);
    renderShelfRow(shelfRow);

    if (state.showNewProject) {
      var npRow = el("div", "new-project-row");
      var npInput = el("input", "new-project-input");
      npInput.type = "text";
      npInput.placeholder = "서가 이름 (예: 소설 설정집)";
      npInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") createProject(npInput.value);
      });
      var npBtn = el("button", "new-project-btn mono", "추가");
      npBtn.addEventListener("click", function () { createProject(npInput.value); });
      npRow.appendChild(npInput);
      npRow.appendChild(npBtn);
      wrap.appendChild(npRow);
      setTimeout(function () { npInput.focus(); }, 0);
    }

    if (state.confirmDeleteProjectId) {
      var cbox = el("div", "confirm-box");
      cbox.appendChild(el("p", "", "이 서가와 안의 메모를 모두 삭제할까요? 되돌릴 수 없어요."));
      var cActions = el("div", "confirm-actions");
      var cCancel = el("button", "confirm-cancel mono", "취소");
      cCancel.addEventListener("click", function () { state.confirmDeleteProjectId = null; renderList(); });
      var cDelete = el("button", "confirm-delete mono", "삭제");
      cDelete.addEventListener("click", function () { deleteProject(state.confirmDeleteProjectId); });
      cActions.appendChild(cCancel);
      cActions.appendChild(cDelete);
      cbox.appendChild(cActions);
      wrap.appendChild(cbox);
    }

    var tags = allTags();
    if (tags.length > 0) {
      var tagRow = el("div", "tag-filter-row");
      tags.forEach(function (t) {
        var chip = el("button", "tag-filter-chip mono" + (state.activeTag === t ? " active" : ""), "#" + t);
        chip.addEventListener("click", function () {
          state.activeTag = state.activeTag === t ? null : t;
          renderList();
        });
        tagRow.appendChild(chip);
      });
      wrap.appendChild(tagRow);
    }

    var sortRow = el("div", "sort-row");
    var sortLabel = el("span", "mono small sort-label", "정렬");
    var sortSelect = document.createElement("select");
    sortSelect.className = "sort-select mono";
    [
      ["recent", "최근 수정순"],
      ["oldest", "오래된순"],
      ["title", "제목순"],
    ].forEach(function (opt) {
      var o = document.createElement("option");
      o.value = opt[0];
      o.textContent = opt[1];
      if (state.sortBy === opt[0]) o.selected = true;
      sortSelect.appendChild(o);
    });
    sortSelect.addEventListener("change", function (e) {
      state.sortBy = e.target.value;
      localStorage.setItem(SORT_KEY, state.sortBy);
      renderNoteGridOnly();
    });
    sortRow.appendChild(sortLabel);
    sortRow.appendChild(sortSelect);
    wrap.appendChild(sortRow);

    var gridHolder = el("div");
    gridHolder.id = "grid-holder";
    wrap.appendChild(gridHolder);

    var fab = el("button", "fab", "<span>&#43;</span> 새 카드");
    fab.addEventListener("click", createNote);
    wrap.appendChild(fab);

    var settingsRow = el("div", "settings-row");
    var exportBtn = el("button", "settings-link mono", "백업 내보내기");
    exportBtn.addEventListener("click", exportBackup);
    var importBtn = el("button", "settings-link mono", "백업 불러오기");
    importBtn.addEventListener("click", triggerImport);
    settingsRow.appendChild(exportBtn);
    settingsRow.appendChild(importBtn);
    wrap.appendChild(settingsRow);

    var fontRow = el("div", "font-size-row");
    fontRow.appendChild(el("span", "mono small sort-label", "글자 크기"));
    var fontGroup = el("div", "font-size-group");
    [
      ["small", "가"],
      ["medium", "가"],
      ["large", "가"],
    ].forEach(function (opt) {
      var btn = el("button", "font-size-btn font-size-btn-" + opt[0] + (state.fontSize === opt[0] ? " active" : ""), opt[1]);
      btn.addEventListener("click", function () {
        state.fontSize = opt[0];
        localStorage.setItem(FONTSIZE_KEY, state.fontSize);
        applyFontSizeClass();
        renderList();
      });
      fontGroup.appendChild(btn);
    });
    fontRow.appendChild(fontGroup);
    wrap.appendChild(fontRow);

    var importInput = el("input");
    importInput.type = "file";
    importInput.accept = "application/json";
    importInput.style.display = "none";
    importInput.id = "import-input";
    importInput.addEventListener("change", handleImportFile);
    wrap.appendChild(importInput);

    app.appendChild(wrap);
    renderNoteGridOnly();
  }

  function renderShelfRow(container) {
    container.innerHTML = "";
    var allTab = el("button", "shelf-tab mono" + (state.activeProjectId === "all" ? " active" : ""), "전체");
    if (state.activeProjectId === "all") allTab.style.background = "#6B6250";
    allTab.addEventListener("click", function () { state.activeProjectId = "all"; renderList(); });
    container.appendChild(allTab);

    state.projects.forEach(function (p) {
      var active = state.activeProjectId === p.id;
      var tab = el("button", "shelf-tab mono" + (active ? " active" : ""), p.name);
      if (active) tab.style.background = p.color;
      else tab.style.color = "var(--muted)";
      tab.addEventListener("click", function () { state.activeProjectId = p.id; renderList(); });
      var pressTimer;
      tab.addEventListener("touchstart", function () { pressTimer = setTimeout(function () { state.confirmDeleteProjectId = p.id; renderList(); }, 550); });
      tab.addEventListener("touchend", function () { clearTimeout(pressTimer); });
      tab.addEventListener("mousedown", function () { pressTimer = setTimeout(function () { state.confirmDeleteProjectId = p.id; renderList(); }, 550); });
      tab.addEventListener("mouseup", function () { clearTimeout(pressTimer); });
      tab.addEventListener("mouseleave", function () { clearTimeout(pressTimer); });
      container.appendChild(tab);
    });

    var newTab = el("button", "shelf-tab new mono", "&#43; 새 서가");
    newTab.addEventListener("click", function () { state.showNewProject = true; renderList(); });
    container.appendChild(newTab);
  }

  function renderNoteGridOnly() {
    var holder = document.getElementById("grid-holder");
    if (!holder) return;
    holder.innerHTML = "";
    var notes = visibleNotes();

    if (notes.length === 0) {
      var empty = el("div", "empty-state");
      empty.appendChild(el("div", "empty-title mono", "서가가 비어있어요"));
      empty.appendChild(el("div", "empty-sub", "첫 카드를 채워볼까요?"));
      holder.appendChild(empty);
      return;
    }

    var grid = el("div", "note-grid");
    notes.forEach(function (n) {
      var proj = projectById(n.projectId);
      var card = el("button", "note-card");
      var cover = el("div", "note-cover");
      if (n.cover) {
        var img = document.createElement("img");
        img.src = n.cover;
        cover.appendChild(img);
      } else {
        cover.appendChild(el("span", "note-cover-placeholder", "\uD83D\uDDBC"));
      }
      card.appendChild(cover);

      var body = el("div", "note-body");
      if (proj) {
        var projTag = el("span", "note-project mono", proj.name);
        projTag.style.color = proj.color;
        body.appendChild(projTag);
      }
      body.appendChild(el("div", "note-title font-display", n.title || "제목 없음"));
      if (n.tags && n.tags.length) {
        var tagsRow = el("div", "note-tags");
        n.tags.slice(0, 3).forEach(function (t) {
          tagsRow.appendChild(el("span", "note-tag mono", "#" + t));
        });
        body.appendChild(tagsRow);
      }
      card.appendChild(body);

      card.addEventListener("click", function () { openEditor(n); });
      grid.appendChild(card);
    });
    holder.appendChild(grid);
  }

  function createProject(name) {
    var trimmed = (name || "").trim();
    if (!trimmed) return;
    var p = { id: uid(), name: trimmed, color: SHELF_COLORS[state.projects.length % SHELF_COLORS.length] };
    state.projects.push(p);
    state.activeProjectId = p.id;
    state.showNewProject = false;
    persist();
    renderList();
  }

  function deleteProject(id) {
    var idx = state.projects.findIndex(function (p) { return p.id === id; });
    if (idx === -1) return;
    var removedProject = state.projects[idx];
    var removedNotes = state.notes.filter(function (n) { return n.projectId === id; });

    state.projects = state.projects.filter(function (p) { return p.id !== id; });
    state.notes = state.notes.filter(function (n) { return n.projectId !== id; });
    if (state.activeProjectId === id) state.activeProjectId = "all";
    state.confirmDeleteProjectId = null;
    persist();
    renderList();

    showUndoToast('"' + removedProject.name + '" 서가를 삭제했어요', function () {
      state.projects.splice(idx, 0, removedProject);
      state.notes = state.notes.concat(removedNotes);
      persist();
      renderList();
    });
  }

  function createNote() {
    var defaultProject = state.activeProjectId !== "all" ? state.activeProjectId : (state.projects[0] ? state.projects[0].id : null);
    var n = { id: uid(), projectId: defaultProject, title: "", cover: null, content: "", tags: [], updatedAt: Date.now() };
    openEditor(n, true);
  }

  function openEditor(note, isNew) {
    state.editingNote = { note: JSON.parse(JSON.stringify(note)), isNew: !!isNew };
    state.view = "editor";
    renderEditor();
  }

  function closeEditor() {
    state.view = "list";
    state.editingNote = null;
    renderList();
  }

  function saveCurrentNote(updated) {
    var exists = state.notes.some(function (n) { return n.id === updated.id; });
    updated.updatedAt = Date.now();
    if (!updated.title.trim()) updated.title = "제목 없음";
    if (exists) {
      state.notes = state.notes.map(function (n) { return n.id === updated.id ? updated : n; });
    } else {
      state.notes.push(updated);
    }
    persist();
    closeEditor();
  }

  function deleteCurrentNote(id) {
    var idx = state.notes.findIndex(function (n) { return n.id === id; });
    if (idx === -1) return;
    var removedNote = state.notes[idx];
    state.notes = state.notes.filter(function (n) { return n.id !== id; });
    persist();
    closeEditor();

    showUndoToast('"' + (removedNote.title || "제목 없음") + '" 카드를 삭제했어요', function () {
      state.notes.splice(idx, 0, removedNote);
      persist();
      renderList();
    });
  }

  function renderEditor() {
    var app = document.getElementById("app");
    app.innerHTML = "";
    var tpl = document.getElementById("tpl-editor");
    var node = tpl.content.cloneNode(true);
    var root = node.querySelector(".min-h");

    var noteState = state.editingNote.note;

    var backBtn = node.querySelector('[data-action="back"]');
    backBtn.addEventListener("click", closeEditor);

    var deleteBtn = node.querySelector('[data-action="delete"]');
    deleteBtn.addEventListener("click", function () {
      deleteCurrentNote(noteState.id);
    });

    var coverBtn = node.querySelector('[data-action="pick-cover"]');
    var coverImg = node.querySelector(".cover-img");
    var coverEmpty = node.querySelector(".cover-empty");
    var coverInput = node.querySelector(".cover-input");
    var removeCoverBtn = node.querySelector('[data-action="remove-cover"]');

    function refreshCover() {
      if (noteState.cover) {
        coverImg.src = noteState.cover;
        coverImg.style.display = "block";
        coverEmpty.style.display = "none";
        removeCoverBtn.style.display = "block";
      } else {
        coverImg.style.display = "none";
        coverEmpty.style.display = "flex";
        removeCoverBtn.style.display = "none";
      }
    }
    refreshCover();

    coverBtn.addEventListener("click", function () { coverInput.click(); });
    coverInput.addEventListener("change", function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        noteState.cover = reader.result;
        refreshCover();
      };
      reader.readAsDataURL(file);
    });
    removeCoverBtn.addEventListener("click", function () {
      noteState.cover = null;
      refreshCover();
    });

    var chipRow = node.querySelector('[data-role="project-chips"]');
    function refreshProjectChips() {
      chipRow.innerHTML = "";
      if (state.projects.length === 0) {
        var span = document.createElement("span");
        span.style.fontSize = "13px";
        span.style.color = "var(--faint)";
        span.textContent = "서가를 먼저 만들어주세요";
        chipRow.appendChild(span);
        return;
      }
      state.projects.forEach(function (p) {
        var active = noteState.projectId === p.id;
        var chip = document.createElement("button");
        chip.className = "project-chip mono" + (active ? " active" : "");
        chip.textContent = p.name;
        chip.style.background = active ? p.color : "transparent";
        chip.style.borderColor = active ? p.color : "";
        chip.addEventListener("click", function () {
          noteState.projectId = p.id;
          refreshProjectChips();
        });
        chipRow.appendChild(chip);
      });
    }
    refreshProjectChips();

    var titleInput = node.querySelector(".title-input");
    titleInput.value = noteState.title;
    titleInput.addEventListener("input", function (e) { noteState.title = e.target.value; });

    var tagChipRow = node.querySelector('[data-role="tag-chips"]');
    var tagInput = node.querySelector(".tag-input");
    function refreshTagChips() {
      tagChipRow.innerHTML = "";
      (noteState.tags || []).forEach(function (t) {
        var chip = document.createElement("span");
        chip.className = "tag-chip mono";
        var label = document.createElement("span");
        label.textContent = "#" + t;
        var removeBtn = document.createElement("button");
        removeBtn.textContent = "\u2715";
        removeBtn.addEventListener("click", function () {
          noteState.tags = noteState.tags.filter(function (x) { return x !== t; });
          refreshTagChips();
        });
        chip.appendChild(label);
        chip.appendChild(removeBtn);
        tagChipRow.appendChild(chip);
      });
    }
    refreshTagChips();

    function addTagFromInput() {
      var t = tagInput.value.trim().replace(/^#/, "");
      if (t && (!noteState.tags || noteState.tags.indexOf(t) === -1)) {
        noteState.tags = (noteState.tags || []).concat([t]);
        refreshTagChips();
      }
      tagInput.value = "";
    }
    tagInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); addTagFromInput(); }
    });
    tagInput.addEventListener("blur", addTagFromInput);

    var contentInput = node.querySelector(".content-input");
    contentInput.value = noteState.content;
    contentInput.addEventListener("input", function (e) { noteState.content = e.target.value; });

    var saveBtn = node.querySelector('[data-action="save"]');
    saveBtn.addEventListener("click", function () { saveCurrentNote(noteState); });

    app.appendChild(root);
  }

  function showUndoToast(message, undoFn) {
    var existing = document.getElementById("undo-toast");
    if (existing) existing.remove();
    if (pendingUndo && pendingUndo.timerId) clearTimeout(pendingUndo.timerId);

    var toast = el("div", "undo-toast");
    toast.id = "undo-toast";
    var msg = el("span", "undo-toast-msg", message);
    var undoBtn = el("button", "undo-toast-btn mono", "되돌리기");
    undoBtn.addEventListener("click", function () {
      clearTimeout(pendingUndo.timerId);
      pendingUndo = null;
      toast.remove();
      undoFn();
    });
    toast.appendChild(msg);
    toast.appendChild(undoBtn);
    document.body.appendChild(toast);

    var timerId = setTimeout(function () {
      var t = document.getElementById("undo-toast");
      if (t) t.remove();
      pendingUndo = null;
    }, UNDO_TIMEOUT_MS);

    pendingUndo = { timerId: timerId };
  }

  function exportBackup() {
    var data = { projects: state.projects, notes: state.notes, exportedAt: new Date().toISOString() };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "archive-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function triggerImport() {
    document.getElementById("import-input").click();
  }

  function handleImportFile(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data.projects || !data.notes) throw new Error("invalid");
        var replace = confirm("현재 데이터를 백업 파일 내용으로 교체할까요?\n(취소하면 가져오기를 중단해요)");
        if (!replace) return;
        state.projects = data.projects;
        state.notes = data.notes;
        persist();
        renderList();
      } catch (err) {
        alert("올바른 백업 파일이 아니에요.");
      }
    };
    reader.readAsText(file);
  }

  function init() {
    load();
    renderList();
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("sw.js").catch(function () {});
      });
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
