import { api, ApiError, esc } from './api.js';

const $ = (id) => document.getElementById(id);

const els = {
  view: $('view'),
  title: $('topbar-title'),
  hash: $('topbar-hash'),
  pill: $('topbar-pill'),
  actions: $('topbar-actions'),
  pollLinks: $('poll-links'),
  adminSection: $('admin-section'),
  navCreate: $('nav-create'),
  navInvites: $('nav-invites'),
  userName: $('user-name'),
  userRole: $('user-role'),
  avatar: $('user-avatar'),
  signout: $('signout-btn'),
  menuBtn: $('menu-btn'),
  backdrop: $('sidebar-backdrop'),
  toastRoot: $('toast-root'),
};

const ICON = {
  chevron: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
};

let me = null;
let polls = [];
let renderSeq = 0;

/* ---------- utilities ---------- */

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const statusPill = (status) =>
  status === 'open'
    ? '<span class="pill pill-open">Open</span>'
    : '<span class="pill pill-closed">Closed</span>';

function toast(message, isError = false) {
  const node = document.createElement('div');
  node.className = `toast${isError ? ' is-error' : ''}`;
  node.textContent = message;
  els.toastRoot.appendChild(node);
  setTimeout(() => node.remove(), 3500);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  } catch {
    toast('Could not copy to clipboard', true);
  }
}

function setTopbar({ hash = '', title, pill = '', actions = '' } = {}) {
  els.hash.textContent = hash;
  els.title.textContent = title;
  els.pill.innerHTML = pill;
  els.actions.innerHTML = actions;
}

function formatDate(value) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function pollMeta(poll) {
  const parts = [];
  if (poll.description) parts.push(truncate(poll.description, 70));
  parts.push(`${poll.candidateCount} option${poll.candidateCount === 1 ? '' : 's'}`);
  if (poll.totalVotes != null) parts.push(`${poll.totalVotes} vote${poll.totalVotes === 1 ? '' : 's'}`);
  return parts.join('  ·  ');
}

function emptyState(title, sub, actionHtml = '') {
  return `<div class="empty"><div class="empty-title">${esc(title)}</div><div class="empty-sub">${esc(sub)}</div>${actionHtml}</div>`;
}

/* ---------- routing ---------- */

function currentRoute() {
  const qs = new URLSearchParams(location.search);
  return { view: qs.get('view') || 'polls', id: qs.get('id') };
}

function navigate(params, { replace = false } = {}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null) qs.set(key, value);
  }
  const url = `${location.pathname}${qs.toString() ? `?${qs.toString()}` : ''}`;
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
  document.body.classList.remove('sidebar-open');
  render();
}

function markActiveNav(route) {
  document.querySelectorAll('#side-nav .side-item').forEach((el) => {
    const active =
      el.dataset.id != null
        ? route.view === 'poll' && el.dataset.id === route.id
        : el.dataset.view === route.view;
    el.classList.toggle('is-active', active);
  });
}

/* ---------- sidebar ---------- */

function renderSidebarPolls() {
  els.pollLinks.innerHTML = polls
    .map(
      (poll) => `
        <a class="side-item" href="?view=poll&id=${esc(poll.id)}" data-view="poll" data-id="${esc(poll.id)}">
          <span class="side-hash">#</span>
          <span class="side-item-label">${esc(poll.title)}</span>
        </a>`
    )
    .join('');
  markActiveNav(currentRoute());
}

async function loadSidebarPolls() {
  try {
    const data = await api('/api/polls');
    polls = data.polls;
    renderSidebarPolls();
  } catch {
    /* sidebar quietly stays empty */
  }
}

/* ---------- views ---------- */

