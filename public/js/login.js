import { api } from './api.js';

const inviteForm = document.getElementById('invite-form');
const adminForm = document.getElementById('admin-form');
const inviteError = document.getElementById('invite-error');
const adminError = document.getElementById('admin-error');
const inviteSubmit = document.getElementById('invite-submit');
const adminSubmit = document.getElementById('admin-submit');
const codeInput = document.getElementById('invite-code');
const passwordInput = document.getElementById('admin-password');
const authSub = document.getElementById('auth-sub');
const switchToAdmin = document.getElementById('switch-to-admin');
const switchToInvite = document.getElementById('switch-to-invite');

async function checkSession() {
  try {
    const me = await api('/api/auth');
    if (me.authenticated) location.replace('app.html');
  } catch {
    /* stay on sign-in */
  }
}
checkSession();

function showAdminMode(show) {
  inviteForm.classList.toggle('hidden', show);
  adminForm.classList.toggle('hidden', !show);
  switchToAdmin.classList.toggle('hidden', show);
  switchToInvite.classList.toggle('hidden', !show);
  authSub.textContent = show
    ? 'Sign in with your organizer password'
    : 'Sign in with your invite code to vote';
  document.title = show ? 'Organizer sign in — Elite Brothers Club' : 'Sign in — Elite Brothers Club';
  (show ? passwordInput : codeInput).focus();
}

document.getElementById('admin-toggle').addEventListener('click', () => showAdminMode(true));
document.getElementById('invite-toggle').addEventListener('click', () => showAdminMode(false));

codeInput.addEventListener('input', () => {
  const raw = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  codeInput.value = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
});

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
}

inviteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  inviteError.textContent = '';
  const code = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 8) {
    inviteError.textContent = 'Enter the full 8-character code';
    return;
  }
  setBusy(inviteSubmit, true, 'Signing in…');
  try {
    await api('/api/auth', { method: 'POST', body: { action: 'invite', inviteCode: code } });
    location.replace('app.html');
  } catch (err) {
    inviteError.textContent = err.message;
    setBusy(inviteSubmit, false, 'Continue');
  }
});

adminForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  adminError.textContent = '';
  setBusy(adminSubmit, true, 'Signing in…');
  try {
    await api('/api/auth', { method: 'POST', body: { action: 'admin', password: passwordInput.value } });
    location.replace('app.html');
  } catch (err) {
    adminError.textContent = err.message;
    setBusy(adminSubmit, false, 'Sign in');
  }
});
