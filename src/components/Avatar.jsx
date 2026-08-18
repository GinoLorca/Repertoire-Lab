import React from 'react';
import MonsterAvatar from './MonsterAvatar';
import { defaultMonsterId } from '../lib/monsters';

// Whatever a player's avatar currently is — an uploaded photo, a chosen
// monster, or (players from before this existed) nothing yet, which falls
// back to a monster picked stably from their id.
export default function Avatar({ avatar, seed, size = 40, className }) {
  const cls = `avatar-frame${className ? ` ${className}` : ''}`;
  if (avatar?.kind === 'photo' && avatar.data) {
    return (
      <img
        className={cls}
        src={avatar.data}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
      />
    );
  }
  const variant = avatar?.kind === 'monster' ? avatar.variant : defaultMonsterId(seed ?? '');
  return <MonsterAvatar className={cls} variant={variant} size={size} />;
}