async function renderPolls(seq) {
  setTopbar({
    title: 'All polls',
    actions:
      me.role === 'admin'
        ? '<button class="btn btn-primary btn-sm" id="topbar-new">New poll</button>'
        : '',
  });
  $('topbar-new')?.addEventListener('click', () => navigate({ view: 'create' }));

  const data = await api('/api/polls');
  if (seq !== renderSeq) return;
  polls = data.polls;
  renderSidebarPolls();

  if (!polls.length) {
    els.view.innerHTML = emptyState(
      'No polls yet',
      me.role === 'admin'
        ? 'Create your first poll to open voting.'
        : 'Your organizers have not published any polls yet.',
      me.role === 'admin'
        ? '<p style="margin-top:16px"><button class="btn btn-primary" id="empty-create">New poll</button></p>'
        : ''
    );
    $('empty-create')?.addEventListener('click', () => navigate({ view: 'create' }));
    return;
  }

  els.view.innerHTML = `
    <div class="section-title">All polls</div>
    <p class="help" style="margin-bottom:16px">
      ${me.role === 'admin' ? 'You can create and manage polls as an organizer.' : 'Open a poll to cast your vote.'}
    </p>
    <div class="list">
      ${polls
        .map(
          (poll) => `
        <button type="button" class="list-row" data-poll="${esc(poll.id)}">
          <span class="side-hash">#</span>
          <span class="list-row-body">
            <span class="list-row-title">${esc(poll.title)}</span>
            <span class="list-row-meta">${esc(pollMeta(poll))}</span>
          </span>
          ${statusPill(poll.status)}
          ${ICON.chevron}
        </button>`
        )
        .join('')}
    </div>`;

  els.view.querySelectorAll('[data-poll]').forEach((row) => {
    row.addEventListener('click', () => navigate({ view: 'poll', id: row.dataset.poll }));
  });
}

function resultsHtml(data) {
  const { results, hasVoted, votedFor, candidates } = data;
  const nameOf = (id) => candidates.find((c) => c.id === id)?.name || 'your selection';

  let html = '';
  if (hasVoted) {
    html += `<div class="banner">${ICON.check}<span>Your vote for <strong>${esc(
      nameOf(votedFor)
    )}</strong> has been counted.</span></div>`;
  }

  html += `<div class="results-head">
      <span class="block-title" style="margin:0">Results</span>
      <span class="results-count">${results.totalVotes} vote${results.totalVotes === 1 ? '' : 's'}</span>
    </div>`;

  if (results.totalVotes === 0) {
    html += `<p class="help">No votes have been cast yet.</p>`;
    return html;
  }

  const max = Math.max(...results.candidates.map((c) => c.votes));
  html += results.candidates
    .map((candidate) => {
      const pct = Math.round((candidate.votes / results.totalVotes) * 100);
      const leading = candidate.votes === max && max > 0;
      return `
        <div class="result${leading ? ' is-leading' : ''}">
          <div class="result-top">
            <span class="result-name">${esc(candidate.name)}${
              leading ? '<span class="pill pill-lead">Leading</span>' : ''
            }</span>
            <span class="result-figures">${candidate.votes} · ${pct}%</span>
          </div>
          <div class="result-track"><div class="result-fill" data-width="${pct}"></div></div>
        </div>`;
    })
    .join('');

  return html;
}

function bindVoteForm(id) {
  const form = $('vote-form');
  if (!form) return;
  const submit = $('vote-submit');

  form.addEventListener('change', () => {
    const checked = form.querySelector('input[name="candidate"]:checked');
    form.querySelectorAll('.option').forEach((option) => {
      option.classList.toggle('is-selected', checked != null && option.dataset.option === checked.value);
    });
    submit.disabled = checked == null;
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const checked = form.querySelector('input[name="candidate"]:checked');
    if (!checked) return;
    submit.disabled = true;
    submit.textContent = 'Recording…';
    try {
      await api('/api/vote', { method: 'POST', body: { pollId: id, candidateId: checked.value } });
      toast('Your vote has been counted');
      render();
    } catch (err) {
      toast(err.message, true);
      submit.disabled = false;
      submit.textContent = 'Cast vote';
    }
  });
}

function bindPollAdminActions(poll) {
  const button = poll.status === 'open' ? $('topbar-close') : $('topbar-reopen');
  button?.addEventListener('click', async () => {
    const action = poll.status === 'open' ? 'close' : 'reopen';
    button.disabled = true;
    try {
      await api('/api/polls', { method: 'POST', body: { action, id: poll.id } });
      toast(action === 'close' ? 'Poll closed' : 'Poll reopened');
      await loadSidebarPolls();
      render();
    } catch (err) {
      toast(err.message, true);
      button.disabled = false;
    }
  });
}

