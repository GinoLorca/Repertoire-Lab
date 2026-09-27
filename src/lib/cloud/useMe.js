import { useEffect, useState } from 'react';
import { cloudConfigured } from './config';
import { watchAuth } from './auth';
import { loadProfile } from './profile';

// Who's signed in, with their profile (account name, role) — wherever a screen
// needs to act as them: the roster adding a student by account, a student's
// page opening or ending a link, the provider that sends games to a linked
// student.
export function useMe() {
  const [me, setMe] = useState(null);
  useEffect(() => {
    if (!cloudConfigured) return undefined;
    let stop = () => {};
    watchAuth(async (u) => {
      if (!u) { setMe(null); return; }
      const profile = await loadProfile(u.uid).catch(() => null);
      // The signed-in uid goes LAST: a profile document carries its own
      // `uid`, and if it ever disagreed with who's actually signed in, the
      // rules would refuse every write made as this coach.
      setMe({ ...(profile ?? {}), uid: u.uid });
    }).then((fn) => { stop = fn; });
    return () => stop();
  }, []);
  return me;
}
