import { useCallback, useEffect, useState } from 'react';
import Game from './components/Game.jsx';
import Wallet from './components/Wallet.jsx';
import Profile from './components/Profile.jsx';
import Missions from './components/Missions.jsx';
import Shop from './components/Shop.jsx';
import History from './components/History.jsx';
import Transfer from './components/Transfer.jsx';
import Splash from './components/Splash.jsx';

// The logo stays up this long at least; the game connects and loads underneath it meanwhile.
const SPLASH_MS = 900;
import { useTelegram } from './hooks/useTelegram.js';
import { useT, tError } from './lib/i18n.js';

const SCREENS = ['play', 'wallet', 'transfer', 'profile', 'missions', 'shop', 'history'];

/** Which screen a launch link asked for (the bot opens ?screen=wallet, ?screen=profile, …). */
function requestedScreen() {
  const requested = new URLSearchParams(window.location.search).get('screen');
  if (requested === 'multiplayer') return 'play'; // older bot links
  return SCREENS.includes(requested) ? requested : 'play';
}

export default function App() {
  const { user, haptic } = useTelegram();
  const t = useT();
  const [screen, setScreen] = useState(requestedScreen);
  const [suspended, setSuspended] = useState('');
  const [walletHint, setWalletHint] = useState(null);
  const [booting, setBooting] = useState(true);

  // Branded loading screen while the Telegram SDK and the first data settle.
  useEffect(() => {
    const timer = setTimeout(() => setBooting(false), SPLASH_MS);
    return () => clearTimeout(timer);
  }, []);

  // `opts.need` carries the ETB a player is short of when JOIN sends them to deposit.
  const onNav = useCallback((next, opts = null) => {
    setWalletHint(opts?.need ? { need: opts.need } : null);
    setScreen(SCREENS.includes(next) ? next : 'play');
  }, []);

  // The server refuses a suspended player (API 403 / socket handshake); show why instead of the game.
  useEffect(() => {
    const onSuspended = (e) => setSuspended(e.detail || 'Account suspended');
    window.addEventListener('tgb-suspended', onSuspended);
    return () => window.removeEventListener('tgb-suspended', onSuspended);
  }, []);

  if (suspended) {
    return (
      <main className="min-h-full flex flex-col items-center justify-center gap-4 px-6 py-10 text-center bg-ink-900 text-slate-100">
        <span className="text-6xl">⛔</span>
        <h1 className="text-xl font-black">{tError(suspended)}</h1>
        <p className="text-sm text-slate-300 max-w-xs">{t('app.suspendedHelp')}</p>
      </main>
    );
  }

  const other = otherScreen(screen, { user, onNav, haptic, walletHint });
  // The game stays mounted (hidden) behind the other screens: its socket, table and lobby
  // survive a visit to the wallet, so coming back is instant instead of a reconnect.
  return (
    <>
      {booting && (
        <div className="fixed inset-0 z-[60]">
          <Splash />
        </div>
      )}
      <div className={other ? 'hidden' : 'contents'}>
        <Game user={user} onNav={onNav} haptic={haptic} active={!other} />
      </div>
      {other}
    </>
  );
}

function otherScreen(screen, { user, onNav, haptic, walletHint }) {
  switch (screen) {
    case 'wallet':
      return <Wallet onNav={onNav} hint={walletHint} haptic={haptic} />;
    case 'transfer':
      return <Transfer onNav={onNav} haptic={haptic} />;
    case 'missions':
      return <Missions onNav={onNav} haptic={haptic} />;
    case 'history':
      return <History onNav={onNav} />;
    case 'shop':
      return <Shop onNav={onNav} haptic={haptic} />;
    case 'profile':
      return <Profile user={user} onNav={onNav} haptic={haptic} />;
    default:
      return null;
  }
}