async function renderPoll(id, seq) {
  if (!id) {
    navigate({ view: 'polls' }, { replace: true });
    return;
  }

  const data = await api(`/api/polls?id=${encodeURIComponent(id)}`);
  if (seq !== renderSeq) return;

  const { poll, candidates, results, canVote } = data;
  setTopbar({
    hash: '#',
    title: poll.title,
    pill: statusPill(poll.status),
    actions:
      me.role === 'admin'
        ? poll.status === 'open'
          ? '<button class="btn btn-secondary btn-sm" id="topbar-close">Close poll</button>'
          : '<button class="btn btn-secondary btn-sm" id="topbar-reopen">Reopen poll</button>'
        : '',
  });
  bindPollAdminActions(poll);

  let html = '';
  if (poll.description) {
    html += `<blockquote class="poll-description">${esc(poll.description)}</blockquote>`;
  }

  if (canVote) {
    html += `
      <div class="block-title">Choose one option</div>
      <form id="vote-form">
        <div class="options">
          ${candidates
            .map(
              (candidate) => `
            <label class="option" data-option="${esc(candidate.id)}">
              <input type="radio" name="candidate" value="${esc(candidate.id)}">
              <span class="option-radio"></span>
              <span class="option-name">${esc(candidate.name)}</span>
            </label>`
            )
            .join('')}
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit" id="vote-submit" disabled>Cast vote</button>
          <span class="help" style="margin:0">Results appear after you vote or when the poll closes.</span>
        </div>
      </form>`;
  }

  if (results) {
    html += resultsHtml(data);
  }

  els.view.innerHTML = html;
  bindVoteForm(poll.id);

  requestAnimationFrame(() => {
    els.view.querySelectorAll('.result-fill').forEach((bar) => {
      bar.style.width = `${bar.dataset.width}%`;
    });
  });
}

function candidateRowHtml(value = '') {
  return `
    <div class="candidate-row">
      <input class="input" name="candidate" maxlength="80" placeholder="Candidate or option" value="${esc(
        value
      )}" autocomplete="off">
      <button type="button" class="icon-btn" data-remove aria-label="Remove option">${ICON.close}</button>
    </div>`;
}

async function renderCreate(seq) {
  setTopbar({ title: 'New poll' });
  if (seq !== renderSeq) return;

  els.view.innerHTML = `
    <div class="section-title">Create a new poll</div>
    <p class="help" style="margin-bottom:20px">Voters will need an invite code to participate.</p>
    <form id="create-form" autocomplete="off">
      <div class="field">
        <label class="label" for="poll-title">Poll title</label>
        <input class="input" id="poll-title" name="title" maxlength="200"
               placeholder="e.g. Club President 2026" required>
      </div>
      <div class="field">
        <label class="label" for="poll-desc">Description <span style="font-weight:400;color:var(--muted)">(optional)</span></label>
        <textarea class="textarea" id="poll-desc" maxlength="2000"
                  placeholder="What is this vote about?"></textarea>
      </div>
      <div class="field">
        <span class="label">Options</span>
        <div id="candidate-rows">
          ${candidateRowHtml()}
          ${candidateRowHtml()}
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="add-candidate" style="margin-top:6px">+ Add option</button>
        <p class="help">Between 2 and 20 options. Duplicates are not allowed.</p>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit" id="create-submit">Create poll</button>
        <button class="btn btn-ghost" type="button" id="cancel-create">Cancel</button>
      </div>
    </form>`;

  const container = $('candidate-rows');

  const updateRemoveButtons = () => {
    const rows = container.querySelectorAll('.candidate-row');
    rows.forEach((row) => {
      row.querySelector('[data-remove]').style.visibility = rows.length <= 2 ? 'hidden' : 'visible';
    });
  };
  updateRemoveButtons();

  $('add-candidate').addEventListener('click', () => {
    container.insertAdjacentHTML('beforeend', candidateRowHtml());
    updateRemoveButtons();
    container.lastElementChild.querySelector('input').focus();
  });

  container.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove]');
    if (!remove) return;
    remove.closest('.candidate-row').remove();
    updateRemoveButtons();
  });

  $('cancel-create').addEventListener('click', () => navigate({ view: 'polls' }));

  $('create-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = $('poll-title').value.trim();
    const description = $('poll-desc').value.trim();
    const candidates = [...container.querySelectorAll('input[name="candidate"]')]
      .map((input) => input.value.trim())
      .filter(Boolean);

    if (!title) return toast('Give the poll a title', true);
    if (candidates.length < 2) return toast('Add at least two options', true);

    const submit = $('create-submit');
    submit.disabled = true;
    submit.textContent = 'Creating…';
    try {
      const created = await api('/api/polls', {
        method: 'POST',
        body: { title, description, candidates },
      });
      toast('Poll created');
      await loadSidebarPolls();
      navigate({ view: 'poll', id: created.id });
    } catch (err) {
      toast(err.message, true);
      submit.disabled = false;
      submit.textContent = 'Create poll';
    }
  });
}

