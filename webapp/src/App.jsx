import { useEffect, useState } from 'react';
import Game from './components/Game.jsx';
import Wallet from './components/Wallet.jsx';
import Profile from './components/Profile.jsx';
import Missions from './components/Missions.jsx';
import Shop from './components/Shop.jsx';
import Login from './components/Login.jsx';
import { isAuthed, isTelegram, setToken } from './lib/session.js';
import { useTelegram } from './hooks/useTelegram.js';

const SCREENS = ['play', 'wallet', 'profile', 'missions', 'shop'];

/** Which screen a launch link asked for (the bot opens ?screen=wallet, ?screen=profile, …). */
function requestedScreen() {
  const requested = new URLSearchParams(window.location.search).get('screen');
  if (requested === 'multiplayer') return 'play'; // older bot links
  return SCREENS.includes(requested) ? requested : 'play';
}

export default function App() {
  const { user, haptic } = useTelegram();
  const [screen, setScreen] = useState(requestedScreen);
  const [authed, setAuthed] = useState(() => isAuthed());
  const [suspended, setSuspended] = useState('');

  // The server refuses a suspended player (API 403 / socket handshake); show why instead of the game.
  useEffect(() => {
    const onSuspended = (e) => setSuspended(e.detail || 'Account suspended');
    window.addEventListener('tgb-suspended', onSuspended);
    return () => window.removeEventListener('tgb-suspended', onSuspended);
  }, []);

  // A rejected session token (401) drops the app back to the login screen.
  useEffect(() => {
    const onLogout = () => setAuthed(isAuthed());
    window.addEventListener('tgb-logout', onLogout);
    return () => window.removeEventListener('tgb-logout', onLogout);
  }, []);

  const logout = () => {
    setToken('');
    setAuthed(isAuthed());
    setScreen('play');
  };

  // Every screen needs a signed-in player: Telegram initData or an email session.
  if (!authed) return <Login onDone={() => setAuthed(true)} haptic={haptic} />;

  if (suspended) {
    return (
      <main className="min-h-full flex flex-col items-center justify-center gap-4 px-6 py-10 text-center bg-ink-900 text-slate-100">
        <span className="text-6xl">⛔</span>
        <h1 className="text-xl font-black">{suspended}</h1>
        <p className="text-sm text-slate-300 max-w-xs">Your wallet balance is kept. Contact support through the bot if you think this is a mistake.</p>
        {!isTelegram() && (
          <button onClick={logout} className="mt-2 px-5 py-2.5 rounded-xl bg-ink-800 border border-ink-600 font-bold">
            Log out
          </button>
        )}
      </main>
    );
  }

  const onNav = (next) => setScreen(SCREENS.includes(next) ? next : 'play');

  switch (screen) {
    case 'wallet':
      return <Wallet onNav={onNav} haptic={haptic} />;
    case 'missions':
      return <Missions onNav={onNav} haptic={haptic} />;
    case 'shop':
      return <Shop onNav={onNav} haptic={haptic} />;
    case 'profile':
      return <Profile user={user} onNav={onNav} onLogout={isTelegram() ? null : logout} haptic={haptic} />;
    default:
      return <Game user={user} onNav={onNav} haptic={haptic} />;
  }
}