function openModal({ title, bodyHtml, footHtml = '', onMount }) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <h2 class="modal-title">${esc(title)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Close">${ICON.close}</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
      ${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ''}
    </div>`;
  document.body.appendChild(overlay);

  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };

  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target.closest('[data-close]')) close();
  });
  onMount?.(overlay, close);
  return close;
}

function openGenerateModal() {
  openModal({
    title: 'Generate invite codes',
    bodyHtml: `
      <div class="field">
        <label class="label" for="gen-count">How many codes?</label>
        <input class="input" id="gen-count" type="number" min="1" max="100" value="10">
        <p class="help">Each code lets one member sign in and vote. You can generate 1–100 at a time.</p>
      </div>`,
    footHtml: `
      <button type="button" class="btn btn-ghost" data-close>Cancel</button>
      <button type="button" class="btn btn-primary" id="gen-submit">Generate</button>`,
    onMount: (overlay, close) => {
      const generate = async () => {
        const count = Number.parseInt(overlay.querySelector('#gen-count').value, 10);
        if (!Number.isInteger(count) || count < 1 || count > 100) {
          toast('Enter a number between 1 and 100', true);
          return;
        }
        const button = overlay.querySelector('#gen-submit');
        button.disabled = true;
        button.textContent = 'Generating…';
        try {
          const data = await api('/api/invites', { method: 'POST', body: { action: 'generate', count } });
          const codes = data.invites.map((invite) => invite.code);
          overlay.querySelector('.modal-title').textContent = `${codes.length} invite code${codes.length === 1 ? '' : 's'} created`;
          overlay.querySelector('.modal-body').innerHTML = `
            <div class="generated-codes">${codes.map(esc).join('<br>')}</div>
            <p class="help">Share these with your members. Each code works once until you reactivate it.</p>`;
          overlay.querySelector('.modal-foot').innerHTML = `
            <button type="button" class="btn btn-secondary" id="gen-copy">Copy all</button>
            <button type="button" class="btn btn-primary" id="gen-done">Done</button>`;
          overlay.querySelector('#gen-copy').addEventListener('click', () => copyText(codes.join('\n')));
          overlay.querySelector('#gen-done').addEventListener('click', () => {
            close();
            render();
          });
        } catch (err) {
          toast(err.message, true);
          button.disabled = false;
          button.textContent = 'Generate';
        }
      };
      overlay.querySelector('#gen-submit').addEventListener('click', generate);
      overlay.querySelector('#gen-count').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') generate();
      });
    },
  });
}

async function renderInvites(seq) {
  setTopbar({
    title: 'Invite codes',
    actions: '<button class="btn btn-primary btn-sm" id="topbar-generate">Generate invites</button>',
  });
  $('topbar-generate')?.addEventListener('click', openGenerateModal);

  const data = await api('/api/invites');
  if (seq !== renderSeq) return;

  if (!data.invites.length) {
    els.view.innerHTML = emptyState(
      'No invite codes yet',
      'Generate codes so members can sign in and vote.',
      '<p style="margin-top:16px"><button class="btn btn-primary" id="empty-generate">Generate invite codes</button></p>'
    );
    $('empty-generate')?.addEventListener('click', openGenerateModal);
    return;
  }

  els.view.innerHTML = `
    <div class="section-title">Invite codes</div>
    <p class="help" style="margin-bottom:16px">
      Members sign in with a code. Blocking a code signs that member out everywhere.
    </p>
    <div class="code-list">
      ${data.invites
        .map(
          (invite) => `
        <div class="code-row">
          <div class="code-row-body">
            <div class="code-cell">${esc(invite.code)}</div>
            <div class="code-row-meta">Created ${esc(formatDate(invite.createdAt))} · ${invite.voteCount} vote${
              invite.voteCount === 1 ? '' : 's'
            }</div>
          </div>
          <span class="pill ${invite.used ? 'pill-inactive' : 'pill-active'}">${
            invite.used ? 'Used' : 'Unused'
          }</span>
          <div class="code-actions">
            <button type="button" class="icon-btn" data-copy="${esc(invite.code)}" title="Copy code" aria-label="Copy code">${ICON.copy}</button>
            ${
              invite.used
                ? `<button type="button" class="btn btn-secondary btn-sm" data-act="reopen" data-id="${esc(invite.id)}">Allow sign-in</button>`
                : `<button type="button" class="btn btn-danger-ghost btn-sm" data-act="revoke" data-id="${esc(invite.id)}">Block</button>`
            }
          </div>
        </div>`
        )
        .join('')}
    </div>`;

  els.view.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', () => copyText(button.dataset.copy));
  });

  els.view.querySelectorAll('[data-act]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.act;
      button.disabled = true;
      try {
        await api('/api/invites', {
          method: 'POST',
          body: { action, voterId: button.dataset.id },
        });
        toast(action === 'revoke' ? 'Code blocked' : 'Sign-in allowed again');
        render();
      } catch (err) {
        toast(err.message, true);
        button.disabled = false;
      }
    });
  });
}

/* ---------- render loop ---------- */

async function render() {
  const seq = ++renderSeq;
  const route = currentRoute();

  if ((route.view === 'create' || route.view === 'invites') && me?.role !== 'admin') {
    navigate({ view: 'polls' }, { replace: true });
    return;
  }

  markActiveNav(route);
  els.view.innerHTML = '<div class="spinner"></div>';

  try {
    if (route.view === 'poll') await renderPoll(route.id, seq);
    else if (route.view === 'create') await renderCreate(seq);
    else if (route.view === 'invites') await renderInvites(seq);
    else await renderPolls(seq);
  } catch (err) {
    if (seq !== renderSeq) return;
    if (err instanceof ApiError && err.status === 401) {
      location.replace('index.html');
      return;
    }
    els.view.innerHTML = emptyState('Could not load', err.message || 'Please try again.');
    els.view.insertAdjacentHTML(
      'beforeend',
      '<p style="margin-top:16px"><button class="btn btn-secondary" id="retry">Try again</button></p>'
    );
    $('retry')?.addEventListener('click', render);
  }
}

/* ---------- chrome & boot ---------- */

function setupChrome() {
  const isAdmin = me.role === 'admin';
  els.userName.textContent = isAdmin ? 'Organizer' : 'Member';
  els.userRole.textContent = isAdmin ? 'Organizer access' : 'Voter access';
  els.avatar.textContent = isAdmin ? 'O' : 'M';
  if (isAdmin) {
    els.adminSection.classList.remove('hidden');
    els.navCreate.classList.remove('hidden');
    els.navInvites.classList.remove('hidden');
  }
}

function bindGlobalEvents() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-view]');
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    const qs = new URLSearchParams(link.getAttribute('href'));
    navigate({ view: qs.get('view'), id: qs.get('id') });
  });

  window.addEventListener('popstate', render);

  els.signout.addEventListener('click', async () => {
    try {
      await api('/api/auth', { method: 'POST', body: { action: 'logout' } });
    } catch {
      /* sign out locally regardless */
    }
    location.replace('index.html');
  });

  els.menuBtn.addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
  els.backdrop.addEventListener('click', () => document.body.classList.remove('sidebar-open'));
}

async function boot() {
  try {
    me = await api('/api/auth');
  } catch {
    me = { authenticated: false };
  }
  if (!me.authenticated) {
    location.replace('index.html');
    return;
  }
  setupChrome();
  bindGlobalEvents();
  await loadSidebarPolls();
  render();
}

boot();
